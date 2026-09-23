import "server-only";
import { sql } from "@/lib/db";
import { effectivePlan } from "@/lib/lemon";
import { allReaders } from "@/lib/readers";

/**
 * Расход на модель — из `model_calls`, той же таблицы, по которой прогон
 * сверяет дневной потолок. Отдельного счётчика нет намеренно: второй
 * источник о деньгах разошёлся бы с первым, и дашборд показывал бы не те
 * деньги, которые остановили выпуск.
 *
 * Сюда попадает и разбор: `reading_calls` при расчёте пишет строку в
 * `model_calls`. Незакрытые резервы (`reserved`, `uncertain`) ещё не там —
 * они показываются отдельной строкой, а не складываются: это обещание
 * расхода, а не расход.
 *
 * Сутки — по UTC, как у потолка (`date_trunc('day', now())` на сервере в UTC).
 */
export type Costs = Awaited<ReturnType<typeof loadCosts>>;

const DAYS = 30;

export async function loadCosts() {
  const [totals, daily, stages, models, perReader, pending, readers] = await Promise.all([
    sql<{ today: number; week: number; month: number; all: number; first: Date | null }[]>`
      select coalesce(sum(cost_usd) filter (where at >= date_trunc('day', now())), 0)::float as today,
             coalesce(sum(cost_usd) filter (where at >= date_trunc('day', now()) - interval '6 days'), 0)::float as week,
             coalesce(sum(cost_usd) filter (where at >= date_trunc('day', now()) - interval '29 days'), 0)::float as month,
             coalesce(sum(cost_usd), 0)::float as all,
             min(at) as first
        from dailynews.model_calls`,
    sql<{ day: string; stage: string; usd: number }[]>`
      select (at at time zone 'UTC')::date::text as day, stage, sum(cost_usd)::float as usd
        from dailynews.model_calls
       where at >= date_trunc('day', now()) - make_interval(days => ${DAYS - 1})
       group by 1, 2 order by 1`,
    sql<{ stage: string; calls: number; tokens_in: number; tokens_out: number; usd: number }[]>`
      select stage, count(*)::int as calls, sum(tokens_in)::float as tokens_in,
             sum(tokens_out)::float as tokens_out, sum(cost_usd)::float as usd
        from dailynews.model_calls
       where at >= date_trunc('day', now()) - make_interval(days => ${DAYS - 1})
       group by 1 order by usd desc`,
    sql<{ model: string; calls: number; usd: number }[]>`
      select coalesce(nullif(model, ''), '—') as model, count(*)::int as calls, sum(cost_usd)::float as usd
        from dailynews.model_calls
       where at >= date_trunc('day', now()) - make_interval(days => ${DAYS - 1})
       group by 1 order by usd desc`,
    sql<{ reader_id: number | null; today: number; month: number; all: number }[]>`
      select reader_id::int,
             coalesce(sum(cost_usd) filter (where at >= date_trunc('day', now())), 0)::float as today,
             coalesce(sum(cost_usd) filter (where at >= date_trunc('day', now()) - interval '29 days'), 0)::float as month,
             sum(cost_usd)::float as all
        from dailynews.model_calls group by 1`,
    sql<{ calls: number; usd: number }[]>`
      select count(*)::int as calls, coalesce(sum(reserved_usd), 0)::float as usd
        from dailynews.reading_calls where status in ('reserved', 'uncertain')`,
    allReaders(),
  ]);

  const spent = new Map(perReader.map((row) => [row.reader_id, row]));
  const zero = { today: 0, month: 0, all: 0 };
  const rows = readers.map((reader) => {
    const plan = effectivePlan(reader);
    const s = spent.get(reader.id) ?? zero;
    return {
      id: reader.id,
      name: reader.username ? `@${reader.username}` : `Читатель ${reader.id}`,
      owner: reader.owner,
      plan: plan.label,
      price: plan.price,
      cap: Number(reader.daily_cap_usd),
      today: s.today,
      month: s.month,
      all: s.all,
    };
  }).sort((a, b) => b.month - a.month);

  // Дни без вызовов тоже должны стоять на оси: пропуск в ряду выглядит
  // как «всё нормально», а это ровно тот день, когда прогон не дошёл до модели.
  const days: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  const stageNames = stages.map((s) => s.stage);
  const series = days.map((day) => {
    const point: Record<string, number | string> = { day };
    for (const stage of stageNames) point[stage] = 0;
    for (const row of daily) if (row.day === day) point[row.stage] = row.usd;
    return point;
  });

  return {
    days: DAYS,
    totals: totals[0],
    series,
    stages,
    models,
    readers: rows,
    shared: spent.get(null) ?? zero,
    pending: pending[0],
    activeReaders: rows.filter((r) => r.month > 0).length,
  };
}
