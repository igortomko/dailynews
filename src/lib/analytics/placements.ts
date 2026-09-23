import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";

/**
 * Реестр размещений: одна ссылка на бота на одно место, где она лежит.
 *
 * Код выдаётся до того, как ссылка ушла наружу, и выдаёт его только этот
 * реестр: ссылка без записи здесь — это трафик, который не отличить от
 * пустоты, а запись с ценой превращает «вроде сработало» в число.
 */
export type Placement = {
  code: string;
  name: string;
  channel: string;
  cost_usd: number;
  created_at: Date;
  retired_at: Date | null;
  starts: number;
  onboarded: number;
  opened: number;
};

export const CHANNELS = ["telegram", "x", "linkedin", "threads", "youtube", "instagram", "newsletter", "partner", "other"] as const;

/** Адрес ссылки. Без имени бота ссылку собрать нечем — это называется, а не подменяется. */
export function placementLink(code: string): string | null {
  const bot = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  return bot ? `https://t.me/${bot}?start=c_${code}` : null;
}

export async function listPlacements(): Promise<{ placements: Placement[]; unattributed: Omit<Placement, "code" | "name" | "channel" | "cost_usd" | "created_at" | "retired_at"> }> {
  // Считается по читателям, а не по событиям: код пишется в строку
  // читателя один раз, и «пришло» — это заведённые строки, а не нажатия.
  const rows = await sql<(Placement & { code: string | null })[]>`
    with people as (
      select r.id, r.source, r.onboarded_at is not null as onboarded,
             exists (select 1 from dailynews.reads e where e.reader_id = r.id and e.event = 'opened') as opened
        from dailynews.readers r
    )
    select p.code, p.name, p.channel, p.cost_usd::float as cost_usd, p.created_at, p.retired_at,
           count(x.id)::int as starts,
           count(x.id) filter (where x.onboarded)::int as onboarded,
           count(x.id) filter (where x.opened)::int as opened
      from dailynews.placements p
      left join people x on x.source = p.code
     group by p.code
    union all
    select null, '', '', 0, null, null,
           count(*)::int, count(*) filter (where onboarded)::int, count(*) filter (where opened)::int
      from people where source is null
  `;
  const unattributed = rows.find((r) => r.code === null) ?? { starts: 0, onboarded: 0, opened: 0 };
  const placements = rows
    .filter((r): r is Placement => r.code !== null)
    .sort((a, b) => Number(a.retired_at !== null) - Number(b.retired_at !== null) || b.created_at.getTime() - a.created_at.getTime());
  return { placements, unattributed: { starts: unattributed.starts, onboarded: unattributed.onboarded, opened: unattributed.opened } };
}

export async function createPlacement(input: { name: string; channel: string; cost: number }): Promise<string> {
  const name = input.name.trim().slice(0, 100);
  const channel = input.channel.trim().toLowerCase().slice(0, 40);
  if (!name || !channel || !Number.isFinite(input.cost) || input.cost < 0) throw new Error("Нужны название, канал и неотрицательная цена");
  // Восемь знаков base32 — 2^40 кодов: столкновение практически невозможно,
  // а повтор на нём всё равно отбивает первичный ключ, и берётся следующий.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = [...randomBytes(8)].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
    const [row] = await sql<{ code: string }[]>`
      insert into dailynews.placements (code, name, channel, cost_usd)
      values (${code}, ${name}, ${channel}, ${input.cost})
      on conflict (code) do nothing
      returning code`;
    if (row) return row.code;
  }
  throw new Error("Не вышло выдать код, попробуй ещё раз");
}

/** Снять, а не удалить: приведённые читатели указывают на код. */
export async function retirePlacement(code: string): Promise<void> {
  await sql`update dailynews.placements set retired_at = now() where code = ${code} and retired_at is null`;
}
