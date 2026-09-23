import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboard, formatAmount, validateDataset } from "./data";
import { makeDemoDataset } from "./demo";
import type { AnalyticsDataset, AnalyticsEvent } from "./types";

const now = "2026-09-08T00:00:00.000Z";
const at = (day: number, hour = 12): string => `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
let counter = 0;
const event = (subjectId: string, name: AnalyticsEvent["name"], occurredAt: string, extra: Partial<AnalyticsEvent> = {}): AnalyticsEvent => ({ id: `event-${counter++}`, subjectId, name, occurredAt, surface: "web", ...extra });
const dataset = (events: AnalyticsEvent[]): AnalyticsDataset => ({ schemaVersion: 1, mode: "local", product: { name: "Example", profile: "saas", firstValueLabel: "First result", currency: "USD" }, generatedAt: now, capabilities: { sessions: true, payments: true, identity: true, geography: true, lifecycle: true, crawlers: true }, events, health: { lastEventAt: events.at(-1)?.occurredAt ?? null, errors: 0 } });
const payment = (subject: string, day: number, extra: Partial<AnalyticsEvent> = {}): AnalyticsEvent => event(subject, "payment_succeeded", at(day, 15), { provider: "stripe", paymentId: `payment-${subject}`, amountMinor: 1_000, currency: "USD", currencyExponent: 2, ...extra });

test("provider ledger ignores replays and separates currencies without converting Stars", () => {
  const charge = payment("a", 1);
  const refund = event("a", "payment_refunded", at(2), { provider: "stripe", paymentId: charge.paymentId, refundId: "r1", amountMinor: 250, currency: "USD" });
  const result = buildDashboard(dataset([
    event("a", "product_entered", at(1), { source: "Google" }), charge, { ...charge }, { ...charge, id: "retry-different-envelope" },
    refund, { ...refund, id: "refund-retry" }, payment("b", 2, { provider: "lemonsqueezy", currency: "EUR", amountMinor: 5_000 }),
    payment("c", 3, { provider: "telegram-stars", currency: "XTR", currencyExponent: 0, amountMinor: 300 }),
  ]));
  assert.equal(result.overview.paymentCount, 1);
  assert.equal(result.overview.grossMinor, 1_000);
  assert.equal(result.overview.refundsMinor, 250);
  assert.equal(result.overview.revenueMinor, 750);
  assert.deepEqual(result.money.map((row) => [row.currency, row.netMinor]), [["EUR", 5_000], ["USD", 750], ["XTR", 300]]);
  assert.equal(result.health.replayedEvents, 3);
  assert.equal(formatAmount(300, "XTR"), "300 Stars");
  assert.equal(formatAmount(1000, "JPY"), "¥1,000");
  assert.equal(formatAmount(null, "USD"), "—");
});

test("refunds in a period reconcile against older charges and cannot exceed a charge", () => {
  const charge = payment("a", 1, { occurredAt: "2026-07-01T12:00:00.000Z" });
  const refund = event("a", "payment_refunded", at(3), { provider: "stripe", paymentId: charge.paymentId, refundId: "refund-a", amountMinor: 500, currency: "USD" });
  const result = buildDashboard(dataset([charge, refund]));
  assert.equal(result.overview.grossMinor, 0);
  assert.equal(result.overview.revenueMinor, -500);
  assert.throws(() => buildDashboard(dataset([charge, { ...refund, amountMinor: 1_001 }])), /exceeds/);
  assert.throws(() => buildDashboard(dataset([
    charge, { ...refund, amountMinor: 600 },
    { ...refund, id: "second-partial-refund", refundId: "refund-b", occurredAt: at(4), amountMinor: 500 },
  ])), /exceeds/);
  const orphan = buildDashboard(dataset([refund]));
  assert.equal(orphan.overview.revenueMinor, 0);
  assert.equal(orphan.health.orphanRefunds, 1);
  assert.match(orphan.health.warnings[0], /Unmatched/);
});

test("conflicting payment replays fail visibly", () => {
  const charge = payment("a", 1);
  assert.throws(() => buildDashboard(dataset([charge, { ...charge, id: "conflict", amountMinor: 2_000 }])), /Conflicting replay/);
  const otherProvider = { ...charge, provider: "lemonsqueezy", id: "other-provider" };
  assert.equal(buildDashboard(dataset([charge, otherProvider])).overview.grossMinor, 2_000);
  assert.throws(() => buildDashboard(dataset([charge, { ...charge, amountMinor: 2_000 }])), /Conflicting analytics event ID/);
  assert.throws(() => buildDashboard(dataset([charge, { ...charge, id: "huge", paymentId: "huge", amountMinor: Number.MAX_SAFE_INTEGER }])), /safe numerical range/);
});

test("source filters preserve original acquisition and select the whole person's path", () => {
  const result = buildDashboard(dataset([
    event("a", "product_entered", at(1), { source: "Newsletter", campaign: "launch", country: "Brazil" }),
    event("a", "first_value", at(2), { source: "Direct" }), payment("a", 3),
    event("b", "product_entered", at(1), { source: "Google", country: "Brazil" }), payment("b", 2),
    event("unknown", "product_entered", at(2)),
  ]), { source: "Newsletter", country: "Brazil" });
  assert.equal(result.overview.visitors, 1);
  assert.equal(result.overview.activated, 1);
  assert.equal(result.overview.revenueMinor, 1_000);
  assert.deepEqual(result.breakdowns.source.map((row) => row.key), ["Newsletter"]);
  assert.equal(result.users[0].id, "a");
  const unknown = buildDashboard(dataset([event("unknown", "product_entered", at(2))]), { source: "Unknown" });
  assert.equal(unknown.overview.visitors, 1);
  assert.equal(unknown.breakdowns.source[0].key, "Unknown");
});

test("7-day cohort conversion requires ordered steps, excludes immature entries, and matches overview", () => {
  const result = buildDashboard(dataset([
    event("complete", "product_entered", at(1, 0)), event("complete", "first_value", at(1, 1)), event("complete", "checkout_started", at(1, 2)), payment("complete", 1),
    event("wrong-order", "product_entered", at(1, 0)), payment("wrong-order", 1, { occurredAt: at(1, 1) }), event("wrong-order", "first_value", at(1, 2)), event("wrong-order", "checkout_started", at(1, 3)),
    event("new", "product_entered", at(7)), event("new", "first_value", at(7, 13)), event("new", "checkout_started", at(7, 14)), payment("new", 7),
  ]));
  assert.deepEqual(result.funnelCohort, { entered: 3, eligible: 2, immature: 1, windowDays: 7 });
  assert.deepEqual(result.funnel.map((row) => row.count), [2, 2, 1]);
  assert.equal(result.overview.conversionRate, 50);
  assert.equal(result.funnel[2].conversionRate, 50);
  assert.equal(result.breakdowns.source[0].conversionRate, 50);
});

test("landing attribution survives an entry without campaign fields and checkout is optional", () => {
  const result = buildDashboard(dataset([
    event("a", "page_viewed", at(1, 0), { source: "Newsletter", campaign: "launch" }),
    event("a", "product_entered", at(1, 0)), event("a", "first_value", at(1, 1)), payment("a", 1),
  ]), { campaign: "launch" });
  assert.equal(result.overview.visitors, 1);
  assert.equal(result.overview.conversionRate, 100);
  assert.equal(result.breakdowns.source[0].key, "Newsletter");
  assert.equal(result.breakdowns.source[0].cohortEligible, 1);
});

test("retention waits for a mature first-value cohort and only counts useful repeat actions", () => {
  const result = buildDashboard(dataset([
    event("returned", "first_value", at(1, 0)), event("returned", "value_repeated", at(3)),
    event("same-day", "first_value", at(1, 0)), event("same-day", "value_repeated", at(1, 2)),
    event("page-only", "first_value", at(1, 0)), event("page-only", "page_viewed", at(3)),
    event("immature", "first_value", at(3)), event("immature", "value_repeated", at(5)),
  ]));
  assert.equal(result.retention.eligible, 3);
  assert.equal(result.retention.returned, 1);
  assert.ok(Math.abs((result.retention.rate ?? 0) - 100 / 3) < 1e-10);
});

test("first value is a once-per-subject fact even if a producer retries with a new event ID", () => {
  const result = buildDashboard(dataset([
    event("a", "first_value", "2026-07-01T12:00:00.000Z"),
    event("a", "first_value", at(1)),
    event("a", "value_repeated", at(2)),
  ]));
  assert.equal(result.overview.activated, 0);
  assert.equal(result.health.replayedEvents, 1);
  assert.equal(result.retention.eligible, 0);
});

test("unconnected capabilities produce unavailable values, not misleading zeros", () => {
  const input = dataset([event("a", "product_entered", at(1), { country: "Brazil" })]);
  input.capabilities = { sessions: false, payments: false, identity: false, geography: false, lifecycle: false, crawlers: false };
  const result = buildDashboard(input);
  assert.equal(result.overview.revenueMinor, null);
  assert.equal(result.overview.conversionRate, null);
  assert.equal(result.overview.bounceRate, null);
  assert.equal(result.overview.returningRate, null);
  assert.equal(result.retention.rate, null);
  assert.equal(result.funnel[0].count, null);
  assert.deepEqual(result.breakdowns.country, []);
  assert.deepEqual(result.users, []);
});

test("date windows include exact start and exclude exact end, with complete midnight ranges", () => {
  const result = buildDashboard(dataset([
    event("before", "product_entered", "2026-08-08T23:59:59.999Z"),
    event("start", "product_entered", "2026-08-09T00:00:00.000Z"),
    event("end", "product_entered", now),
  ]), { rangeDays: 30 });
  assert.equal(result.range.days, 30);
  assert.equal(result.range.from, "2026-08-09T00:00:00.000Z");
  assert.equal(result.overview.visitors, 1);
  assert.equal(result.trend.length, 30);
  assert.throws(() => buildDashboard(dataset([]), { rangeDays: 0 }), /rangeDays/);
  assert.throws(() => buildDashboard(dataset([]), { from: now, to: at(1) }), /valid reporting range/);
  const future = buildDashboard(dataset([event("new", "product_entered", at(7))]), { to: "2026-12-31T00:00:00.000Z" });
  assert.equal(future.range.to, now);
  assert.equal(future.funnelCohort.eligible, 0);
});

test("daily KPI trends measure observed sessions and prior returning visitors", () => {
  const result = buildDashboard(dataset([
    event("a", "page_viewed", at(1, 0), { sessionId: "a-1" }),
    event("a", "product_entered", at(1, 0), { sessionId: "a-1" }),
    event("a", "session_activity", at(1, 1), { sessionId: "a-1", activeSeconds: 60 }),
    event("a", "session_activity", at(1, 2), { sessionId: "a-1", activeSeconds: 30 }),
    event("a", "first_value", at(1, 3), { sessionId: "a-1" }), payment("a", 1),
    event("a", "page_viewed", at(2, 0), { sessionId: "a-2" }),
    event("b", "page_viewed", at(2, 0), { sessionId: "b-1" }),
    event("b", "session_activity", at(2, 1), { sessionId: "b-1", activeSeconds: 10 }),
  ]));
  const first = result.trend.find((day) => day.date === "2026-09-01");
  const second = result.trend.find((day) => day.date === "2026-09-02");
  assert.equal(first?.sessionSeconds, 90);
  assert.equal(first?.bounceRate, 0);
  assert.equal(first?.revenuePerVisitorMinor, 1_000);
  assert.equal(first?.conversionRate, 100);
  assert.equal(second?.returningVisitors, 1);
  assert.equal(second?.pageviews, 2);
  assert.equal(second?.sessionSeconds, 10);
  assert.equal(second?.bounceRate, 0);
  assert.equal(second?.bounceEligibleSessions, 1);
  assert.equal(second?.bounceUnmeasuredSessions, 1);
  assert.equal(second?.conversionRate, null);
});

test("bounce only counts measured short sessions and leaves unmeasured sessions unknown", () => {
  const events: AnalyticsEvent[] = [];
  for (const [subject, seconds] of [["long", 60], ["short", 5], ["ten", 10], ["goal", 1], ["delta", 5]] as const) {
    events.push(event(subject, "page_viewed", at(1), { sessionId: subject }));
    events.push(event(subject, "session_activity", at(1, 13), { sessionId: subject, activeSeconds: seconds }));
  }
  events.push(event("goal", "goal_completed", at(1, 14), { sessionId: "goal", goal: "Useful result" }));
  events.push(event("delta", "session_activity", at(1, 14), { sessionId: "delta", activeSeconds: 5 }));
  events.push(event("missing", "page_viewed", at(1), { sessionId: "missing" }));
  events.push(event("empty", "page_viewed", at(2), { sessionId: "empty" }));
  events.push(event("empty", "session_activity", at(2, 13), { sessionId: "empty" }));
  const result = buildDashboard(dataset(events));
  assert.equal(result.overview.bounceRate, 20);
  assert.equal(result.overview.bounceEligibleSessions, 5);
  assert.equal(result.overview.bounceUnmeasuredSessions, 2);
  assert.equal(result.trend.find((day) => day.date === "2026-09-01")?.bounceRate, 20);
  const unknownDay = result.trend.find((day) => day.date === "2026-09-02");
  assert.equal(unknownDay?.bounceRate, null);
  assert.equal(unknownDay?.bounceEligibleSessions, 0);
  assert.equal(unknownDay?.bounceUnmeasuredSessions, 1);
  assert.ok(result.health.warnings.some((warning) => warning.includes("denominator: 5")));
});

test("revenue per visitor joins money to the same visitor population and daily window", () => {
  const result = buildDashboard(dataset([
    event("a", "page_viewed", at(1)), event("b", "page_viewed", at(2)),
    payment("a", 2, { amountMinor: 500 }), payment("unlinked", 2, { amountMinor: 10_000 }),
    payment("b", 2, { currency: "EUR", amountMinor: 20_000 }),
    event("a", "payment_refunded", at(3), { provider: "stripe", paymentId: "payment-a", refundId: "refund-a", amountMinor: 100, currency: "USD" }),
  ]));
  assert.equal(result.overview.visitors, 2);
  assert.equal(result.overview.revenueMinor, 10_400);
  assert.equal(result.overview.visitorRevenueMinor, 400);
  assert.equal(result.overview.revenuePerVisitorMinor, 200);
  assert.equal(result.overview.linkedPaymentCount, 1);
  assert.equal(result.overview.linkedPaymentCoverage, 50);
  const day = result.trend.find((row) => row.date === "2026-09-02");
  assert.equal(day?.revenueMinor, 10_500);
  assert.equal(day?.visitors, 1);
  assert.equal(day?.revenuePerVisitorMinor, 0);
  assert.equal(day?.linkedPaymentCoverage, 0);
  assert.equal(result.trend.find((row) => row.date === "2026-09-03")?.revenuePerVisitorMinor, null);
  const noIdentity = dataset([event("a", "page_viewed", at(1)), payment("a", 1)]);
  noIdentity.capabilities.identity = false;
  assert.equal(buildDashboard(noIdentity).overview.revenuePerVisitorMinor, null);
});

test("crawler requests never count as people and audience filters do not leak bot aggregates", () => {
  const input = dataset([
    event("bot", "crawler_requested", at(3), { surface: "landing", crawlerName: "ExampleBot", crawlerCategory: "answer", route: "/docs" }),
    event("person", "product_entered", at(3), { source: "ChatGPT" }),
  ]);
  const result = buildDashboard(input);
  assert.equal(result.overview.visitors, 1);
  assert.equal(result.crawlers[0].count, 1);
  assert.equal(result.breakdowns.source[0].key, "ChatGPT");
  assert.deepEqual(buildDashboard(input, { source: "ChatGPT" }).crawlers, []);
});

test("goal trends reconcile event totals across partial-day ranges and original acquisition filters", () => {
  const result = buildDashboard(dataset([
    event("a", "product_entered", at(1), { source: "Newsletter" }),
    event("b", "product_entered", at(1), { source: "Google" }),
    event("a", "goal_completed", at(2, 11), { goal: "Pricing" }),
    event("a", "goal_completed", at(2, 12), { goal: "Pricing" }),
    event("a", "goal_completed", at(3), { goal: "Pricing", source: "Direct" }),
    event("a", "first_value", at(3, 13)),
    event("a", "first_value", at(4, 13)),
    event("a", "checkout_started", at(4, 14)),
    event("a", "outbound_clicked", at(4, 15), { goal: "Download" }),
    event("a", "goal_completed", at(4, 16)),
    event("a", "goal_completed", at(4, 17), { goal: "__proto__" }),
    event("b", "goal_completed", at(3), { goal: "Google only" }),
    event("a", "goal_completed", at(5, 12), { goal: "Pricing" }),
  ]), { from: at(2, 12), to: at(5, 12), source: "Newsletter" });

  assert.deepEqual(result.goalTrend.map((row) => row.date), ["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
  assert.equal(result.goals.reduce((total, goal) => total + goal.count, 0), 7);
  assert.equal(result.goals.find((goal) => goal.key === "Pricing")?.visitors, 1);
  assert.equal(result.goals.find((goal) => goal.key === "Pricing")?.count, 2);
  assert.ok(!result.goals.some((goal) => goal.key === "Google only"));
  for (const goal of result.goals) {
    assert.equal(result.goalTrend.reduce((total, row) => total + row.values[goal.key], 0), goal.count);
  }
  assert.equal(result.goalTrend[0].values.Pricing, 1);
  assert.equal(result.goalTrend[1].values.Pricing, 1);
  assert.equal(result.goalTrend[2].values.first_value, 0);
  assert.equal(result.goalTrend[2].values.__proto__, 1);
  assert.ok(Object.values(result.goalTrend[3].values).every((count) => count === 0));
});

test("crawler trends reconcile categories and range boundaries without counting duplicate requests or humans", () => {
  const first = event("bot", "crawler_requested", at(2, 0), { crawlerName: "ExampleBot", crawlerCategory: "answer" });
  const input = dataset([
    first, { ...first },
    event("bot", "crawler_requested", at(4), { crawlerName: "ExampleBot", crawlerCategory: "answer" }),
    event("bot-index", "crawler_requested", at(3), { crawlerName: "ExampleBot", crawlerCategory: "indexing" }),
    event("bot-training", "crawler_requested", at(5), { crawlerName: "OtherBot", crawlerCategory: "training" }),
    event("old-bot", "crawler_requested", at(1, 23), { crawlerName: "ExampleBot", crawlerCategory: "answer" }),
    event("future-bot", "crawler_requested", at(6, 0), { crawlerName: "ExampleBot", crawlerCategory: "answer" }),
    event("person", "page_viewed", at(3), { source: "ChatGPT", crawlerName: "IgnoredHumanProperty" }),
  ]);
  const filters = { from: at(2, 0), to: at(6, 0) };
  const result = buildDashboard(input, filters);
  assert.equal(result.overview.visitors, 1);
  assert.deepEqual(result.crawlerTrend.map((row) => row.date), result.trend.map((row) => row.date));
  assert.equal(result.crawlerSeries.length, 3);
  assert.equal(result.crawlers.reduce((total, crawler) => total + crawler.count, 0), 4);
  for (const series of result.crawlerSeries) {
    const aggregate = result.crawlers.find((row) => row.name === series.name && row.category === series.category);
    assert.equal(result.crawlerTrend.reduce((total, row) => total + row.values[series.key], 0), aggregate?.count);
  }
  assert.equal(result.crawlerTrend[0].values["answer:ExampleBot"], 1);
  assert.equal(result.crawlerTrend[1].values["indexing:ExampleBot"], 1);
  assert.equal(result.crawlerTrend[1].values["answer:ExampleBot"], 0);
  for (const audienceFilter of [{ source: "ChatGPT" }, { country: "Brazil" }, { device: "Desktop" }, { campaign: "launch" }]) {
    const filtered = buildDashboard(input, { ...filters, ...audienceFilter });
    assert.deepEqual(filtered.crawlers, []);
    assert.deepEqual(filtered.crawlerTrend, []);
    assert.deepEqual(filtered.crawlerSeries, []);
  }
  input.capabilities.crawlers = false;
  const unavailable = buildDashboard(input, filters);
  assert.deepEqual(unavailable.crawlers, []);
  assert.deepEqual(unavailable.crawlerTrend, []);
  assert.deepEqual(unavailable.crawlerSeries, []);
});

test("empty goal and crawler aggregates do not invent chart series", () => {
  const result = buildDashboard(dataset([event("person", "page_viewed", at(3))]));
  assert.deepEqual(result.goals, []);
  assert.deepEqual(result.goalTrend, []);
  assert.deepEqual(result.crawlers, []);
  assert.deepEqual(result.crawlerTrend, []);
  assert.deepEqual(result.crawlerSeries, []);
});

test("email outcomes require a prior click and never infer causal lift", () => {
  const result = buildDashboard(dataset([
    event("a", "product_entered", at(1), { source: "Google" }),
    event("a", "email_sent", at(2), { campaign: "welcome" }),
    event("a", "email_delivered", at(2, 13), { campaign: "welcome" }),
    event("a", "first_value", at(2, 14)),
    event("a", "email_clicked", at(3), { campaign: "welcome" }), payment("a", 4),
  ]));
  assert.equal(result.lifecycle[0].sent, 1);
  assert.equal(result.lifecycle[0].activated, 0);
  assert.equal(result.lifecycle[0].paid, 1);
});

test("validation rejects malformed events, arbitrary properties, raw query strings, and client-like payment payloads", () => {
  const input = dataset([event("a", "product_entered", at(1))]);
  assert.equal(validateDataset(input), input);
  assert.throws(() => validateDataset({ ...input, events: [{ ...input.events[0], route: "/app?email=test@example.invalid" }] }), /Routes/);
  assert.throws(() => validateDataset({ ...input, events: [{ ...input.events[0], arbitraryPayload: "text" }] }), /allowlist/);
  assert.throws(() => validateDataset(dataset([event("a", "payment_succeeded", at(1))])), /Payments require/);
  assert.throws(() => validateDataset({ ...input, generatedAt: "yesterday" }), /timestamp/);
});

test("synthetic demo is deterministic, validates, and supports every product profile", () => {
  for (const profile of ["saas", "telegram", "mobile", "desktop", "api"] as const) {
    const input = makeDemoDataset(profile, now);
    validateDataset(input);
    assert.deepEqual(input, makeDemoDataset(profile, now));
    const result = buildDashboard(input);
    assert.ok(result.overview.visitors > 0);
    assert.ok(result.funnelCohort.eligible > 0);
    assert.ok(result.overview.conversionRate !== null);
    assert.ok(result.crawlers.length > 0);
    assert.ok(result.lifecycle.length > 0);
    if (profile === "telegram") assert.equal(result.currencyExponent, 0);
  }
});
