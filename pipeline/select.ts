import type { Survivor } from "./digest";
import { composite } from "./score";
import type { Axes, Weights } from "../src/lib/types";

/** Тип соединения берём у самого модуля: подпись обязана совпадать с тем, что передаёт прогон. */
type Db = typeof import("../src/lib/db")["sql"];

/**
 * Окно свежести. Оно же окно скоринга: сделай их разными — и кандидатами
 * окажутся материалы без оценки либо оценённые впустую.
 *
 * Без окна новый читатель получил бы в первый выпуск весь архив, который
 * прежний читатель когда-то не выбрал: выпуск пришёл бы полный, осмысленный
 * и годовалый.
 */
export const WINDOW_DAYS = 2;

export type Candidate = {
  id: number;
  title: string;
  excerpt: string;
  /** Текст статьи целиком, если его удалось забрать по ссылке. */
  body: string | null;
  url: string;
  source_label: string;
  topic_id: number | null;
  topic_label: string;
  axes: Axes;
};

/**
 * Кандидаты этого читателя: свежий оценённый поток без дублей и без того,
 * что уже уходило ему раньше.
 *
 * «Ему», а не «кому-нибудь»: выпуски других читателей на этот отбор влиять
 * не должны. Иначе первый прогнавшийся читатель вычерпывал бы поток,
 * а остальные получали бы остатки — выпуск при этом приходил бы вовремя.
 */
export async function candidates(
  sql: Db,
  readerId: number,
  sourceIds: number[],
): Promise<Candidate[]> {
  const rows = await sql<Candidate[]>`
    select i.id, i.title, i.excerpt, i.body, i.url, s.label as source_label,
           sc.topic_id::int as topic_id,
           coalesce(t.label, 'Прочее') as topic_label,
           sc.axes
      from dailynews.scores sc
      join dailynews.items i on i.id = sc.item_id
      join dailynews.sources s on s.id = i.source_id
 left join dailynews.topics t on t.id = sc.topic_id
     where i.dup_of is null
       -- Источники тарифа: сбор общий на всех, а в выпуск попадает только
       -- то, что тариф этого читателя разрешает. Иначе бесплатный читал бы
       -- платный источник, за который платит не он.
       -- Каст обязателен: нетипизированный массив уходит в int, а id — bigint.
       and i.source_id = any(${sourceIds}::bigint[])
       and i.collected_at > now() - ${`${WINDOW_DAYS} days`}::interval
       and not exists (
         select 1
           from dailynews.digest_items di
           join dailynews.digests d on d.id = di.digest_id
          where di.item_id = i.id and d.reader_id = ${readerId}
       )
     order by sc.total desc
  `;

  // Драйвер разбирает jsonb сам, но не во всех формах запроса отдаёт
  // ожидаемый OID колонки. Пришедшие строкой axes уронили бы composite()
  // на первом же обращении к axes.topic.
  return rows.map((row) => ({
    ...row,
    axes: typeof row.axes === "string" ? JSON.parse(row.axes) : row.axes,
  }));
}

/**
 * Отбор: круг по темам, но взвешенный.
 *
 * Простой круг (лучшее в каждой теме, потом вторые) чинил перекос, при
 * котором самая плодовитая тема забирала дайджест целиком, и перечинил:
 * места стали делиться строго поровну. В живом дайджесте на двадцать
 * материалов это выглядело как 3-3-3-3-3-3 — AI-инфра ровно столько же,
 * сколько блокчейн, при том что фокус читателя на первом.
 *
 * Поэтому номер в очереди делится на цель темы. У цели 2 материалы встают
 * на 0,5, 1, 1,5, 2 — между первым и вторым материалом обычной темы, и
 * тема берёт вдвое больше мест. У цели 0,3 — на 3,3 и 6,7, то есть тема
 * появляется, но редко. Свободные места не пропадают: если у темы сегодня
 * пусто, очередь просто доходит до следующей.
 *
 * Темы, которой у читателя нет, считаются за единицу — как материал вне тем.
 * Иначе тема, убранная из ленты, забирала бы свой прежний бюджет ещё двое
 * суток, ровно столько живут сделанные до этого оценки. Материалы из неё
 * не выбрасываются: хороший материал должен уметь пробиться, но не по праву
 * отменённого бюджета.
 *
 * Скор считается здесь, а не в базе: веса персональны, и второй экземпляр
 * той же формулы на SQL разъехался бы с composite() молча.
 */
export function pickSurvivors(
  rows: Candidate[],
  weights: Weights,
  targets: Map<number, number>,
  digestSize: number,
): Survivor[] {
  const byScore = rows
    .map((row) => ({ row, total: composite(row.axes, weights) }))
    .sort((a, b) => b.total - a.total);

  const seen = new Map<number, number>();
  const queued = byScore.map(({ row, total }) => {
    // Материал вне тем — одна общая очередь, как отдельная тема с целью 1.
    const key = row.topic_id ?? 0;
    const place = (seen.get(key) ?? 0) + 1;
    seen.set(key, place);
    // Цель 0 отбор бы уронил делением на ноль; её запрещает ограничение
    // reader_topics_weight_check, а убрать тему — это удалить строку.
    return { row, total, turn: place / (targets.get(key) || 1) };
  });

  return queued
    .sort((a, b) => a.turn - b.turn || b.total - a.total)
    .slice(0, digestSize)
    .map(({ row, total }) => ({
      id: row.id,
      title: row.title,
      excerpt: row.excerpt,
      body: row.body,
      url: row.url,
      source_label: row.source_label,
      topic_label: row.topic_label,
      total,
      axes: row.axes,
    }));
}

export async function selectSurvivors(
  sql: Db,
  readerId: number,
  weights: Weights,
  targets: Map<number, number>,
  digestSize: number,
  sourceIds: number[],
): Promise<Survivor[]> {
  return pickSurvivors(await candidates(sql, readerId, sourceIds), weights, targets, digestSize);
}

/** Цели по темам в виде, который нужен отбору. */
export const targetsOf = (topics: { id: number; weight: number }[]) =>
  new Map(topics.map((topic) => [topic.id, topic.weight]));
