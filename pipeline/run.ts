import { sql } from "../src/lib/db";
import { DEFAULT_WEIGHTS, type Source } from "../src/lib/types";
import { allReaders, readerSources, recordCall, topicsInUse } from "../src/lib/readers";
import { fetchAllSources, pollNow } from "./fetch";
import { canonUrl, normalizeTitle } from "./normalize";
import { askDuplicates, flattenDupChains, markDuplicates } from "./dedup";
import { enrichArticles } from "./enrich";
import { composite, scoreAll, type Scorable } from "./score";
import { WINDOW_DAYS } from "./select";
import { articleHtml, describeVideo, fetchTranscript, MAX_VIDEOS_PER_RUN, videoIdOf } from "./youtube";
import { jevCost, llmCost } from "./cost";
import { sourcesForPlan } from "../src/lib/plans";
import { effectivePlan } from "../src/lib/billing";
import { jevVersionNote } from "../src/lib/jev-version";
import { issueDue } from "./issue";

const log = (msg: string) => console.log(msg);

export async function collect(sources: Source[]): Promise<number[]> {
  const inserted: number[] = [];

  const results = await fetchAllSources(sources, (result) => {
    log(result.ok ? `  ${result.source.label}: ${result.items.length}` : `  ${result.source.label}: ошибка — ${result.error}`);
  });

  for (const result of results) {
    if (!result.ok) {
      await sql`update dailynews.sources set last_error = ${result.error} where id = ${result.source.id}`;
      continue;
    }
    // Тишина отмечается временем, а не счётчиком: прогон могут запустить
    // дважды за сутки, и счётчик посчитал бы два дня за один. Снимается
    // первой же записью.
    await sql`
      update dailynews.sources
         set last_ok_at = now(), last_count = ${result.items.length}, last_error = null,
             silent_since = case when ${result.items.length} > 0 then null
                                 else coalesce(silent_since, now()) end
       where id = ${result.source.id}
    `;

    for (const item of result.items) {
      // on conflict по url_canon — первый слой дедупа, он же защита от
      // повторного прогона в тот же день.
      const rows = await sql<{ id: number }[]>`
        insert into dailynews.items
          (source_id, url, url_canon, title, title_norm, excerpt, body, points, comments, published_at)
        values (
          ${result.source.id}, ${item.url}, ${item.canon ?? canonUrl(item.url)}, ${item.title},
          ${normalizeTitle(item.title)}, ${item.excerpt}, ${item.body ?? null},
          ${item.points}, ${item.comments}, ${item.published_at}
        )
        on conflict (url_canon) do nothing
        returning id
      `;
      if (rows[0]) inserted.push(rows[0].id);
    }
  }

  // Источник, отвечающий 200 и отдающий ноль, — самая незаметная поломка
  // в ленте: ошибки нет, дайджест приходит, просто одного голоса в нём
  // больше не слышно. Поэтому тишина называется вслух в каждом прогоне.
  const silent = await sql<{ label: string; days: number }[]>`
    select label, (current_date - silent_since::date)::int as days
      from dailynews.sources
     where deleted_at is null and silent_since is not null
     order by silent_since
  `;
  if (silent.length > 0) {
    log(`  молчат: ${silent.map((row) => `${row.label} (${row.days} дн.)`).join(", ")}`);
  }

  return inserted;
}

/**
 * Расшифровать ролики среди новых материалов.
 *
 * Стоит рядом со сбором и до оценки нарочно: Jev оценивает материал
 * по заголовку и тексту, и ролик без расшифровки приходил к нему одной
 * строкой описания. Один вызов модели на ролик, `reader_id = null` —
 * содержание ролика общее, как и оценка; второй читатель того же канала
 * не платит за него заново.
 *
 * Отказ доступа прекращает весь шаг: «нас приняли за робота» — свойство
 * адреса, а не ролика, и сорок одинаковых отказов подряд ничего не добавят.
 */
export async function transcribeVideos(): Promise<{ done: number; cost: number }> {
  // Берём всё окно, а не то, что вставил этот прогон: первая попытка
  // могла не удаться — провайдер ответил 401, YouTube отказал, — и ролик
  // остался бы с описанием из фида навсегда, потому что новым он больше
  // никогда не будет. Отметка о попытке и есть то, что отличает
  // «уже ходили» от «ещё нет».
  const rows = await sql<{ id: number; url: string; title: string; label: string }[]>`
    select i.id, i.url, i.title, s.label
      from dailynews.items i
      join dailynews.sources s on s.id = i.source_id
     where i.dup_of is null
       and i.transcribed_at is null
       and i.collected_at > now() - ${`${WINDOW_DAYS} days`}::interval
     order by i.id
  `;
  const videos = rows.flatMap((row) => {
    const videoId = videoIdOf(row.url);
    return videoId ? [{ ...row, videoId }] : [];
  });
  if (videos.length === 0) return { done: 0, cost: 0 };

  const take = videos.slice(0, MAX_VIDEOS_PER_RUN);
  if (videos.length > take.length) {
    log(`   роликов ${videos.length}, расшифруем ${take.length} — остальные в следующий прогон`);
  }

  let done = 0;
  let cost = 0;
  let noCaptions = 0;
  for (const video of take) {
    try {
      const transcript = await fetchTranscript(video.videoId);
      if (!transcript) {
        // Субтитров у ролика нет вовсе — это ответ, а не сбой: отмечаем,
        // иначе он опрашивался бы каждую ночь до конца окна свежести.
        // enriched_at заодно: текста со страницы у ролика не бывает,
        // а без отметки догрузка статей выбирала бы его каждую ночь
        // вместе с колонкой body, чтобы тут же отбросить.
        await sql`
          update dailynews.items set transcribed_at = now(), enriched_at = now()
           where id = ${video.id}
        `;
        noCaptions++;
        continue;
      }
      const writeup = await describeVideo(video.title, video.label, transcript.text, transcript.lang);
      await sql`
        update dailynews.items
           set excerpt = ${writeup.summary}, body = ${articleHtml(writeup.article) || null},
               transcribed_at = now(), enriched_at = now()
         where id = ${video.id}
      `;
      // Оценка снимается вместе с текстом, по которому её ставили: ролик,
      // расшифрованный не в тот же прогон, что собран, уже оценён — и оценён
      // по описанию из фида. У торгового канала это «🎁 Получить БЕСПЛАТНО
      // индикаторы»: ни темы, ни конкретики, скор 8 из ста. Конспект менял
      // текст, а решение о материале принималось по старому. Шаг оценки
      // идёт следом в этом же прогоне и переоценит по содержанию.
      await sql`delete from dailynews.scores where item_id = ${video.id}`;
      await recordCall({
        readerId: null, stage: "video", model: writeup.model,
        tokensIn: writeup.usage.input, tokensOut: writeup.usage.output,
        costUsd: llmCost(writeup.usage),
      });
      cost += llmCost(writeup.usage);
      done++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Отказ доступа виден по статусу проигрывателя: он один на все ролики.
      if (/LOGIN_REQUIRED|AGE_VERIFICATION|player HTTP 4/.test(message)) {
        log(`   YouTube не отдаёт субтитры (${message}). Ролики остаются с описанием из фида.`);
        if (!process.env.YT_PROXY) log("   YT_PROXY не задан — с датацентрового адреса субтитров не будет.");
        break;
      }
      log(`   ролик «${video.title.slice(0, 40)}»: ${message}`);
    }
  }

  if (noCaptions > 0) log(`   без субтитров: ${noCaptions}`);
  return { done, cost };
}

async function main() {
  const started = Date.now();

  const readers = await allReaders();
  const topics = await topicsInUse();
  const all = await sql<Source[]>`select * from dailynews.sources where deleted_at is null order by id`;

  // Тариф решает не только форма настроек: понижение оставляет лишние
  // источники включёнными в каталоге, и опрашивать их всё равно нельзя —
  // X платный, и счёт приходит за сбор, а не за галочку в интерфейсе.
  //
  // Сбор общий, поэтому опрашивается объединение по всем читателям, а вот
  // в выпуск каждому попадает только то, что разрешает его тариф (select.ts).
  // Иначе либо самый скромный тариф обесточил бы сбор для всех, либо
  // бесплатный читал бы платный источник за чужой счёт.
  const allowed = new Map<number, Source>();
  for (const reader of readers) {
    for (const source of sourcesForPlan(await readerSources(reader.id), effectivePlan(reader))) {
      allowed.set(source.id, source);
    }
  }
  const sources = [...allowed.values()].filter((source) => pollNow(source)).sort((a, b) => a.id - b.id);
  if (sources.length < all.length) {
    log(`   выбор читателей, их тарифы и X раз в сутки: опрашиваем ${sources.length} из ${all.length} в каталоге`);
  }

  if (topics.length === 0) {
    log("Ни у кого нет интересов — оценивать поток не по чему. Прогон отменён.");
    await sql.end();
    process.exit(1);
  }
  log(`Читателей: ${readers.length}, тем в справочнике: ${topics.length}`);

  log(`1. Сбор: ${sources.length} источников`);
  const collected = await collect(sources);
  log(`   новых материалов: ${collected.length}`);

  const videos = await transcribeVideos();
  if (videos.done > 0) {
    log(`   расшифровано роликов: ${videos.done} (${videos.cost.toFixed(3)} $)`);
  }

  // Фид часто не отдаёт текста вовсе, и без этого шага и оценка, и дайджест
  // работали по одному заголовку — молча и на вид исправно.
  const articles = await enrichArticles(sql, WINDOW_DAYS, log);
  if (articles.done + articles.failed + articles.transient > 0) {
    log(
      `   догружено статей: ${articles.done}` +
      (articles.failed > 0 ? `, не отдали текст: ${articles.failed}` : "") +
      (articles.transient > 0 ? `, не дозвонились (повторим): ${articles.transient}` : "") +
      (articles.pending > 0 ? `, ждут следующего прогона: ${articles.pending}` : ""),
    );
  }

  log("2. Дедуп");
  // Берём всё окно, а не результат вставки: если прогон упал между
  // вставкой и дедупом, по свежим id эти материалы больше никогда
  // не проверятся. Повторная пометка — no-op, так что это безопасно.
  const pending_dedup = await sql<{ id: number }[]>`
    select id from dailynews.items
     where dup_of is null
       and collected_at > now() - ${`${WINDOW_DAYS} days`}::interval
  `;
  const dedupIds = pending_dedup.map((row) => row.id);
  const duplicates = await markDuplicates(sql, dedupIds);
  log(`   помечено дублей по заголовку: ${duplicates}`);

  // Серая зона: заголовки разошлись, а новость одна. Спрашивается уже
  // после первого слоя — по тем, кто его пережил, — и обязательно
  // до скоринга: помеченный здесь дубль не уедет в Jev восемью вопросами.
  const asked = await askDuplicates(sql, dedupIds);
  if (asked.asked > 0) {
    const dedupCost = jevCost(asked.usage.input);
    await recordCall({
      readerId: null, stage: "dedup", model: asked.model,
      tokensIn: asked.usage.input, tokensOut: asked.usage.output, costUsd: dedupCost,
    });
    log(`   спрошено у Jev: ${asked.asked} из ${asked.questions}, дубли: ${asked.marked}, $${dedupCost.toFixed(4)}`);
  }

  // После обоих слоёв, а не после каждого: цепочка рождается и внутри
  // одного `update` первого слоя, и между работниками второго. Сюжет,
  // у которого повтор указывает на повтор, делится надвое — счётчик
  // недосчитывает, а материал с ключом-серединой без оценки уходит
  // из отбора молча.
  const flattened = await flattenDupChains(sql);
  if (flattened > 0) log(`   выпрямлено цепочек дублей: ${flattened}`);
  // Отказавший слой обязан сказать это вслух. Каждый упавший вопрос ловится
  // своим catch-ом, и без этой строки сломанный ключ, сменившаяся подпись
  // вопроса или недоступный Jev выглядели бы как «серой зоны сегодня нет»:
  // прогон идёт дальше, выпуск приходит, повторы возвращаются молча.
  if (asked.questions > asked.asked) {
    log(`   ! серая зона не разобрана: ${asked.questions - asked.asked} вопрос(ов) без ответа`);
  }

  // Оценка общая: семь осей из восьми про сам материал, восьмая
  // классифицирует его по общему справочнику. Сто читателей стоят здесь
  // столько же, сколько один. Погнать Jev на каждого значило бы умножить
  // счёт на число читателей ради почти того же результата.
  log("3. Скоринг Jev — весь поток, один раз на всех");
  const pending = await sql<Scorable[]>`
    select i.id, i.title, i.excerpt, s.label as source_label,
           i.points, i.comments, i.published_at
      from dailynews.items i
      join dailynews.sources s on s.id = i.source_id
     where i.dup_of is null
       and i.collected_at > now() - ${`${WINDOW_DAYS} days`}::interval
       and not exists (select 1 from dailynews.scores sc where sc.item_id = i.id)
     order by i.id
  `;
  log(`   к оценке: ${pending.length}`);

  const { scored, usage, model } = await scoreAll(pending, topics, (done, total) => {
    if (done % 25 === 0 || done === total) log(`   ${done}/${total}`);
  });

  // Версия Jev плавающая (`jev-latest`), а от неё зависят числа, которые
  // сравниваются между собой: порог дубля, корзины калибровки, ряды по дням.
  // Обновись она молча — выпуск придёт вовремя, и ни одна проверка
  // не сработает. Поэтому смена называется вслух, а не ловится задним числом
  // по расхождению рядов.
  const jevNote = jevVersionNote(model);
  if (jevNote) log(`  ! ${jevNote}`);

  const topicIdBySlug = new Map(topics.map((t) => [t.slug, t.id]));
  for (const row of scored) {
    await sql`
      insert into dailynews.scores (item_id, topic_id, total, confidence, axes, model)
      values (
        ${row.item_id}, ${topicIdBySlug.get(row.topic_slug) ?? null},
        -- Скор каталога: веса по умолчанию. Персональный считается из axes
        -- весами читателя при отборе и ложится в digest_items.total.
        ${composite(row.axes, DEFAULT_WEIGHTS)}, ${row.confidence},
        -- Объект, а не JSON.stringify: драйвер сериализует сам, и лишний
        -- stringify кладёт в jsonb строку вместо объекта. Тогда axes->'kind'
        -- молча возвращает null, и ломается вся калибровка по осям.
        ${sql.json(row.axes as unknown as Parameters<typeof sql.json>[0])}, ${model}
      )
      on conflict (item_id) do nothing
    `;
  }
  const scoringCost = jevCost(usage.input);
  await recordCall({
    readerId: null, stage: "score", model,
    tokensIn: usage.input, tokensOut: usage.output, costUsd: scoringCost,
  });
  log(`   оценено: ${scored.length}, токенов: ${usage.input}, $${scoringCost.toFixed(4)}`);

  // Выпуск пишется не всем подряд, а тем, у кого по их поясу уже 02:00
  // (`issueDue`). Остальным его напишет таймер веба, когда их час придёт.
  log("4. Выпуски тем, у кого наступило 02:00");
  const { issued, cost: personal } = await issueDue(new Date(), {
    collected: collected.length, duplicates, scored: scored.length,
  });
  log(`   выпусков: ${issued}`);

  log(
    `Готово за ${Math.round((Date.now() - started) / 1000)} с. ` +
    `Общий этап $${scoringCost.toFixed(4)}, выпуски $${personal.toFixed(4)}`,
  );
  await sql.end();
}

// Сухой прогон импортирует только collect(), поэтому main() не запускается.
if (process.env.DAILYNEWS_DRY_RUN !== "1") {
  main().catch(async (error) => {
    console.error(error);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
}
