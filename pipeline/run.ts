import { sql } from "../src/lib/db";
import type { Profile, Source, Topic } from "../src/lib/types";
import { fetchAllSources } from "./fetch";
import { canonUrl, normalizeTitle } from "./normalize";
import { markDuplicates } from "./dedup";
import { scoreAll, type Scorable } from "./score";
import { writeDigest, type Survivor } from "./digest";
import { notify } from "./telegram";

/** Цена Jev, $ за миллион токенов. Выход не тарифицируется. */
const JEV_INPUT_PRICE = 0.042;
/** Сколько дней назад ещё имеет смысл оценивать собранное. */
const SCORE_WINDOW_DAYS = 2;

const log = (msg: string) => console.log(msg);

async function collect(sources: Source[]): Promise<number[]> {
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
  const sources = await sql<Source[]>`select * from dailynews.sources where active order by id`;

  if (topics.length === 0) {
    log("Интересы не заданы — пройди онбординг. Прогон отменён.");
    await sql.end();
    process.exit(1);
  }

  log(`1. Сбор: ${sources.length} источников`);
  const collected = await collect(sources);
  log(`   новых материалов: ${collected.length}`);

  log("2. Дедуп");
  const duplicates = await markDuplicates(sql, collected);
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
        ${row.total}, ${row.confidence}, ${JSON.stringify(row.axes)}, ${model}
      )
      on conflict (item_id) do nothing
    `;
  }
  const jevCost = (usage.input / 1e6) * JEV_INPUT_PRICE;
  log(`   оценено: ${scored.length}, токенов: ${usage.input}, $${jevCost.toFixed(4)}`);

  log("4. Отбор: код сортирует по составному скору");
  const survivors = await sql<Survivor[]>`
    select i.id, i.title, i.excerpt, i.url, s.label as source_label,
           coalesce(t.label, 'Прочее') as topic_label,
           sc.total, sc.axes
      from dailynews.scores sc
      join dailynews.items i on i.id = sc.item_id
      join dailynews.sources s on s.id = i.source_id
 left join dailynews.topics t on t.id = sc.topic_id
     where i.dup_of is null
       and not exists (
         select 1 from dailynews.digests d where i.id = any(d.item_ids)
       )
     order by sc.total desc
     limit ${profile.digest_size}
  `;
  log(`   отобрано: ${survivors.length} из ${pending.length}`);

  if (survivors.length === 0) {
    log("Нечего слать — дайджест не создан.");
    await sql.end();
    return;
  }

  log(`5. Дайджест: модель видит ${survivors.length} материалов вместо ${pending.length}`);
  const digest = await writeDigest(survivors, profile.reader_context);
  for (const item of digest.items) {
    await sql`
      update dailynews.items
         set title_ru = ${item.title_ru}, summary = ${item.summary}
       where id = ${item.id}
    `;
  }

  const order = survivors.map((s) => s.id);
  await sql`
    insert into dailynews.digests (day, intro, item_ids, stats)
    values (
      ${day}, ${digest.intro}, ${order},
      ${JSON.stringify({
        collected: collected.length,
        duplicates,
        scored: scored.length,
        jev_input_tokens: usage.input,
        jev_cost_usd: Number(jevCost.toFixed(5)),
        seconds: Math.round((Date.now() - started) / 1000),
      })}
    )
    on conflict (day) do update
      set intro = excluded.intro, item_ids = excluded.item_ids, stats = excluded.stats
  `;

  log("6. Telegram");
  const titleById = new Map(digest.items.map((i) => [i.id, i.title_ru]));
  await notify(
    day,
    digest.intro,
    survivors.map((s) => ({ title: titleById.get(s.id) ?? s.title, topic: s.topic_label })),
    process.env.APP_URL ?? "https://dailynews.vercel.app",
  );
  await sql`update dailynews.digests set sent_at = now() where day = ${day}`;

  log(`Готово за ${Math.round((Date.now() - started) / 1000)} с`);
  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
