import { sql } from "../src/lib/db";
import { DEFAULT_WEIGHTS, type Reader, type Source } from "../src/lib/types";
import {
  allReaders, getReaderTopics, lastActivityAt, pauseReader, recordCall, spentToday,
  topicsInUse, wakeReader,
} from "../src/lib/readers";
import { fetchAllSources } from "./fetch";
import { canonUrl, normalizeTitle } from "./normalize";
import { markDuplicates } from "./dedup";
import { composite, scoreAll, type Scorable } from "./score";
import { writeDigest, type Survivor } from "./digest";
import { selectSurvivors, targetsOf, WINDOW_DAYS } from "./select";
import { askResume, notify } from "../src/lib/telegram";
import { sendToKindle, kindleDigestVerdict } from "./kindle";
import { askFinished } from "../src/lib/telegram";
import { enrichImages } from "./og";
import { articleHtml, describeVideo, fetchTranscript, MAX_VIDEOS_PER_RUN, videoIdOf } from "./youtube";
import { qualitySample, scoreSummaries } from "./summary-quality";
import { readability } from "./lexicon";
import { jevCost, llmCost } from "./cost";
import { issuesToday, maxDigestOf, sourcesForPlan } from "../src/lib/plans";
import { effectivePlan } from "../src/lib/lemon";
import { sleepVerdict } from "../src/lib/sleep";

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
export async function transcribeVideos(itemIds: number[]): Promise<{ done: number; cost: number }> {
  if (itemIds.length === 0) return { done: 0, cost: 0 };

  const rows = await sql<{ id: number; url: string; title: string; label: string }[]>`
    select i.id, i.url, i.title, s.label
      from dailynews.items i
      join dailynews.sources s on s.id = i.source_id
     where i.id = any(${itemIds}::bigint[]) and i.dup_of is null
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
        noCaptions++;
        continue;
      }
      const writeup = await describeVideo(video.title, video.label, transcript.text, transcript.lang);
      await sql`
        update dailynews.items
           set excerpt = ${writeup.summary}, body = ${articleHtml(writeup.article) || null}
         where id = ${video.id}
      `;
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

/**
 * Один выпуск одного читателя. Всё, что здесь происходит, персонально:
 * отбор его весами, текст его языком, уведомление в его чат.
 *
 * Возвращает потраченное, чтобы прогон мог сказать вслух, во что обошёлся
 * день. Молчаливый расход — это счёт в конце месяца вместо строки в логе.
 */
async function runForReader(
  reader: Reader,
  day: string,
  allSources: Source[],
  shared: { collected: number; duplicates: number; scored: number },
): Promise<number> {
  const name = reader.username ? `@${reader.username}` : `читатель ${reader.id}`;

  // Спящий читатель — это выпуск каждую ночь в пустоту. Спрашиваем один раз
  // и замолкаем до ответа: молчание тоже ответ, и оно бесплатное.
  const sleep = sleepVerdict(reader, await lastActivityAt(reader.id));
  if (sleep.verdict === "wake") {
    // Отпуск кончился: возвращаем ленту сами, ничего не переспрашивая.
    await wakeReader(reader.id);
    log(`  ${name}: отпуск кончился — лента возвращается`);
  }
  if (sleep.verdict === "paused") {
    log(`  ${name}: на паузе с ${String(reader.paused_at).slice(0, 10)} — выпуск не пишем`);
    return 0;
  }
  if (sleep.verdict === "ask") {
    await pauseReader(reader.id);
    if (reader.telegram_id) {
      await askResume(Number(reader.telegram_id), sleep.silentDays);
      log(`  ${name}: молчит ${sleep.silentDays} дней — пауза, спросил в боте`);
    } else {
      log(`  ${name}: молчит ${sleep.silentDays} дней — пауза, спросить негде`);
    }
    return 0;
  }

  const plan = effectivePlan(reader);

  // Бесплатный получает ленту через день. Это честнее, чем урезать выпуск:
  // урезанный выглядит как плохой продукт, редкий — как бесплатный.
  if (!issuesToday(plan, reader.id, day)) {
    log(`  ${name}: тариф «${plan.label}» — выпуск через день, сегодня не его ночь`);
    return 0;
  }

  const topics = await getReaderTopics(reader.id);

  // Читатель без интересов пропускается, а не получает пустой выпуск:
  // пустой выпуск выглядит как «сегодня ничего не было».
  if (topics.length === 0) {
    log(`  ${name}: интересы не заданы — пропуск`);
    return 0;
  }

  // Потолок проверяется до вызовов, а не после: узнать о перерасходе
  // постфактум можно и из счёта.
  const spent = await spentToday(reader.id);
  if (spent >= reader.daily_cap_usd) {
    log(`  ${name}: потолок $${reader.daily_cap_usd} исчерпан ($${spent.toFixed(3)}) — пропуск`);
    return 0;
  }

  // Потолок тарифа поверх ползунка: digest_size мог остаться от прежнего
  // тарифа, а платит за письмо описаний владелец ключа. Тот же потолок
  // стоит на догрузке из интерфейса — иначе он обходился бы кнопкой.
  const digestSize = Math.min(reader.digest_size, maxDigestOf(plan));

  // Сколько уже лежит в сегодняшнем выпуске. Состав дописывается, а не
  // заменяется: прочитанное утром не должно исчезать из ленты. Но без этого
  // вычитания повторный прогон дописывал бы ещё digestSize материалов поверх,
  // и выпуск рос бы с каждым запуском — сорок, восемьдесят, сто двадцать.
  // Выглядело бы это как «сегодня много новостей».
  const [today] = await sql<{ taken: number }[]>`
    select count(*)::int as taken
      from dailynews.digests d
      join dailynews.digest_items di on di.digest_id = d.id
     where d.reader_id = ${reader.id} and d.day = ${day}
  `;
  const missing = digestSize - today.taken;
  if (missing <= 0) {
    log(`  ${name}: выпуск за ${day} уже полон (${today.taken} из ${digestSize}) — пропуск`);
    return 0;
  }

  const mySources = sourcesForPlan(allSources, plan).map((source) => source.id);
  const survivors = await selectSurvivors(
    sql, reader.id, reader.weights, targetsOf(topics), missing, mySources,
  );
  if (survivors.length === 0) {
    log(`  ${name}: свежих материалов нет — пропуск`);
    return 0;
  }

  // Картинка — свойство материала, а не читателя: качаем только те,
  // которых ещё нет. Иначе один и тот же материал у двадцати читателей
  // означал бы двадцать запросов к изданию за одной и той же картинкой.
  // Каст обязателен: нетипизированный массив уходит в int, а id — bigint.
  const needImage = await sql<{ id: number; url: string }[]>`
    select id, url from dailynews.items
     where id = any(${survivors.map((s) => s.id)}::bigint[]) and image_url is null
  `;
  await enrichImages(needImage, async (id, image) => {
    await sql`update dailynews.items set image_url = ${image} where id = ${id}`;
  });

  const digest = await writeDigest(survivors, reader.reader_context, {
    language: reader.language,
    complexity: reader.complexity,
    style: reader.style,
  });
  const digestCost = llmCost(digest.usage);
  await recordCall({
    readerId: reader.id, stage: "digest", model: digest.model,
    tokensIn: digest.usage.input, tokensOut: digest.usage.output, costUsd: digestCost,
  });

  // Вторая петля Jev: тот же инструмент оценивает не входящий поток,
  // а собственный выход. Правка промпта либо улучшает ряд чисел, либо нет —
  // на глаз двенадцать описаний в день всегда читаются нормально.
  //
  // Меряем у одного читателя и по выборке: промпт один на всех, и сотня
  // описаний у каждого — это один и тот же ответ, оплаченный столько раз,
  // сколько у нас читателей. Ряд по дням от этого не страдает, а вход
  // петли дороже входа самого дайджеста: 3170 токенов на описание против 527.
  const measuresQuality = reader.owner;
  const quality = measuresQuality
    ? await scoreSummaries(
        qualitySample(digest.items).map((item: (typeof digest.items)[number]) => ({
          id: Number(item.id), title: item.title_ru, summary: item.summary,
        })),
        reader.reader_context,
      )
    : null;
  const qualityCost = quality ? jevCost(quality.inputTokens) : 0;
  if (quality) {
    await recordCall({
      readerId: reader.id, stage: "summary", model: quality.model,
      tokensIn: quality.inputTokens, costUsd: qualityCost,
    });
  }

  // Ноль сюда писать нельзя: он неотличим от настоящего нуля и утянул бы
  // ряд вниз у всех, кому замер не делался.
  const meanQuality = quality?.scored.length
    ? quality.scored.reduce((sum, row) => sum + row.total, 0) / quality.scored.length
    : null;

  // Ползунок сложности меняет промпт — а меняется ли текст, видно только
  // по ряду этих двух чисел рядом с положением ползунка.
  const measured = digest.items.map((item) => readability(item.summary));
  const mean = (pick: (r: { perSentence: number; longShare: number }) => number) =>
    measured.length ? measured.reduce((sum, r) => sum + pick(r), 0) / measured.length : 0;
  const perSentence = mean((r) => r.perSentence);
  const longShare = mean((r) => r.longShare);

  const [row] = await sql<{ id: number }[]>`
    insert into dailynews.digests (reader_id, day, intro, stats)
    values (
      ${reader.id}, ${day}, ${digest.intro},
      ${sql.json({
        ...shared,
        flagged: digest.flagged ?? 0,
        summary_quality: meanQuality === null ? null : Number(meanQuality.toFixed(1)),
        complexity: reader.complexity,
        plan: plan.id,
        words_per_sentence: Number(perSentence.toFixed(1)),
        long_word_share: Number(longShare.toFixed(3)),
        // Что на самом деле ушло в провайдера: модель выводит writeDigest,
        // своя копия резолюции разошлась бы с ней на пустой строке.
        digest_model: digest.model,
        digest_input_tokens: digest.usage.input,
        digest_cached_tokens: digest.usage.cached,
        digest_output_tokens: digest.usage.output,
        digest_reasoning_tokens: digest.usage.reasoning,
        digest_reasoning_effort: digest.reasoningEffort,
        jev_input_tokens: quality?.inputTokens ?? 0,
        cost_usd: Number((digestCost + qualityCost).toFixed(5)),
        // Объект, а не JSON.stringify: лишний stringify кладёт в jsonb
        // строку, и stats->>'cost_usd' молча возвращает null.
      } as unknown as Parameters<typeof sql.json>[0])}
    )
    on conflict (reader_id, day) do update set intro = excluded.intro, stats = excluded.stats
    returning id::int as id
  `;

  const [{ taken }] = await sql<{ taken: number }[]>`
    select count(*)::int as taken from dailynews.digest_items where digest_id = ${row.id}
  `;

  const writtenById = new Map(digest.items.map((item) => [String(item.id), item]));
  const qualityById = new Map((quality?.scored ?? []).map((q) => [String(q.item_id), q]));

  for (const [index, survivor] of survivors.entries()) {
    const written = writtenById.get(String(survivor.id));
    const scored = qualityById.get(String(survivor.id));
    // Текст пишется сюда, а не в items: язык, сложность и манера персональны,
    // и общая колонка означала бы, что второй читатель переписывает ленту
    // первого своим языком.
    await sql`
      insert into dailynews.digest_items
        (digest_id, item_id, total, position, title, summary, summary_axes, summary_score)
      values (
        ${row.id}, ${survivor.id}, ${survivor.total}, ${taken + index + 1},
        ${written?.title_ru ?? survivor.title}, ${written?.summary ?? ""},
        ${scored ? sql.json(scored.axes as unknown as Parameters<typeof sql.json>[0]) : null},
        ${scored?.total ?? null}
      )
      on conflict (digest_id, item_id) do nothing
    `;
  }

  log(
    `  ${name}: ${survivors.length} материалов, ` +
    (meanQuality === null
      ? "качество не меряли (промпт один на всех), "
      : `качество ${meanQuality.toFixed(0)} из 85 по ${quality?.scored.length} описаниям, `) +
    `${perSentence.toFixed(1)} слов в предложении (ползунок ${reader.complexity} из 5), ` +
    `$${(digestCost + qualityCost).toFixed(4)}`,
  );
  // Рассуждение тарифицируется как выход и в ответ не попадает: без этой
  // строки главная статья счёта выглядит как длинный текст.
  log(
    `    ${digest.usage.requests} запроса, ${digest.usage.input} вх ` +
    `(${digest.usage.cached} из кэша), ${digest.usage.output} вых ` +
    `(${digest.usage.reasoning} рассуждение)`,
  );

  await deliver(reader, day, digest.intro, survivors, writtenById, name);
  return digestCost + qualityCost;
}

/** Доставка: ссылка в Telegram и, если подключён, выпуск книгой в Kindle. */
async function deliver(
  reader: Reader,
  day: string,
  intro: string,
  survivors: Survivor[],
  writtenById: Map<string, { title_ru: string; summary: string }>,
  name: string,
): Promise<void> {
  const titleOf = (s: Survivor) => writtenById.get(String(s.id))?.title_ru ?? s.title;

  // Без явного адреса уведомление не отправляется. Дефолтный домен —
  // худший вид ошибки: он выглядит правдоподобно, почти наверняка занят
  // чужим сайтом, и ссылка «Читать» молча уводит читателя туда.
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) {
    log("  APP_URL не задан — уведомления пропущены, выпуски сохранены");
  } else if (!reader.telegram_id) {
    // Молчаливый пропуск здесь неотличим от доставки: выпуск в базе есть,
    // ошибок нет, а читатель о нём не знает.
    log(`  ${name}: Telegram не привязан — уведомление пропущено`);
  } else {
    try {
      await notify(
        Number(reader.telegram_id), day, intro,
        survivors.map((s) => ({ title: titleOf(s), topic: s.topic_label })),
        appUrl,
      );
      await sql`
        update dailynews.digests set sent_at = now()
         where reader_id = ${reader.id} and day = ${day}
      `;
    } catch (error) {
      // Заблокировавший бота читатель не должен ронять прогон остальных.
      log(`  ${name}: Telegram — ${(error as Error).message}`);
    }
  }

  const kindle = kindleDigestVerdict(reader);
  if (!kindle.send) {
    // Пустой адрес — читатель не просил, говорить не о чем. Остальные две
    // причины он должен увидеть: одна сбой, другая его собственный выбор.
    if (kindle.reason === "no-sender") {
      log(`  ${name}: Kindle — обратный адрес не выдан, отправка пропущена`);
    } else if (kindle.reason === "switched-off") {
      log(`  ${name}: Kindle — выпуск выключен в настройках`);
    }
    return;
  }
  try {
    const sent = await sendToKindle({
      to: kindle.to,
      sender: kindle.sender,
      day,
      intro,
      articles: survivors.map((s) => ({
        title: titleOf(s),
        summary: writtenById.get(String(s.id))?.summary ?? s.excerpt,
        url: s.url,
        source_label: s.source_label,
        topic_label: s.topic_label,
      })),
    });
    log(sent ? `  ${name}: Kindle отправлен` : `  ${name}: RESEND_API_KEY не задан — Kindle пропущен`);
  } catch (error) {
    log(`  ${name}: Kindle — ${(error as Error).message}`);
  }
}

/**
 * Спросить про вчерашние отправки на читалку: дочитал или не пошло.
 *
 * Отправка — единственная часть продукта без петли измерения. Отбор
 * калибруется открытиями, описания — шестью осями Jev, а про книгу
 * на читалке никто не знает ничего: Amazon обратно не говорит и не может.
 *
 * Спрашиваем на следующий день, а не в тот же вечер: вечером он её
 * и читает. Один вопрос на статью — повторно уже спрошенное не трогаем,
 * иначе бот превращается в напоминалку, которую выключают.
 */
async function askAboutYesterday(reader: Reader): Promise<void> {
  if (!reader.telegram_id) return;

  const pending = await sql<{ item_id: number; title: string }[]>`
    select ks.item_id, coalesce(i.title_ru, i.title) as title
      from dailynews.kindle_sends ks
      join dailynews.items i on i.id = ks.item_id
     where ks.reader_id = ${reader.id}
       and ks.status = 'sent'
       and ks.at < now() - interval '12 hours'
       and ks.at > now() - interval '7 days'
       and not exists (
         select 1 from dailynews.reads r
          where r.reader_id = ks.reader_id and r.item_id = ks.item_id
            and r.event in ('finished', 'unfinished')
       )
     order by ks.at
     limit 3
  `;

  for (const row of pending) {
    try {
      await askFinished(Number(reader.telegram_id), row.item_id, row.title);
    } catch (error) {
      // Заблокировавший бота читатель не должен ронять прогон остальных.
      log(`  читатель ${reader.id}: вопрос о дочитывании — ${(error as Error).message}`);
    }
  }
}

async function main() {
  const started = Date.now();
  const day = new Date().toISOString().slice(0, 10);

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
    for (const source of sourcesForPlan(all, effectivePlan(reader))) allowed.set(source.id, source);
  }
  const sources = [...allowed.values()].sort((a, b) => a.id - b.id);
  if (sources.length < all.length) {
    log(`   тарифы читателей: опрашиваем ${sources.length} из ${all.length} включённых`);
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

  const videos = await transcribeVideos(collected);
  if (videos.done > 0) {
    log(`   расшифровано роликов: ${videos.done} (${videos.cost.toFixed(3)} $)`);
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
  const duplicates = await markDuplicates(sql, pending_dedup.map((row) => row.id));
  log(`   помечено дублей: ${duplicates}`);

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

  log(`4. Выпуски: ${readers.length} читателей`);
  let personal = 0;
  for (const reader of readers) {
    try {
      personal += await runForReader(reader, day, all, {
        collected: collected.length, duplicates, scored: scored.length,
      });
      await askAboutYesterday(reader);
    } catch (error) {
      // Один упавший читатель не должен оставить без выпуска остальных.
      console.error(`  ! читатель ${reader.id}: ${(error as Error).message}`);
    }
  }

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
