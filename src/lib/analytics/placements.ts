import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";

/**
 * Реестр размещений: одна ссылка на бота на одно место, где она лежит.
 *
 * Код выдаётся до того, как ссылка ушла наружу, и выдаёт его только этот
 * реестр: ссылка без записи здесь — это трафик, который не отличить от
 * пустоты, а запись с ценой превращает «вроде сработало» в число.
 * Показывает реестр Launch Kit (вкладка «Ссылки»), а выдаёт — этот файл
 * через /api/placements.
 */
export async function createPlacement(input: { name: string; channel: string; cost: number }): Promise<string> {
  const name = input.name.trim().slice(0, 100);
  const channel = input.channel.trim().toLowerCase();
  if (!name || !/^[a-z0-9_-]{1,40}$/.test(channel) || !Number.isFinite(input.cost) || input.cost < 0) throw new Error("Нужны название, канал латиницей и неотрицательная цена");
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
