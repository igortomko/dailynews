import type { Usage } from "./digest";
import type { CallRecord } from "../src/lib/readers";
import { llmCost, jevCost } from "./cost";
import { reserveCall, settleCall } from "./reading-store";

type Stage = CallRecord['stage'];

/** Charge every paid attempt, including malformed responses and uncertain transport errors. */
export async function budgetedFetch(url: string, init: RequestInit, readerId?: number, stage: Stage = 'digest'): Promise<Response> {
  if (readerId === undefined) return fetch(url, init);
  const { sql } = await import('../src/lib/db');
  const request = JSON.parse(String(init.body)) as { model: string; max_tokens: number; messages: unknown };
  const bound: Usage = { input: Buffer.byteLength(JSON.stringify(request.messages), 'utf8') + 1024, output: request.max_tokens, cached: 0, reasoning: 0, requests: 1 };
  const id = await reserveCall(sql, readerId, llmCost(bound), stage, request.model);
  const started = Date.now();
  let usage: Usage | null = null;
  try {
    const response = await fetch(url, init);
    if (response.ok) {
      const payload = await response.clone().json();
      const u = payload.usage;
      if (Number.isFinite(u?.prompt_tokens) && Number.isFinite(u?.completion_tokens)) {
        usage = { input: u.prompt_tokens, output: u.completion_tokens, cached: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0, reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0, requests: 1 };
      }
    }
    return response;
  } finally {
    await settleCall(sql, readerId, id, usage, usage ? llmCost(usage) : null, Date.now() - started, stage);
  }
}

export async function budgetedJev<T extends { usage: { input_tokens: number }; model: string }>(readerId: number | undefined, stage: Stage, input: unknown, call: () => Promise<T>): Promise<T> {
  if (readerId === undefined) return call();
  const { sql } = await import('../src/lib/db');
  const id = await reserveCall(sql, readerId, jevCost(Buffer.byteLength(JSON.stringify(input), 'utf8') + 4096), stage, 'jev');
  const started = Date.now();
  let usage: Usage | null = null;
  let model: string | undefined;
  try {
    const result = await call();
    usage = { input: result.usage.input_tokens, output: 0, cached: 0, reasoning: 0, requests: 1 };
    model = result.model;
    return result;
  } finally {
    await settleCall(sql, readerId, id, usage, usage ? jevCost(usage.input) : null, Date.now() - started, stage, model);
  }
}
