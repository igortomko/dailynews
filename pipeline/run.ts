import { sql } from "../src/lib/db";
import type { Profile, Source, Topic } from "../src/lib/types";
import { fetchAllSources } from "./fetch";
import { canonUrl, normalizeTitle } from "./normalize";
import { markDuplicates } from "./dedup";
import { scoreAll, type Scorable } from "./score";
import { writeDigest } from "./digest";
import { selectSurvivors } from "./select";
import { notify } from "./telegram";
import { enrichImages } from "./og";
import { scoreSummaries } from "./summary-quality";
import { readability } from "./lexicon";
import { DEFAULT_COMPLEXITY, DEFAULT_STYLE } from "../src/lib/voice";
import { maxDigestOf, planOf, sourcesForPlan } from "../src/lib/plans";

/** Цена Jev, $ за миллион токенов. Выход не тарифицируется. */
const JEV_INPUT_PRICE = 0.042;
/** Сколько дней назад ещё имеет смысл оценивать собранное. */
const SCORE_WINDOW_DAYS = 2;

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
    await sql`
      update dailynews.sources
         set last_ok_at = now(), last_count = ${result.items.length}, last_error = null
       where id = ${result.source.id}
    `;

    for (const item of result.items) {
      // on conflict по url_canon — первый слой дедупа, он же защита от
      // повторного прогона в тот же день.
      const rows = await sql<{ id: number }[]>`
        insert into dailynews.items
          (source_id, url, url_canon, title, title_norm, excerpt, points, comments, published_at)
        values (
          ${result.source.id}, ${item.url}, ${canonUrl(item.url)}, ${item.title},
          ${normalizeTitle(item.title)}, ${item.excerpt},
          ${item.points}, ${item.comments}, ${item.published_at}
        )
        on conflict (url_canon) do nothing
        returning id
      `;
      if (rows[0]) inserted.push(rows[0].id);
    }
  }
  return inserted;
}

async function main() {
  const started = Date.now();
  const day = new Date().toISOString().slice(0, 10);

  const [profile] = await sql<Profile[]>`select * from dailynews.profile where id = 1`;
  const topics = await sql<Topic[]>`
    select * from dailynews.topics where active order by position, id
  `;
  const all = await sql<Source[]>`select * from dailynews.sources where active order by id`;
  // Тариф решает не только форма настроек: понижение оставляет лишние
  // источники включёнными в каталоге, и опрашивать их всё равно нельзя —
  // X платный, и счёт приходит за сбор, а не за галочку в интерфейсе.
  const plan = planOf(profile.plan);
  const sources = sourcesForPlan(all, plan);
  if (sources.length < all.length) {
    log(`   тариф «${plan.label}»: опрашиваем ${sources.length} из ${all.length} включённых`);
  }

  if (topics.length === 0) {
    log("Интересы не заданы — пройди онбординг. Прогон отменён.");
    await sql.end();
    process.exit(1);
  }

  log(`1. Сбор: ${sources.length} источников`);
  const collected = await collect(sources);
  log(`   новых материалов: ${collected.length}`);

  log("2. Дедуп");
  // Берём всё окно, а не результат вставки: если прогон упал между
  // вставкой и дедупом, по свежим id эти материалы больше никогда
  // не проверятся. Повторная пометка — no-op, так что это безопасно.
  const pending_dedup = await sql<{ id: number }[]>`
    select id from dailynews.items
     where dup_of is null
       and collected_at > now() - ${`${SCORE_WINDOW_DAYS} days`}::interval
  `;
  const duplicates = await markDuplicates(sql, pending_dedup.map((row) => row.id));
  log(`   помечено дублей: ${duplicates}`);

  log("3. Скоринг Jev — весь поток, не выборка");
  const pending = await sql<Scorable[]>`
    select i.id, i.title, i.excerpt, s.label as source_label,
           i.points, i.comments, i.published_at
      from dailynews.items i
      join dailynews.sources s on s.id = i.source_id
     where i.dup_of is null
       and i.collected_at > now() - ${`${SCORE_WINDOW_DAYS} days`}::interval
       and not exists (select 1 from dailynews.scores sc where sc.item_id = i.id)
     order by i.id
  `;
  log(`   к оценке: ${pending.length}`);

  const { scored, usage, model } = await scoreAll(
    pending,
    topics,
    profile.reader_context,
    profile.weights,
    (done, total) => {
      if (done % 25 === 0 || done === total) log(`   ${done}/${total}`);
    },
  );

  const topicIdBySlug = new Map(topics.map((t) => [t.slug, t.id]));
  for (const row of scored) {
    await sql`
      insert into dailynews.scores (item_id, topic_id, total, confidence, axes, model)
      values (
        ${row.item_id}, ${topicIdBySlug.get(row.topic_slug) ?? null},
        ${row.total}, ${row.confidence},
        -- Объект, а не JSON.stringify: драйвер сериализует сам, и лишний
        -- stringify кладёт в jsonb строку вместо объекта. Тогда axes->'kind'
        -- молча возвращает null, и ломается вся калибровка по осям.
        ${sql.json(row.axes as unknown as Parameters<typeof sql.json>[0])}, ${model}
      )
      on conflict (item_id) do nothing
    `;
  }
  const jevCost = (usage.input / 1e6) * JEV_INPUT_PRICE;
  log(`   оценено: ${scored.length}, токенов: ${usage.input}, $${jevCost.toFixed(4)}`);

  log("4. Отбор: код сортирует по составному скору");
  // Взвешенный круг по темам: сколько мест берёт тема, решает её вес.
  // Запрос вынесен в select.ts, чтобы db/verify.ts гонял ровно его,
  // а не свою копию: перекос в дележе мест — это правильный на вид
  // дайджест не о том, и на глаз он неотличим от верного.
  const digestSize = Math.min(profile.digest_size, maxDigestOf(plan));
  const survivors = await selectSurvivors(sql, digestSize);
  log(`   отобрано: ${survivors.length} из ${pending.length}`);

  if (survivors.length === 0) {
    log("Нечего слать — дайджест не создан.");
    await sql.end();
    return;
  }

  // Картинки тянем только для выживших: двенадцать запросов вместо трёхсот.
  const withImages = await enrichImages(
    survivors.map((s) => ({ id: s.id, url: s.url })),
    async (id, image) => {
      await sql`update dailynews.items set image_url = ${image} where id = ${id}`;
    },
  );
  log(`   иллюстраций найдено: ${withImages} из ${survivors.length}`);

  log(`5. Дайджест: модель видит ${survivors.length} материалов вместо ${pending.length}`);
  const digest = await writeDigest(survivors, profile.reader_context, profile.llm ?? {}, {
    language: profile.language ?? "русском",
    complexity: profile.complexity ?? DEFAULT_COMPLEXITY,
    style: profile.style ?? DEFAULT_STYLE,
  });
  for (const item of digest.items) {
    await sql`
      update dailynews.items
         set title_ru = ${item.title_ru}, summary = ${item.summary}
       where id = ${item.id}
    `;
  }

  // Вторая петля Jev: тот же инструмент оценивает не входящий поток,
  // а собственный выход. Правка промпта либо улучшает ряд чисел, либо нет —
  // на глаз двенадцать описаний в день всегда читаются нормально.
  const quality = await scoreSummaries(
    digest.items.map((item) => ({
      id: Number(item.id), title: item.title_ru, summary: item.summary,
    })),
    profile.reader_context,
  );
  for (const row of quality.scored) {
    await sql`
      update dailynews.items
         set summary_axes = ${sql.json(row.axes as unknown as Parameters<typeof sql.json>[0])},
             summary_score = ${row.total}
       where id = ${row.item_id}
    `;
  }
  const meanQuality = quality.scored.length
    ? quality.scored.reduce((sum, row) => sum + row.total, 0) / quality.scored.length
    : 0;
  log(`   качество описаний: ${meanQuality.toFixed(0)} из 85 по ${quality.scored.length}`);
  log(
    `   дайджест: ${digest.usage.requests} запроса, ` +
    `${digest.usage.input} вх (${digest.usage.cached} из кэша), ` +
    `${digest.usage.output} вых (${digest.usage.reasoning} рассуждение)`,
  );

  // Ползунок сложности меняет промпт — а меняется ли текст, видно только
  // по ряду этих двух чисел рядом с положением ползунка.
  const measured = digest.items.map((item) => readability(item.summary));
  const mean = (pick: (r: { perSentence: number; longShare: number }) => number) =>
    measured.length ? measured.reduce((sum, r) => sum + pick(r), 0) / measured.length : 0;
  const perSentence = mean((r) => r.perSentence);
  const longShare = mean((r) => r.longShare);
  log(
    `   сложность текста: ${perSentence.toFixed(1)} слов в предложении, ` +
    `${(longShare * 100).toFixed(0)}% длинных (ползунок ${profile.complexity ?? DEFAULT_COMPLEXITY} из 5)`,
  );

  const order = survivors.map((s) => s.id);
  await sql`
    insert into dailynews.digests (day, intro, item_ids, stats)
    values (
      ${day}, ${digest.intro}, ${order},
      ${sql.json({
        collected: collected.length,
        duplicates,
        scored: scored.length,
        jev_input_tokens: usage.input,
        jev_cost_usd: Number(jevCost.toFixed(5)),
        digest_model: digest.model,
        digest_input_tokens: digest.usage.input,
        digest_cached_tokens: digest.usage.cached,
        digest_output_tokens: digest.usage.output,
        digest_reasoning_tokens: digest.usage.reasoning,
        digest_reasoning_effort: digest.reasoningEffort,
        flagged: digest.flagged ?? 0,
        summary_quality: Number(meanQuality.toFixed(1)),
        complexity: profile.complexity ?? DEFAULT_COMPLEXITY,
        words_per_sentence: Number(perSentence.toFixed(1)),
        long_word_share: Number(longShare.toFixed(3)),
        seconds: Math.round((Date.now() - started) / 1000),
        // Объект, а не JSON.stringify: лишний stringify кладёт в jsonb
        // строку, и stats->>'jev_cost_usd' молча возвращает null.
      } as unknown as Parameters<typeof sql.json>[0])}
    )
    on conflict (day) do update
      set intro = excluded.intro, item_ids = excluded.item_ids, stats = excluded.stats
  `;

  log("6. Telegram");
  // Без явного адреса уведомление не отправляется. Дефолтный домен —
  // худший вид ошибки: он выглядит правдоподобно, почти наверняка занят
  // чужим сайтом, и ссылка «Читать» молча уводит читателя туда.
  const appUrl = process.env.APP_URL?.trim() || undefined;
  if (!appUrl) {
    log("   APP_URL не задан — уведомление пропущено, дайджест сохранён");
    await sql.end();
    return;
  }
  const titleById = new Map(digest.items.map((i) => [i.id, i.title_ru]));
  await notify(
    day,
    digest.intro,
    survivors.map((s) => ({ title: titleById.get(s.id) ?? s.title, topic: s.topic_label })),
    appUrl,
  );
  await sql`update dailynews.digests set sent_at = now() where day = ${day}`;

  log(`Готово за ${Math.round((Date.now() - started) / 1000)} с`);
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
