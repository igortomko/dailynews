import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import type { CallRecord } from "../src/lib/readers";
import type { Usage } from "./digest";
import type { ArticleAnalysis, StoredReading } from "../src/lib/reading-document";

export class ReadingBusyError extends Error {}
export class ReadingBudgetError extends Error {}
export type ReadingReader = { id: number; reader_context: string; daily_cap_usd: number; reading_v2_enabled: boolean };
export type Baseline = { id: number; title: string; originalTitle: string; summary: string; sourceVersion: string; day: string };

export async function reserveCall(sql: Sql, readerId: number, amount: number, phase: string, model: string): Promise<string> {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid cost reservation");
  const id = randomUUID();
  await sql.begin(async (tx) => {
    const [reader] = await tx<{ daily_cap_usd: number }[]>`select daily_cap_usd from dailynews.readers where id = ${readerId} for update`;
    if (!reader) throw new Error("Reader unavailable");
    const [sum] = await tx<{ spent: number }[]>`
      select (
        coalesce((select sum(cost_usd) from dailynews.model_calls where reader_id=${readerId} and at>=date_trunc('day', now())),0)
        + coalesce((select sum(reserved_usd) from dailynews.reading_calls where reader_id=${readerId} and status='reserved' and at>=date_trunc('day',now())),0)
      )::float as spent`;
    if (sum.spent + amount > Number(reader.daily_cap_usd)) throw new ReadingBudgetError("Daily model budget reached");
    await tx`insert into dailynews.reading_calls(id,reader_id,phase,model,reserved_usd,status)
      values (${id},${readerId},${phase},${model},${amount},'reserved')`;
  });
  return id;
}

export async function settleCall(sql: Sql, readerId: number, id: string, usage: Usage | null, cost: number | null, elapsed: number, stage: CallRecord['stage'] = 'digest', model?: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select id from dailynews.readers where id=${readerId} for update`;
    const [reservation] = await tx<{ model: string; reserved_usd: number }[]>`
      select model, reserved_usd from dailynews.reading_calls where reader_id=${readerId} and id=${id} and status='reserved' for update`;
    if (!reservation) return;
    const charged = cost ?? Number(reservation.reserved_usd);
    await tx`insert into dailynews.model_calls(reader_id,stage,model,tokens_in,tokens_out,cost_usd)
      values (${readerId},${stage},${model ?? reservation.model},${usage?.input ?? 0},${usage?.output ?? 0},${charged})`;
    await tx`update dailynews.reading_calls set status=${usage ? 'settled' : 'uncertain'},
      tokens_in=${usage?.input ?? 0}, tokens_out=${usage?.output ?? 0}, cached_tokens=${usage?.cached ?? 0},
      reasoning_tokens=${usage?.reasoning ?? 0}, cost_usd=${charged}, latency_ms=${elapsed}
      where reader_id=${readerId} and id=${id}`;
  });
}

export async function acquireAnalysis(sql: Sql, itemId: number, key: string, version: string) {
  const [existing] = await sql<{ result: ArticleAnalysis | null }[]>`select result from dailynews.article_analyses where cache_key=${key} and item_id=${itemId}`;
  if (existing?.result) return { analysis: existing.result, token: null };
  const token = randomUUID();
  const rows = await sql`
    insert into dailynews.article_analyses(cache_key,item_id,source_version,lease_token,lease_until)
    values (${key},${itemId},${version},${token},now()+interval '45 minutes')
    on conflict(cache_key) do update set lease_token=excluded.lease_token,lease_until=excluded.lease_until
    where dailynews.article_analyses.result is null
      and (dailynews.article_analyses.lease_until is null or dailynews.article_analyses.lease_until<now())
    returning cache_key`;
  if (!rows.length) throw new ReadingBusyError("Статья уже обрабатывается. Повтори через несколько минут.");
  return { analysis: null, token };
}
export async function finishAnalysis(sql: Sql, key: string, token: string, result: ArticleAnalysis | null) {
  const rows = await sql`update dailynews.article_analyses
    set result=${result ? sql.json(result) : null},lease_token=null,lease_until=null,updated_at=now()
    where cache_key=${key} and lease_token=${token} returning cache_key`;
  if (!rows.length) throw new Error("Article analysis lease expired");
}
export async function getDocument(sql: Sql, readerId: number, key: string): Promise<StoredReading | null> {
  const [row] = await sql<{ result: StoredReading }[]>`select result from dailynews.reader_summaries where reader_id=${readerId} and cache_key=${key}`;
  return row?.result ?? null;
}
export async function saveDocument(sql: Sql, readerId: number, itemId: number, key: string, result: StoredReading) {
  await sql`insert into dailynews.reader_summaries(reader_id,item_id,cache_key,result)
    values (${readerId},${itemId},${key},${sql.json(result)})
    on conflict(reader_id,cache_key) do update set result=excluded.result
    where excluded.result->>'status'='verified' or dailynews.reader_summaries.result->>'status'<>'verified'`;
}
export async function recentBaselines(sql: Sql, readerId: number, itemId: number, title: string): Promise<Baseline[]> {
  const rows = await sql<Baseline[]>`
    select di.item_id::int as id, di.title, i.title as "originalTitle", di.summary,
      di.summary_document->>'sourceVersion' as "sourceVersion", d.day::text as day
    from dailynews.digests d join dailynews.digest_items di on di.digest_id=d.id
    join dailynews.items i on i.id=di.item_id
    where d.reader_id=${readerId} and di.item_id<>${itemId} and d.day>=current_date-30
      and di.summary_document->>'status'='verified'
    order by d.day desc, di.position limit 200`;
  const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !["that", "with", "from", "this", "will", "после", "которые", "новый", "about"].includes(w)));
  const current = words(title);
  return rows.map((r) => ({ row: r, common: [...words(`${r.title} ${r.originalTitle}`)].filter((w) => current.has(w)).length }))
    .filter((r) => r.common >= 2).sort((a,b) => b.common-a.common).slice(0,3).map((r) => r.row);
}
