import test from "node:test";
import assert from "node:assert/strict";
import { placementLink, placementStats, validatePlacements } from "./placements";
import { makeDemoDataset } from "./demo";
import type { AnalyticsEvent } from "./types";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 0, minute)).toISOString();
const event = (id: string, subjectId: string, name: AnalyticsEvent["name"], minute: number, campaign?: string): AnalyticsEvent =>
  ({ id, subjectId, name, occurredAt: at(minute), surface: "telegram", ...(campaign ? { campaign } : {}) });
const item = (code: string) => ({ code, name: code, channel: "telegram", costMinor: 1500, currency: "USD", createdAt: at(0), retiredAt: null });

test("links carry the code in the entry itself; a host-built link wins", () => {
  assert.equal(placementLink({ kind: "telegram_start", bot: "demo_bot" }, { code: "ab12" }), "https://t.me/demo_bot?start=c_ab12");
  assert.equal(placementLink({ kind: "url_ref", url: "https://example.com/start?x=1" }, { code: "ab12" }), "https://example.com/start?x=1&ref=c_ab12");
  assert.equal(placementLink(null, { code: "ab12", link: "https://t.me/b?start=a1-signed" }), "https://t.me/b?start=a1-signed");
  assert.equal(placementLink(null, { code: "ab12" }), null);
});

test("first entry decides the placement; unknown codes are unattributed", () => {
  const dataset = {
    ...makeDemoDataset("telegram", "2026-09-23T00:00:00Z"),
    events: [
      event("1", "a", "product_entered", 1, "ab12"), event("2", "a", "first_value", 2),
      event("3", "a", "product_entered", 3, "zz99"),
      event("4", "b", "product_entered", 4, "nosuch"),
      event("5", "c", "product_entered", 5, "zz99"), event("6", "c", "value_repeated", 9),
    ],
    placements: { entry: null, items: [item("ab12"), item("zz99")] },
  };
  const { rows, unattributed } = placementStats(dataset);
  assert.deepEqual(rows.find((r) => r.code === "ab12"), { code: "ab12", entered: 1, activated: 1, returned: 0 });
  assert.deepEqual(rows.find((r) => r.code === "zz99"), { code: "zz99", entered: 1, activated: 0, returned: 1 }, "a known person's second link is a visit");
  assert.equal(unattributed.entered, 1);
});

test("registry rejects codes a start payload cannot carry and non-https links", () => {
  assert.throws(() => validatePlacements({ entry: null, items: [item("AB12")] }));
  assert.throws(() => validatePlacements({ entry: null, items: [{ ...item("ab12"), link: "http://t.me/x" }] }));
  assert.throws(() => validatePlacements({ entry: { kind: "telegram_start", bot: "a b" }, items: [] }));
  validatePlacements({ entry: { kind: "url_ref", url: "https://example.com" }, items: [item("ab12")] });
});
