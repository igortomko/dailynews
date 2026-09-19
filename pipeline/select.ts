import type { Survivor } from "./digest";

/** Тип соединения берём у самого модуля: подпись обязана совпадать с тем, что передаёт прогон. */
type Db = typeof import("../src/lib/db")["sql"];

/**
 * Отбор: круг по темам, но взвешенный.
 *
 * Простой круг (лучшее в каждой теме, потом вторые) чинил перекос, при
 * котором самая плодовитая тема забирала дайджест целиком, и перечинил:
 * места стали делиться строго поровну. В живом дайджесте на двадцать
 * материалов это выглядело как 3-3-3-3-3-3 — AI-инфра ровно столько же,
 * сколько блокчейн, при том что фокус читателя на первом.
 *
 * Поэтому номер в очереди делится на вес темы. У веса 2 материалы встают
 * на 0,5, 1, 1,5, 2 — между первым и вторым материалом обычной темы, и
 * тема берёт вдвое больше мест. У веса 0,3 — на 3,3 и 6,7, то есть тема
 * появляется, но редко. Свободные места не пропадают: если у темы сегодня
 * пусто, очередь просто доходит до следующей.
 *
 * Выключенная тема сохраняет свою цель в базе, но здесь считается за единицу,
 * как материал вне тем. Иначе тема, которую читатель убрал из ленты, забирала
 * бы свой прежний бюджет ещё двое суток — ровно столько живут оценки, сделанные
 * до выключения. Материалы из неё не выбрасываются: хороший материал должен
 * уметь пробиться, но не по праву отменённого бюджета.
 *
 * Деление живое, поэтому нулевой вес уронил бы весь прогон — его запрещает
 * ограничение topics_weight_positive, а выключение темы делается через active.
 */
export function selectSurvivors(sql: Db, digestSize: number): Promise<Survivor[]> {
  return sql<Survivor[]>`
    with ranked as (
      select i.id, i.title, i.excerpt, i.url, s.label as source_label,
             coalesce(t.label, 'Прочее') as topic_label,
             sc.total, sc.axes,
             row_number() over (
               partition by sc.topic_id order by sc.total desc
             )::real / coalesce(case when t.active then t.weight end, 1)::real as turn
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
     order by turn asc, total desc
     limit ${digestSize}
  `;
}
