/**
 * Отдача и тишина источников — по тому, что уже лежит в базе.
 *
 * `last_count` пишется каждым прогоном, но на него никто не смотрел.
 * Источник, который отвечает 200 и отдаёт ноль свежих записей пять дней
 * подряд, — самая незаметная поломка в ленте: дайджест приходит, просто
 * без него. Поэтому тишина считается не по последнему прогону, а по дате
 * последнего материала, и меряется в днях.
 *
 * Отдача превращает список источников в инструмент решения: «этот фид даёт
 * сорок материалов в день и ни одного в дайджест» — повод выключить,
 * а не гадать.
 */
import type { Sql } from "postgres";
import { SILENT_DAYS } from "../src/lib/types";

/** Окно, за которое считается отдача. Месяц переживает и отпуск, и праздники. */
export const WINDOW_DAYS = 30;

export type SourceHealth = {
  /** Строкой: bigint приходит из драйвера строкой, и «136» !== 136. */
  source_id: string;
  collected: number;
  duplicates: number;
  digested: number;
  mean_score: number | null;
  /**
   * Дней с последнего материала — а для источника, не давшего ни одного,
   * дней с момента, когда его завели. Иначе только что добавленный источник
   * попадает в тревогу сразу, до первого же прогона.
   */
  silent_days: number;
  /** Давал ли он хоть что-нибудь когда-нибудь. */
  ever: boolean;
};

export async function sourceHealth(sql: Sql, days = WINDOW_DAYS): Promise<SourceHealth[]> {
  return sql<SourceHealth[]>`
    -- Окно отрезается до соединений, а не в filter поверх всей истории:
    -- иначе поиск по массиву item_ids выполняется для каждой строки items
    -- за всё время, и страница источников дешевеет только до первой сотни
    -- прогонов.
    with recent as (
      select i.source_id, i.id, i.dup_of, sc.total
        from dailynews.items i
        left join dailynews.scores sc on sc.item_id = i.id
       where i.collected_at > now() - ${`${days} days`}::interval
    )
    select
      s.id::text as source_id,
      count(r.id)::int as collected,
      count(r.id) filter (where r.dup_of is not null)::int as duplicates,
      count(d.hit)::int as digested,
      avg(r.total)::real as mean_score,
      -- Тишина считается по всей истории, а не по окну: источник,
      -- замолчавший месяц назад, иначе выглядит как новый. greatest
      -- пропускает null, поэтому не дававший ничего считает от заведения.
      -- date - date даёт integer, и типы обеих сторон известны — Postgres
      -- не выбирает между date - date и date - integer.
      (current_date - greatest(
        (select max(i.collected_at) from dailynews.items i where i.source_id = s.id),
        s.created_at
      )::date)::int as silent_days,
      exists (select 1 from dailynews.items i where i.source_id = s.id) as ever
    from dailynews.sources s
    left join recent r on r.source_id = s.id
    left join lateral (
      select 1 as hit from dailynews.digests dg where r.id = any(dg.item_ids) limit 1
    ) d on true
    group by s.id
    order by s.id
  `;
}

/** Кто молчит дольше срока. Строка в лог прогона и метка в списке источников. */
export function silent(health: SourceHealth[], days = SILENT_DAYS): SourceHealth[] {
  return health.filter((row) => row.silent_days >= days);
}
