import type { AnalyticsDataset, ModelCostRow, ModelCosts, ModelPrice } from "./types";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const label = (value: unknown, limit = 80): value is string => typeof value === "string" && value.length > 0 && value.length <= limit && !/[\u0000-\u001f]/.test(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const money = (value: unknown): boolean => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e9);

/** Validates the optional spend extension. Rejects rather than trims: partial money is a wrong total. */
export function validateModelCosts(value: unknown, generatedAt: string): asserts value is ModelCosts {
  if (!record(value) || Object.keys(value).some((key) => !["capturedAt", "granularity", "rows", "pendingUsd", "stageLabels", "prices"].includes(key))) throw new Error("Invalid model costs.");
  if (typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt)) || Date.parse(value.capturedAt) > Date.parse(generatedAt)) throw new Error("Invalid model costs capture time.");
  if (value.granularity !== "day" && value.granularity !== "month") throw new Error("Model costs granularity must be day or month.");
  if (value.pendingUsd !== undefined && !money(value.pendingUsd)) throw new Error("Invalid pending model spend.");
  if (value.stageLabels !== undefined && (!record(value.stageLabels) || Object.keys(value.stageLabels).length > 200 || Object.entries(value.stageLabels).some(([key, name]) => !label(key) || !label(name)))) throw new Error("Invalid model cost stage labels.");
  if (value.prices !== undefined) validatePrices(value.prices);
  if (!Array.isArray(value.rows) || value.rows.length > 50_000) throw new Error("Expected at most 50,000 model cost rows.");
  const fields = ["date", "stage", "model", "subjectId", "calls", "tokensIn", "tokensOut", "usd"];
  for (const row of value.rows) {
    if (!record(row) || Object.keys(row).some((key) => !fields.includes(key)) || fields.some((key) => !(key in row))) throw new Error("Invalid model cost row.");
    if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !label(row.stage) || !label(row.model, 120) || !(row.subjectId === null || label(row.subjectId, 100)) || !count(row.calls)) throw new Error("Invalid model cost row.");
    if (!(row.tokensIn === null || count(row.tokensIn)) || !(row.tokensOut === null || count(row.tokensOut)) || !money(row.usd)) throw new Error("Invalid model cost amounts.");
  }
}

const rate = (value: unknown): boolean => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e6);

/** Prices keyed by model. Shared by the dataset defaults and the owner's own entries. */
export function validatePrices(value: unknown): asserts value is Record<string, ModelPrice> {
  if (!record(value) || Object.keys(value).length > 200) throw new Error("Invalid model prices.");
  for (const [model, price] of Object.entries(value)) {
    if (!label(model, 120) || !record(price) || Object.keys(price).some((key) => !["inputPerMillion", "outputPerMillion", "perCall", "source"].includes(key))) throw new Error("Invalid model price.");
    if (!rate(price.inputPerMillion) || !rate(price.outputPerMillion) || !rate(price.perCall) || !label(price.source, 160)) throw new Error("Invalid model price.");
    if (price.perCall === null && (price.inputPerMillion === null || price.outputPerMillion === null)) throw new Error("A price needs a per-call amount or both token rates.");
  }
}

/**
 * What an unpriced row costs by a price: tokens when the row has both counts and
 * the price has both rates, otherwise calls times the per-call amount. Null when
 * neither applies — then the row stays uncounted rather than zero.
 */
export function priceRow(row: ModelCostRow, price: ModelPrice | undefined): number | null {
  if (row.usd !== null) return row.usd;
  if (!price) return null;
  if (row.tokensIn !== null && row.tokensOut !== null && price.inputPerMillion !== null && price.outputPerMillion !== null)
    return (row.tokensIn * price.inputPerMillion + row.tokensOut * price.outputPerMillion) / 1e6;
  return price.perCall !== null ? row.calls * price.perCall : null;
}

export interface CostTotals { usd: number | null; calls: number; priced: boolean }
export interface CostReport {
  granularity: "day" | "month";
  priced: boolean;
  total: CostTotals;
  shared: CostTotals;
  personal: CostTotals;
  perPayingSubjectDay: number | null;
  subjectsWithSpend: number;
  pendingUsd: number | null;
  series: Record<string, number | string>[];
  stages: { key: string; label: string; calls: number; tokensIn: number | null; tokensOut: number | null; usd: number | null; share: number | null }[];
  models: { key: string; calls: number; usd: number | null; estimated: boolean; unpricedCalls: number; price: ModelPrice | null; priceOrigin: "product" | "owner" | null }[];
  /** Some amounts come from prices, not from the product's ledger. */
  estimated: boolean;
  /** Calls no price covers: they are counted, but in no dollar total. */
  unpricedCalls: number;
  subjects: { key: string; calls: number; usd: number | null }[];
}

const DAY = 86_400_000;

function sum(rows: ModelCostRow[]): CostTotals {
  const priced = rows.some((row) => row.usd !== null);
  return { calls: rows.reduce((total, row) => total + row.calls, 0), usd: priced ? rows.reduce((total, row) => total + (row.usd ?? 0), 0) : null, priced };
}

function grouped(rows: ModelCostRow[], key: (row: ModelCostRow) => string) {
  const groups = new Map<string, ModelCostRow[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}

const nullableTokens = (rows: ModelCostRow[], field: "tokensIn" | "tokensOut") =>
  rows.some((row) => row[field] !== null) ? rows.reduce((total, row) => total + (row[field] ?? 0), 0) : null;

/**
 * Spend over a half-open period [from, to). A monthly row counts wholly in any
 * period it overlaps; the view states the granularity rather than prorating.
 */
export function buildCosts(dataset: AnalyticsDataset, from: string, to: string, ownerPrices: Record<string, ModelPrice> = {}): CostReport | null {
  const costs = dataset.modelCosts;
  if (!costs) return null;
  const prices = { ...costs.prices, ...ownerPrices };
  // A month overlapping the period belongs to it: otherwise a period that starts
  // on the 10th would drop the current month entirely.
  const start = costs.granularity === "month" ? `${from.slice(0, 7)}-01` : from.slice(0, 10);
  const recorded = costs.rows.filter((row) => row.date >= start && Date.parse(`${row.date}T00:00:00Z`) < Date.parse(to));
  // Estimated amounts join the ledger's own; `estimated` keeps them apart on screen.
  const rows = recorded.map((row) => ({ ...row, usd: priceRow(row, prices[row.model]) }));
  const estimatedRow = (row: ModelCostRow) => row.usd === null && prices[row.model] !== undefined && priceRow(row, prices[row.model]) !== null;
  const total = sum(rows);
  const shared = sum(rows.filter((row) => row.subjectId === null));
  const personal = sum(rows.filter((row) => row.subjectId !== null));
  const bySubject = grouped(rows.filter((row) => row.subjectId !== null), (row) => row.subjectId!);
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / DAY));
  const stageKeys = [...grouped(rows, (row) => row.stage).entries()]
    .map(([key, items]) => ({ key, ...sum(items), tokensIn: nullableTokens(items, "tokensIn"), tokensOut: nullableTokens(items, "tokensOut") }))
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || b.calls - a.calls);
  // Every bucket of the period stands on the axis: a missing day reads as "fine"
  // when it is exactly the day the product did not reach the model.
  const buckets: string[] = [];
  if (costs.granularity === "day") for (let t = Date.parse(`${start}T00:00:00Z`); t < Date.parse(to); t += DAY) buckets.push(new Date(t).toISOString().slice(0, 10));
  else buckets.push(...[...new Set(rows.map((row) => row.date))].sort());
  const series = buckets.map((date) => {
    const point: Record<string, number | string> = { date };
    for (const stage of stageKeys) point[stage.key] = 0;
    for (const row of rows) if (row.date === date) point[row.stage] = (point[row.stage] as number) + (total.priced ? row.usd ?? 0 : row.calls);
    return point;
  });
  return {
    granularity: costs.granularity,
    priced: total.priced,
    total, shared, personal,
    subjectsWithSpend: bySubject.size,
    perPayingSubjectDay: personal.usd !== null && bySubject.size ? personal.usd / bySubject.size / days : null,
    pendingUsd: costs.pendingUsd ?? null,
    series,
    stages: stageKeys.map((stage) => ({ ...stage, label: costs.stageLabels?.[stage.key] ?? stage.key, share: stage.usd !== null && total.usd ? stage.usd / total.usd : null })),
    models: [...grouped(recorded, (row) => row.model).entries()].map(([key, items]) => {
      const priced = items.map((row) => ({ ...row, usd: priceRow(row, prices[key]) }));
      return {
        key, ...sum(priced),
        estimated: items.some(estimatedRow),
        unpricedCalls: priced.filter((row) => row.usd === null).reduce((total, row) => total + row.calls, 0),
        price: prices[key] ?? null,
        priceOrigin: ownerPrices[key] ? "owner" as const : costs.prices?.[key] ? "product" as const : null,
      };
    }).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || b.calls - a.calls),
    estimated: recorded.some(estimatedRow),
    unpricedCalls: rows.filter((row) => row.usd === null).reduce((total, row) => total + row.calls, 0),
    subjects: [...bySubject.entries()].map(([key, items]) => ({ key, ...sum(items) })).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || b.calls - a.calls),
  };
}
