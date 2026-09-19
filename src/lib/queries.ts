import "server-only";
import { sql } from "./db";
import type { Axes, Source } from "./types";

/**
 * Запросы ленты. У каждого первым аргументом идёт читатель, и это не
 * формальность: запрос без reader_id в общей базе отдаёт чужой выпуск —
 * вовремя, без ошибок и совершенно не тот.
 *
 * Обязательный параметр, а не «текущий читатель» внутри: забыть передать
 * его нельзя, компилятор не даст. Внутри бы забылось однажды и молча.
 */
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

export async function getSources(): Promise<Source[]> {
  return sql<Source[]>`select * from dailynews.sources order by kind, label`;
}

/** Дни, за которые у этого читателя есть выпуск, от свежего к старому. */
export async function getDigestDays(readerId: number): Promise<string[]> {
  const rows = await sql<{ day: string }[]>`
    select day::text as day from dailynews.digests
     where reader_id = ${readerId}
     order by day desc limit 90
  `;
  return rows.map((row) => row.day);
}

/**
 * Лента: только то, что дошло до дайджеста этого читателя. Весь остальной
 * поток остаётся в items — он нужен калибровке и дедупу, но показывать его
 * незачем, иначе отбор теряет смысл.
 *
 * Заголовок и описание берутся из digest_items, а не из items: они написаны
 * языком, сложностью и манерой этого читателя.
 */
export async function getFeed(readerId: number, day: string): Promise<FeedItem[]> {
  const rows = await sql<FeedItem[]>`
    select i.id, i.url, i.title, di.title as title_ru, di.summary, i.image_url,
           s.label as source_label,
           t.slug as topic_slug, t.label as topic_label,
           di.total, sc.confidence, sc.axes,
           d.day::text as day,
           (select count(*)::int from dailynews.reads r
             where r.item_id = i.id and r.reader_id = ${readerId}
               and r.event in ('opened', 'outbound')) as read_count
      from dailynews.digests d
      join dailynews.digest_items di on di.digest_id = d.id
      join dailynews.items i on i.id = di.item_id
      join dailynews.scores sc on sc.item_id = i.id
      join dailynews.sources s on s.id = i.source_id
 left join dailynews.topics t on t.id = sc.topic_id
     -- Каст обязателен: у нетипизированного параметра Postgres выбирает
     -- date - date -> integer вместо date - integer -> date.
     -- Один день, а не окно: лента листается датами, и смешивать выпуски
     -- значит показывать вчерашнее как сегодняшнее.
     where d.reader_id = ${readerId}
       and d.day = ${day}::date
       -- Скрытое рукой не возвращается: иначе палец вниз означал бы
       -- «скрыть до перезагрузки страницы».
       and not exists (
         select 1 from dailynews.reads r
          where r.item_id = i.id and r.reader_id = ${readerId} and r.event = 'down'
       )
     order by di.total desc
  `;

  // Драйвер разбирает jsonb сам, но не во всех формах запроса отдаёт
  // ожидаемый OID колонки. Если axes придёт строкой, карточка молча
  // покажет прочерк вместо каждого бейджа — отказ, который не заметен.
  return rows.map((row) => ({
    ...row,
    axes: typeof row.axes === "string" ? JSON.parse(row.axes) : row.axes,
  }));
}

export type SummaryQualityRow = {
  day: string;
  items: number;
  mean: number;
  repeats: number;
  relevant: number;
  evaluative: number;
};

/**
 * Качество описаний по дням. Смысл не в отдельном числе, а в ряду:
 * правка промпта либо двигает его, либо нет, и на глаз это не видно —
 * двенадцать описаний в день всегда читаются нормально.
 */
export async function getSummaryQuality(readerId: number): Promise<SummaryQualityRow[]> {
  return sql<SummaryQualityRow[]>`
    select d.day::text as day,
           count(*)::int as items,
           round(avg(di.summary_score)::numeric, 1)::float as mean,
           count(*) filter (where (di.summary_axes->'repeats_headline'->>'noul')::float > 0.5)::int as repeats,
           count(*) filter (where (di.summary_axes->'reader_relevance'->>'noul')::float > 0.5)::int as relevant,
           count(*) filter (where (di.summary_axes->'evaluative'->>'noul')::float > 0.5)::int as evaluative
      from dailynews.digests d
      join dailynews.digest_items di on di.digest_id = d.id
     where d.reader_id = ${readerId}
       and di.summary_score is not null
     group by d.day
     order by d.day desc
     limit 21
  `;
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
 *
 * Скор берётся из digest_items — снимок на момент отбора его весами.
 * Взять текущий было бы сравнением с числом, которого читатель не видел.
 */
export async function getCalibration(readerId: number): Promise<{
  byScore: CalibrationRow[];
  byConfidence: CalibrationRow[];
  byAxis: { axis: string; value: string; shown: number; opened: number; open_rate: number }[];
  totals: { shown: number; opened: number; days: number };
}> {
  const shown = sql`
    select i.id, di.total, sc.confidence, sc.axes,
           exists (
             select 1 from dailynews.reads r
              where r.item_id = i.id and r.reader_id = ${readerId}
                and r.event in ('opened', 'outbound')
           ) as was_opened
      from dailynews.digests d
      join dailynews.digest_items di on di.digest_id = d.id
      join dailynews.items i on i.id = di.item_id
      join dailynews.scores sc on sc.item_id = i.id
     where d.reader_id = ${readerId}
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
           (select count(*)::int from dailynews.digests where reader_id = ${readerId}) as days
      from shown
  `;

  return { byScore, byConfidence, byAxis, totals };
}
