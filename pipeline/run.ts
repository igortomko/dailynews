import { sql } from "../src/lib/db";
import type { Profile, Source, Topic } from "../src/lib/types";
import { fetchAllSources } from "./fetch";
import { canonUrl, normalizeTitle } from "./normalize";
import { markDuplicates } from "./dedup";
import { scoreAll, type Scorable } from "./score";
import { writeDigest, type Survivor } from "./digest";
import { notify } from "./telegram";
import { enrichImages } from "./og";

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
  // Отбор по чистому скору отдаёт дайджест самой плодовитой теме: источники
  // по энергетике дают вчетверо больше материалов, чем по демографии, и все
  // они честно совпадают со своей темой. Поэтому берём по кругу — сначала
  // лучшее в каждой теме, потом вторые по каждой. Читателю нужны направления,
  // а вкладки и так позволяют уйти вглубь одной темы.
  // ponytail: жёсткий круг; если у темы сегодня пусто, её место просто уходит
  // следующей по скору — при необходимости добавить порог качества.
  const survivors = await sql<Survivor[]>`
    with ranked as (
      select i.id, i.title, i.excerpt, i.url, s.label as source_label,
             coalesce(t.label, 'Прочее') as topic_label,
             sc.total, sc.axes,
             row_number() over (
               partition by sc.topic_id order by sc.total desc
             ) as rank_in_topic
        from dailynews.scores sc
        join dailynews.items i on i.id = sc.item_id
        join dailynews.sources s on s.id = i.source_id
   left join dailynews.topics t on t.id = sc.topic_id
       where i.dup_of is null
         and not exists (
           select 1 from dailynews.digests d where i.id = any(d.item_ids)
         )
    )
    select id, title, excerpt, url, source_label, topic_label, total, axes
      from ranked
     order by rank_in_topic asc, total desc
     limit ${profile.digest_size}
  `;
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
      ${sql.json({
        collected: collected.length,
        duplicates,
        scored: scored.length,
        jev_input_tokens: usage.input,
        jev_cost_usd: Number(jevCost.toFixed(5)),
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
  const appUrl = process.env.APP_URL;
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
