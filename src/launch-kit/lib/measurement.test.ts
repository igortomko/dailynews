import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboard, validateDataset } from "./data";
import type { AnalyticsDataset, AnalyticsEvent, ProductMeasurement } from "./types";

const HOUR = 3_600_000;
const origin = Date.parse("2026-09-01T00:00:00.000Z");
const at = (hours: number): string => new Date(origin + hours * HOUR).toISOString();
let sequence = 0;
const event = (subjectId: string, name: AnalyticsEvent["name"], hour: number, extra: Partial<AnalyticsEvent> = {}): AnalyticsEvent => ({ id: `measurement-${sequence++}`, subjectId, name, occurredAt: at(hour), surface: "telegram", ...extra });
const rating = (subject: string, hour: number, goal = "review_rated"): AnalyticsEvent => event(subject, "goal_completed", hour, { goal });
const measurement = (): ProductMeasurement => ({
  audienceLabel: "Active learners",
  activationLabel: "Five ratings in 48 hours",
  description: "Independent learning milestones and a mature start cohort.",
  activationWindowHours: 48,
  funnel: { label: "Learning milestones", mode: "independent", steps: [
    { key: "entered", label: "Entered", event: "product_entered" },
    { key: "registered", label: "Registered", event: "registered" },
    { key: "review-rated", label: "Rated a card", event: "goal_completed", goal: "review_rated" },
    { key: "activated", label: "Five ratings in 48 hours", event: "first_value" },
  ] },
  retention: { label: "D7 retention", anchor: "product_entered", event: "goal_completed", goal: "review_rated", startHours: 120, endHours: 216 },
});
const dataset = (events: AnalyticsEvent[]): AnalyticsDataset => ({
  schemaVersion: 1, mode: "local", product: { name: "Learning example", profile: "telegram", firstValueLabel: "Five ratings", currency: "USD" },
  generatedAt: at(240), capabilities: { sessions: false, payments: false, identity: true, geography: false, lifecycle: false, crawlers: false },
  events, health: { lastEventAt: events.at(-1)?.occurredAt ?? null, errors: 0 }, measurement: measurement(),
});

test("independent milestones allow later stages without earlier stages and never infer drop-offs", () => {
  const result = buildDashboard(dataset([
    event("a", "product_entered", 0), event("a", "registered", 1), rating("a", 2), event("a", "first_value", 3),
    event("b", "product_entered", 0), rating("b", 2),
    event("c", "product_entered", 0), rating("c", 2, "unrelated_goal"),
  ]), { from: at(0) });
  assert.deepEqual(result.funnel.map((step) => step.count), [3, 1, 2, 1]);
  assert.ok(result.funnel.every((step) => step.dropoffRate === null));
  assert.ok(Math.abs((result.funnel[2].conversionRate ?? 0) - 200 / 3) < 1e-10);
  assert.equal(result.funnelCohort.mode, "independent");
  assert.equal(result.funnelCohort.label, "Learning milestones");
  assert.equal(result.journeys.find((row) => row.id === "b")?.steps.at(-1)?.goal, "review_rated");
  assert.equal(result.measurement?.audienceLabel, "Active learners");
});

test("independent stages can occur after 48 hours while activation remains bounded", () => {
  const result = buildDashboard(dataset([
    event("a", "registered", -1), event("a", "product_entered", 0), rating("a", 200), event("a", "first_value", 201),
    event("b", "product_entered", 0), event("b", "first_value", 1), event("b", "registered", 200),
    rating("b", 240),
  ]), { from: at(0) });
  assert.deepEqual(result.funnel.map((step) => step.count), [2, 1, 1, 1]);
  assert.equal(result.overview.activationRate, 50);
});

test("48-hour activation uses mature entry cohorts and a strict upper boundary", () => {
  const input = dataset([
    event("before", "product_entered", 0), event("before", "first_value", 48 - 1 / HOUR),
    event("exact", "product_entered", 0), event("exact", "first_value", 48),
    event("late", "product_entered", 0), event("late", "first_value", 49),
    event("young", "product_entered", 239), event("young", "first_value", 239.5),
    event("matures-now", "product_entered", 192), event("matures-now", "first_value", 193),
  ]);
  const result = buildDashboard(input, { from: at(0) });
  assert.deepEqual(result.activationCohort, { eligible: 4, activated: 2, immature: 1, windowHours: 48 });
  assert.equal(result.overview.activationRate, 50);
  assert.equal(result.overview.activated, 5);
  assert.equal(result.trend.reduce((total, day) => total + day.activated, 0), 5);
  assert.equal(result.funnel.at(-1)?.count, 3);
  assert.equal(result.funnel.at(-1)?.conversionRate, 60);
  assert.equal(result.funnelCohort.entered, 5);
  assert.equal(result.funnelCohort.immature, 1);

  const newOnly = buildDashboard(dataset([event("new", "product_entered", 239), event("new", "first_value", 239.5)]));
  assert.equal(newOnly.overview.activationRate, null);
  assert.equal(newOnly.activationCohort?.immature, 1);
  assert.equal(newOnly.funnel.at(-1)?.count, 1);
});

test("D7 requires the configured rating in [120h,216h) after entry and a fully observed cohort", () => {
  const result = buildDashboard(dataset([
    event("lower", "product_entered", 0), rating("lower", 120),
    event("upper", "product_entered", 0), rating("upper", 216),
    event("early", "product_entered", 0), rating("early", 120 - 1 / HOUR),
    event("last-millisecond", "product_entered", 0), rating("last-millisecond", 216 - 1 / HOUR),
    event("wrong-goal", "product_entered", 0), rating("wrong-goal", 150, "onboarding_completed"),
    event("young", "product_entered", 25), rating("young", 145),
    event("no-first-value", "product_entered", 0), rating("no-first-value", 150),
  ]), { from: at(0) });
  assert.deepEqual(result.retention, { eligible: 6, returned: 3, rate: 50, windowDays: 9 });
  assert.equal(result.measurement?.retention.label, "D7 retention");
  const boundary = dataset([event("matures-now", "product_entered", 24), rating("matures-now", 144)]);
  assert.equal(buildDashboard(boundary).retention.eligible, 1);
  assert.equal(buildDashboard(boundary, { to: at(240 - 1 / HOUR) }).retention.eligible, 0);
});

test("source, campaign and date filters apply to the same first-entry cohort without changing attribution", () => {
  const input = dataset([
    event("selected", "product_entered", 0, { source: "Newsletter", campaign: "launch" }), event("selected", "first_value", 1, { source: "Direct" }), rating("selected", 144),
    event("other", "product_entered", 0, { source: "Google", campaign: "launch" }), event("other", "first_value", 1), rating("other", 144),
    event("old", "product_entered", -1, { source: "Newsletter", campaign: "launch" }), event("old", "first_value", 2), rating("old", 144),
    event("young", "product_entered", 216, { source: "Newsletter", campaign: "launch" }), event("young", "first_value", 217),
    event("next-campaign", "product_entered", 0, { source: "Newsletter", campaign: "other" }),
    event("at-end", "product_entered", 240, { source: "Newsletter", campaign: "launch" }),
  ]);
  const filters = { from: at(0), source: "Newsletter", campaign: "launch" };
  const result = buildDashboard(input, filters);
  assert.equal(result.overview.visitors, 3);
  assert.equal(result.overview.activated, 3);
  assert.deepEqual(result.activationCohort, { eligible: 1, activated: 1, immature: 1, windowHours: 48 });
  assert.equal(result.funnel[0].count, 2);
  assert.deepEqual(result.retention, { eligible: 1, returned: 1, rate: 100, windowDays: 9 });
  assert.equal(result.breakdowns.source[0].key, "Newsletter");
  assert.equal(result.breakdowns.source[0].activated, 3);
  const earlier = buildDashboard(input, { ...filters, to: at(144) });
  assert.equal(earlier.funnel[2].count, 0);
  assert.equal(earlier.retention.eligible, 0);
});

test("product measurements respect unavailable identity and do not substitute learning for payment conversion", () => {
  const input = dataset([event("a", "product_entered", 0), event("a", "first_value", 1), rating("a", 144)]);
  input.capabilities.identity = false;
  const result = buildDashboard(input);
  assert.equal(result.overview.activationRate, null);
  assert.equal(result.retention.rate, null);
  assert.ok(result.funnel.every((step) => step.count === null && step.conversionRate === null));
  input.capabilities.identity = true;
  input.capabilities.payments = true;
  input.events.push(event("a", "payment_succeeded", 2, { paymentId: "charge-a", provider: "example", amountMinor: 1000, currency: "USD" }));
  const connected = buildDashboard(input);
  assert.equal(connected.overview.revenueMinor, 1000);
  assert.equal(connected.overview.conversionRate, null);
  assert.ok(connected.trend.every((day) => day.conversionRate === null));
  assert.equal(connected.breakdowns.source[0].conversionRate, null);
});

test("measurement validation rejects unknown fields, events, duplicate stages and invalid hour bounds", () => {
  const input = dataset([]);
  assert.equal(validateDataset(input), input);
  const invalid = [
    { ...measurement(), hiddenData: {} },
    { ...measurement(), audienceLabel: " " },
    { ...measurement(), activationLabel: "a".repeat(161) },
    { ...measurement(), activationWindowHours: 0 },
    { ...measurement(), activationWindowHours: Infinity },
    { ...measurement(), activationWindowHours: NaN },
    { ...measurement(), activationWindowHours: 366 * 24 + 1 },
    { ...measurement(), funnel: { ...measurement().funnel, hiddenData: {} } },
    { ...measurement(), funnel: { ...measurement().funnel, mode: "ordered" } },
    { ...measurement(), funnel: { ...measurement().funnel, steps: [] } },
    { ...measurement(), funnel: { ...measurement().funnel, steps: Array.from({ length: 13 }, (_, index) => ({ key: `step-${index}`, label: "Step", event: "product_entered" })) } },
    { ...measurement(), funnel: { ...measurement().funnel, steps: [measurement().funnel.steps[0], measurement().funnel.steps[0]] } },
    { ...measurement(), funnel: { ...measurement().funnel, steps: [{ key: "bad", label: "Bad", event: "review_rated" }] } },
    { ...measurement(), funnel: { ...measurement().funnel, steps: [{ key: "bad", label: "Bad", event: "goal_completed", properties: {} }] } },
    { ...measurement(), retention: { ...measurement().retention, anchor: "first_value" } },
    { ...measurement(), retention: { ...measurement().retention, event: "unknown" } },
    { ...measurement(), retention: { ...measurement().retention, goal: "" } },
    { ...measurement(), retention: { ...measurement().retention, goal: "private value" } },
    { ...measurement(), retention: { ...measurement().retention, startHours: -1 } },
    { ...measurement(), retention: { ...measurement().retention, startHours: 216 } },
    { ...measurement(), retention: { ...measurement().retention, endHours: Infinity } },
    { ...measurement(), retention: { ...measurement().retention, extra: true } },
  ];
  for (const value of invalid) assert.throws(() => validateDataset({ ...input, measurement: value }), /measurement/);
});

test("measurement descriptions allow 500 characters while labels and goal keys retain their bounds", () => {
  const input = dataset([]);
  assert.ok(input.measurement);
  const definition = input.measurement;
  definition.description = "а".repeat(500);
  definition.funnel.steps[0].key = "A".repeat(100);
  definition.retention.goal = "g".repeat(120);
  assert.equal(validateDataset(input), input);
  for (const description of ["а".repeat(501), "valid\ninvalid", " "]) {
    assert.throws(() => validateDataset({ ...input, measurement: { ...definition, description } }), /measurement/);
  }
  assert.throws(() => validateDataset({ ...input, measurement: { ...definition, audienceLabel: "a".repeat(161) } }), /measurement/);
  assert.throws(() => validateDataset({ ...input, measurement: { ...definition, retention: { ...definition.retention, goal: "g".repeat(121) } } }), /measurement/);
});

test("historical comparisons mature cohorts at period end and never reinterpret a later entry as first contact", () => {
  const input = dataset([
    event("old", "product_entered", 0), event("old", "product_entered", 73), event("old", "first_value", 74),
    event("young-at-period-end", "product_entered", 72), event("young-at-period-end", "first_value", 75),
    event("after-period", "product_entered", 97), event("after-period", "first_value", 98),
  ]);
  const result = buildDashboard(input, { from: at(48), to: at(96) });
  assert.equal(result.funnel[0].count, 1);
  assert.equal(result.overview.activated, 2);
  assert.deepEqual(result.activationCohort, { eligible: 0, activated: 0, immature: 1, windowHours: 48 });
  assert.equal(result.overview.activationRate, null);
  assert.equal(result.retention.eligible, 0);
});

test("datasets without measurement retain ordered 7-day defaults", () => {
  const input = dataset([event("a", "product_entered", 0), event("a", "first_value", 1), event("a", "value_repeated", 24)]);
  delete input.measurement;
  const result = buildDashboard(input);
  assert.equal(result.measurement, undefined);
  assert.equal(result.activationCohort, undefined);
  assert.deepEqual(result.funnelCohort, { entered: 1, eligible: 1, immature: 0, windowDays: 7 });
  assert.deepEqual(result.funnel.map((step) => step.count), [1, 1, null]);
  assert.equal(result.overview.activationRate, 100);
  assert.equal(result.retention.windowDays, 7);
});
