import type { AnalyticsDataset, PlacementEntry, PlacementRow, Placements } from "./types";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const label = (value: unknown, limit: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f]/.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /Z$/.test(value) && Number.isFinite(Date.parse(value));
/** The code must survive a Telegram start payload, the strictest carrier: letters, digits, `_` and `-`. */
export const PLACEMENT_CODE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const BOT = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

function httpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".");
  } catch { return false; }
}

export function validatePlacementEntry(value: unknown): asserts value is PlacementEntry | null {
  if (value === null) return;
  if (!record(value)) throw new Error("Invalid placement entry.");
  if (value.kind === "telegram_start" && Object.keys(value).length === 2 && typeof value.bot === "string" && BOT.test(value.bot)) return;
  if (value.kind === "url_ref" && Object.keys(value).length === 2 && httpsUrl(value.url)) return;
  throw new Error("Invalid placement entry.");
}

export function validatePlacements(value: unknown): asserts value is Placements {
  if (!record(value) || Object.keys(value).some((key) => !["entry", "items"].includes(key)) || !("entry" in value)) throw new Error("Invalid placements.");
  validatePlacementEntry(value.entry);
  if (!Array.isArray(value.items) || value.items.length > 5_000) throw new Error("Expected at most 5,000 placements.");
  const codes = new Set<string>();
  for (const row of value.items) {
    const fields = ["code", "name", "channel", "costMinor", "currency", "createdAt", "retiredAt", "link"];
    if (!record(row) || Object.keys(row).some((key) => !fields.includes(key))) throw new Error("Invalid placement.");
    if (typeof row.code !== "string" || !PLACEMENT_CODE.test(row.code) || codes.has(row.code) || !label(row.name, 100) || !label(row.channel, 40)) throw new Error("Invalid placement.");
    if (!Number.isSafeInteger(row.costMinor) || Number(row.costMinor) < 0 || typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)) throw new Error("Invalid placement cost.");
    if (!timestamp(row.createdAt) || !(row.retiredAt === null || timestamp(row.retiredAt)) || !(row.link === undefined || row.link === null || httpsUrl(row.link))) throw new Error("Invalid placement dates or link.");
    codes.add(row.code);
  }
}

/**
 * The link a placement is posted with. The code travels in the entry itself —
 * a bot start payload or a `ref` query — so the first product entry can store it
 * as the acquisition campaign. A host-built link (a signed payload) wins.
 */
export function placementLink(entry: PlacementEntry | null, row: Pick<PlacementRow, "code" | "link">): string | null {
  if (row.link) return row.link;
  if (!entry) return null;
  if (entry.kind === "telegram_start") return `https://t.me/${entry.bot}?start=c_${row.code}`;
  const url = new URL(entry.url);
  url.searchParams.set("ref", `c_${row.code}`);
  return url.toString();
}

export interface PlacementStats { code: string; entered: number; activated: number; returned: number }

/**
 * People per placement, joined by the entry event's campaign. Counted by first
 * entry only: a known person arriving by a second link is a visit, not an
 * acquisition, and must not move to the newer placement.
 */
export function placementStats(dataset: AnalyticsDataset): { rows: PlacementStats[]; unattributed: Omit<PlacementStats, "code"> } {
  const codes = new Set(dataset.placements?.items.map((item) => item.code) ?? []);
  const firstEntry = new Map<string, string | null>();
  const activated = new Set<string>();
  const returned = new Set<string>();
  for (const event of [...dataset.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    if (event.name === "product_entered" && !firstEntry.has(event.subjectId)) firstEntry.set(event.subjectId, event.campaign && codes.has(event.campaign) ? event.campaign : null);
    if (event.name === "first_value") activated.add(event.subjectId);
    if (event.name === "value_repeated") returned.add(event.subjectId);
  }
  const tally = (people: string[]) => ({ entered: people.length, activated: people.filter((id) => activated.has(id)).length, returned: people.filter((id) => returned.has(id)).length });
  const byCode = new Map<string | null, string[]>();
  for (const [subject, code] of firstEntry) byCode.set(code, [...(byCode.get(code) ?? []), subject]);
  return {
    rows: [...codes].map((code) => ({ code, ...tally(byCode.get(code) ?? []) })),
    unattributed: tally(byCode.get(null) ?? []),
  };
}
