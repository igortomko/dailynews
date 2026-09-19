import "server-only";
import { sql } from "./db";
import type { Axes, Profile, Source, Topic } from "./types";

/** Сколько дней ленты показывать во вкладках. */
const FEED_DAYS = 14;

export type FeedItem = {
  id: number;
  url: string;
  title: string;
  title_ru: string | null;
  summary: string | null;
  image_url: string | null;
  source_label: string;
  topic_slug: string | null;
  topic_label: string | null;
  total: number;
  confidence: number;
  axes: Axes;
  day: string;
  read_count: number;
};

export async function getProfile(): Promise<Profile> {
  const [profile] = await sql<Profile[]>`select * from dailynews.profile where id = 1`;
  return profile;
}

export async function getTopics(): Promise<Topic[]> {
  return sql<Topic[]>`select * from dailynews.topics where active order by position, id`;
}

export async function getAllTopics(): Promise<Topic[]> {
  return sql<Topic[]>`select * from dailynews.topics order by position, id`;
}

export async function getSources(): Promise<Source[]> {
  return sql<Source[]>`select * from dailynews.sources order by kind, label`;
}

/**
 * Лента: только то, что дошло до дайджеста. Весь остальной поток остаётся
 * в items — он нужен калибровке и дедупу, но показывать его незачем,
 * иначе отбор теряет смысл.
 */
export async function getFeed(): Promise<FeedItem[]> {
  const rows = await sql<FeedItem[]>`
    select i.id, i.url, i.title, i.title_ru, i.summary, i.image_url,
           s.label as source_label,
           t.slug as topic_slug, t.label as topic_label,
           sc.total, sc.confidence, sc.axes,
           d.day::text as day,
           (select count(*)::int from dailynews.reads r
             where r.item_id = i.id and r.event in ('opened', 'outbound')) as read_count
      from dailynews.digests d
      cross join lateral unnest(d.item_ids) with ordinality as u(item_id, ord)
      join dailynews.items i on i.id = u.item_id
      join dailynews.scores sc on sc.item_id = i.id
      join dailynews.sources s on s.id = i.source_id
 left join dailynews.topics t on t.id = sc.topic_id
     -- Каст обязателен: у нетипизированного параметра Postgres выбирает
     -- date - date -> integer вместо date - integer -> date.
     where d.day > current_date - ${FEED_DAYS}::int
     order by d.day desc, sc.total desc
  `;

  // Драйвер разбирает jsonb сам, но не во всех формах запроса отдаёт
  // ожидаемый OID колонки. Если axes придёт строкой, карточка молча
  // покажет прочерк вместо каждого бейджа — отказ, который не заметен.
  return rows.map((row) => ({
    ...row,
    axes: typeof row.axes === "string" ? JSON.parse(row.axes) : row.axes,
  }));
}

export type CalibrationRow = {
  bucket: string;
  shown: number;
  opened: number;
  open_rate: number;
};

/**
 * Калибровка: сравнение того, что система считала важным, с тем, что
 * действительно открывали. Высокий скор без открытий означает, что ось
 * подобрана неверно, а не что читатель ленивый.
 */
export async function getCalibration(): Promise<{
  byScore: CalibrationRow[];
  byConfidence: CalibrationRow[];
  byAxis: { axis: string; value: string; shown: number; opened: number; open_rate: number }[];
  totals: { shown: number; opened: number; days: number };
}> {
  const shown = sql`
    select i.id, sc.total, sc.confidence, sc.axes,
           exists (
             select 1 from dailynews.reads r
              where r.item_id = i.id and r.event in ('opened', 'outbound')
           ) as was_opened
      from dailynews.digests d
      cross join lateral unnest(d.item_ids) as u(item_id)
      join dailynews.items i on i.id = u.item_id
      join dailynews.scores sc on sc.item_id = i.id
  `;

  const byScore = await sql<CalibrationRow[]>`
    with shown as (${shown})
    select width_bucket(total, 0, 140, 7)::text as bucket,
           count(*)::int as shown,
           count(*) filter (where was_opened)::int as opened,
           round(avg(case when was_opened then 1 else 0 end)::numeric, 3)::float as open_rate
      from shown group by 1 order by 1
  `;

  const byConfidence = await sql<CalibrationRow[]>`
    with shown as (${shown})
    select width_bucket(confidence, 0, 1, 5)::text as bucket,
           count(*)::int as shown,
           count(*) filter (where was_opened)::int as opened,
           round(avg(case when was_opened then 1 else 0 end)::numeric, 3)::float as open_rate
      from shown group by 1 order by 1
  `;

  const byAxis = await sql<{ axis: string; value: string; shown: number; opened: number; open_rate: number }[]>`
    with shown as (${shown}),
    unpacked as (
      select 'тип' as axis, axes->'kind'->>'choice' as value, was_opened from shown
      union all
      select 'горизонт', axes->'horizon'->>'choice', was_opened from shown
      union all
      select 'тема', axes->'topic'->>'choice', was_opened from shown
      union all
      select 'новизна', round((axes->'novelty'->>'score')::numeric, 0)::text, was_opened from shown
      union all
      select 'конкретика', round((axes->'specifics'->>'score')::numeric, 0)::text, was_opened from shown
    )
    select axis, value,
           count(*)::int as shown,
           count(*) filter (where was_opened)::int as opened,
           round(avg(case when was_opened then 1 else 0 end)::numeric, 3)::float as open_rate
      from unpacked
     where value is not null
     group by axis, value
    having count(*) >= 3
     order by axis, open_rate desc
  `;

  const [totals] = await sql<{ shown: number; opened: number; days: number }[]>`
    with shown as (${shown})
    select count(*)::int as shown,
           count(*) filter (where was_opened)::int as opened,
           (select count(*)::int from dailynews.digests) as days
      from shown
  `;

  return { byScore, byConfidence, byAxis, totals };
}
