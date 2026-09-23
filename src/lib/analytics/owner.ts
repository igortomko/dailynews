import "server-only";
import { cookies } from "next/headers";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import catalogData from "@launch-kit/modules.json";
import type { Config, Selection } from "@launch-kit/lib/config";
import { equal, SESSION_COOKIE, sign, verifySession } from "@/lib/auth";
import { getReader } from "@/lib/readers";
import { buildDataset } from "./dataset";
import defaultSelection from "./selection.json";

/**
 * Хост Launch Kit внутри Reporta. Кит ходит в /api/config, /api/dataset,
 * /api/refresh и /api/selection — адреса зашиты в его App.tsx, поэтому
 * они здесь, а не под /api/admin.
 *
 * Отдельного пароля у дашборда нет: владелец — это `readers.owner`,
 * вход тот же, что в ленту. Каждый ответ проверяет это сам, а не полагается
 * на страницу: адрес API зовётся мимо неё.
 */
export const catalog = catalogData as Config["catalog"];
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };

export const json = (value: unknown, status = 200) => Response.json(value, { status, headers: HEADERS });

async function session(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function isOwner(): Promise<boolean> {
  const id = await verifySession(await session());
  return id !== null && (await getReader(id))?.owner === true;
}

/** CSRF привязан к куке сессии: чужая сессия его не подделает, новая — сбросит. */
export async function csrfToken(): Promise<string> {
  return sign(`csrf:${await session()}`);
}

export async function denied(request: Request, write = false): Promise<Response | null> {
  if (!(await isOwner())) return json({ error: "Только для владельца" }, 404);
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") return json({ error: "Запрос отклонён" }, 403);
  if (write) {
    const origin = request.headers.get("Origin");
    const host = request.headers.get("Host");
    if (!origin || !host || new URL(origin).host !== host) return json({ error: "Запрос отклонён" }, 403);
    if (!equal(request.headers.get("X-CSRF-Token") ?? "", await csrfToken())) return json({ error: "Запрос отклонён" }, 403);
  }
  return null;
}

export async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new Error("Expected JSON");
  const text = await request.text();
  if (text.length > 16384) throw new Error("Request too large");
  return JSON.parse(text);
}

// Снимок живёт тридцать секунд на процесс: кит спрашивает dataset на каждом
// показе, а обновление по кнопке — не чаще раза в тридцать секунд.
let snapshot: { at: number; value: ReturnType<typeof buildDataset> } | undefined;
let refreshedAt = 0;
export function loadDataset(force = false) {
  const now = Date.now();
  if (force && now - refreshedAt < 30_000) return null;
  if (force) refreshedAt = now;
  else if (snapshot && now - snapshot.at < 30_000) return snapshot.value;
  const value = buildDataset();
  snapshot = { at: now, value };
  value.catch(() => { if (snapshot?.value === value) snapshot = undefined; });
  return value;
}

// Состав блоков — в подписанной куке, как у Brasil Course: это настройка
// одного браузера владельца, и таблица ради неё была бы лишней.
export const SELECTION_COOKIE = "dn_analytics_selection";

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string") || new Set(value).size !== value.length) throw new Error("Invalid selection IDs");
  return value as string[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid selection");
  return value as Record<string, unknown>;
}

export function validateSelection(value: unknown): Selection {
  const data = object(value);
  const fields = ["contract_version", "preset", "selected_modules", "view_choices", "excluded_modules", "provenance"];
  if (Object.keys(data).some((key) => !fields.includes(key)) || data.contract_version !== "product-analytics-v1") throw new Error("Invalid selection contract");
  if (typeof data.preset !== "string" || !["custom", ...Object.keys(catalog.presets)].includes(data.preset)) throw new Error("Invalid preset");
  if (typeof data.provenance !== "string" || !["user", "agent", "default", "preset"].includes(data.provenance)) throw new Error("Invalid provenance");
  const modules = new Map(catalog.modules.map((module) => [module.id, module]));
  const selected = strings(data.selected_modules);
  if (selected.some((id) => !modules.has(id) || id === "realtime")) throw new Error("Unknown module");
  const choices = object(data.view_choices ?? {});
  if (Object.keys(choices).some((id) => !selected.includes(id))) throw new Error("Unselected module views");
  for (const id of selected) {
    const entry = modules.get(id)!;
    const views = strings(choices[id] ?? entry.views);
    if (views.some((view) => !entry.views.includes(view) || view === "online")) throw new Error("Unknown view");
    const dependencies = new Set(entry.depends_on);
    for (const view of views) for (const dep of entry.view_dependencies?.[view] ?? []) dependencies.add(dep);
    if ([...dependencies].some((dep) => !selected.includes(dep))) throw new Error("Missing module dependency");
  }
  const excluded = object(data.excluded_modules ?? {});
  if (Object.entries(excluded).some(([id, reason]) => (!modules.has(id) && id !== "realtime") || selected.includes(id) || typeof reason !== "string" || reason.length > 500)) throw new Error("Invalid exclusions");
  return {
    contract_version: "product-analytics-v1", preset: data.preset, selected_modules: selected,
    view_choices: choices as Record<string, string[]>, excluded_modules: excluded as Record<string, string>, provenance: data.provenance,
  } as Selection;
}

export async function encodeSelection(value: Selection): Promise<string> {
  const payload = deflateRawSync(Buffer.from(JSON.stringify(value))).toString("base64url");
  const cookie = `${payload}.${await sign(`selection:${payload}`)}`;
  if (cookie.length > 3500) throw new Error("Selection exceeds cookie capacity");
  return cookie;
}

export async function ownerSelection(): Promise<Selection> {
  const saved = (await cookies()).get(SELECTION_COOKIE)?.value;
  const [payload, signature] = saved?.split(".") ?? [];
  if (payload && signature && equal(signature, await sign(`selection:${payload}`))) {
    try {
      return validateSelection(JSON.parse(inflateRawSync(Buffer.from(payload, "base64url"), { maxOutputLength: 16384 }).toString("utf8")));
    } catch { /* устаревшая кука — берём состав по умолчанию */ }
  }
  return validateSelection(defaultSelection);
}
