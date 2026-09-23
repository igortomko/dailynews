import test from "node:test";
import assert from "node:assert/strict";
import { buildCosts, validateModelCosts } from "./costs";
import { makeDemoDataset } from "./demo";
import type { ModelCostRow } from "./types";

const row = (date: string, stage: string, subjectId: string | null, usd: number | null, calls = 1): ModelCostRow =>
  ({ date, stage, model: "m", subjectId, calls, tokensIn: 10, tokensOut: null, usd });
const dataset = (rows: ModelCostRow[], granularity: "day" | "month" = "day") => ({
  ...makeDemoDataset("telegram", "2026-09-23T12:00:00Z"),
  modelCosts: { capturedAt: "2026-09-23T12:00:00Z", granularity, rows },
});

test("shared and personal spend add up to the total, empty days stay on the axis", () => {
  const report = buildCosts(dataset([row("2026-09-20", "score", null, 0.5), row("2026-09-22", "digest", "r1", 1.25), row("2026-09-22", "digest", "r2", 0.25)]), "2026-09-20T00:00:00Z", "2026-09-23T00:00:00Z")!;
  assert.equal(report.total.usd, 2);
  assert.equal((report.shared.usd ?? 0) + (report.personal.usd ?? 0), report.total.usd);
  assert.deepEqual(report.series.map((point) => point.date), ["2026-09-20", "2026-09-21", "2026-09-22"]);
  assert.equal(report.subjects[0].key, "r1");
  assert.equal(report.perPayingSubjectDay, 1.5 / 2 / 3);
});

test("calls without prices are counted, never shown as zero dollars", () => {
  const report = buildCosts(dataset([row("2026-09-01", "translate", "u1", null, 4)], "month"), "2026-09-10T00:00:00Z", "2026-09-23T00:00:00Z")!;
  assert.equal(report.priced, false);
  assert.equal(report.total.usd, null);
  assert.equal(report.total.calls, 4, "a month overlapping the period belongs to it");
});

test("malformed spend is rejected instead of trimmed", () => {
  assert.throws(() => validateModelCosts({ capturedAt: "2026-09-23T00:00:00Z", granularity: "week", rows: [] }, "2026-09-23T12:00:00Z"));
  assert.throws(() => validateModelCosts({ capturedAt: "2026-09-23T00:00:00Z", granularity: "day", rows: [{ ...row("2026-09-22", "s", null, -1) }] }, "2026-09-23T12:00:00Z"));
});
