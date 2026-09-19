import type { Sql } from "postgres";
import { normalizeTitle } from "./normalize";

/** Насколько похожими должны быть нормализованные заголовки, чтобы счесть их дублем. */
const SIMILARITY = 0.55;
/** Окно, в котором ищется оригинал. Дальше в прошлое новость уже не дубль, а возврат к теме. */
const WINDOW_DAYS = 4;

/**
 * Второй слой дедупа, поверх уникального url_canon: одна и та же новость,
 * переписанная тремя изданиями под разными заголовками и адресами.
 * Сравнение делает Postgres через pg_trgm — своего кода тут быть не должно.
 *
 * Проставляет items.dup_of. Дубли остаются в базе (они нужны, чтобы видеть
 * охват источников), но в отбор и в дайджест не попадают.
 */
export async function markDuplicates(sql: Sql, itemIds: number[]): Promise<number> {
  if (itemIds.length === 0) return 0;

  const marked = await sql<{ id: number }[]>`
    with fresh as (
      select id, title_norm, collected_at
      from dailynews.items
      where id = any(${itemIds}) and dup_of is null
    ),
    matches as (
      select distinct on (f.id) f.id, o.id as original_id
      from fresh f
      join dailynews.items o
        on o.id < f.id
       and o.dup_of is null
       and o.collected_at > f.collected_at - ${`${WINDOW_DAYS} days`}::interval
       and extensions.similarity(o.title_norm, f.title_norm) >= ${SIMILARITY}
      order by f.id, extensions.similarity(o.title_norm, f.title_norm) desc, o.id asc
    )
    update dailynews.items i
       set dup_of = m.original_id
      from matches m
     where i.id = m.id
    returning i.id
  `;
  return marked.length;
}

export { normalizeTitle };
