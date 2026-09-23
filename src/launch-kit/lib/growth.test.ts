import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboard, validateDataset } from "./data";
import type { AnalyticsDataset, AnalyticsEvent, AnalyticsUserProfile, LearnerSnapshot } from "./types";

const HOUR = 3_600_000;
const origin = Date.parse("2026-09-01T00:00:00.000Z");
const at = (hour: number): string => new Date(origin + hour * HOUR).toISOString();
let counter = 0;
const event = (subjectId: string, name: AnalyticsEvent["name"], hour: number, extra: Partial<AnalyticsEvent> = {}): AnalyticsEvent => ({ id: `growth-${counter++}`, subjectId, name, occurredAt: at(hour), surface: "telegram", ...extra });
const entry = (id: string, hour = 0, source = "Newsletter", medium = "Social"): AnalyticsEvent => event(id, "product_entered", hour, { source, medium });
const review = (id: string, hour: number): AnalyticsEvent => event(id, "goal_completed", hour, { goal: "review_rated" });
const dataset = (events: AnalyticsEvent[]): AnalyticsDataset => ({
  schemaVersion: 1, mode: "local", product: { name: "Learning example", profile: "telegram", firstValueLabel: "Five ratings", currency: "USD" }, generatedAt: at(240),
  capabilities: { sessions: false, payments: false, identity: true, geography: false, lifecycle: false, crawlers: false }, events, health: { lastEventAt: null, errors: 0 },
  measurement: { audienceLabel: "Learners", activationLabel: "Five ratings", description: "Learning milestones", activationWindowHours: 48,
    funnel: { label: "Learning", mode: "independent", steps: [{ key: "entered", label: "Entered", event: "product_entered" }, { key: "activated", label: "Five ratings", event: "first_value" }] },
    retention: { label: "D7 learning", anchor: "product_entered", event: "goal_completed", goal: "review_rated", startHours: 120, endHours: 216 },
  },
});
const profile = (id: string): AnalyticsUserProfile => ({ subjectId: id, displayName: "Example Learner", username: "example_learner", createdAt: at(0), onboardingCompletedAt: at(1), locale: "pt-BR", reminders: { enabled: true, time: "09:30", timezone: "America/Sao_Paulo" } });
const learner = (id: string): LearnerSnapshot => ({ subjectId: id, cards: 10, xp: 20, familiar: 3, mastered: 1, due: 2, reviews: 15, lapses: 1, firstCardAt: at(1), lastReviewedAt: at(144), states: [{ key: "review", count: 10 }], ratings: [{ key: "Good", count: 15 }], reviewDays: [{ date: "2026-09-07", count: 15 }], packs: [{ title: "Essential words", cards: 10, addedAt: at(1) }] });

test("DAU and WAU use trailing hours independently of the selected period and ignore automatic outbound events", () => {
  const input = dataset([
    entry("inside"), review("inside", 239), entry("daily-edge"), review("daily-edge", 216),
    entry("before-daily"), review("before-daily", 216 - 1 / HOUR), entry("weekly-edge"), review("weekly-edge", 72),
    entry("before-weekly"), review("before-weekly", 72 - 1 / HOUR), entry("outbound"), event("outbound", "email_sent", 239), event("outbound", "email_delivered", 239),
    entry("crawler"), event("crawler", "crawler_requested", 239), entry("link"), event("link", "outbound_clicked", 239),
    entry("other", 0, "Google"), review("other", 239), entry("future"), review("future", 240),
  ]);
  const result = buildDashboard(input, { from: at(230), source: "Newsletter" });
  assert.equal(result.growth.dau, 3);
  assert.equal(result.growth.wau, 5);
  assert.equal(result.growth.newUsers, 0);
  assert.equal(result.overview.visitors, 2);
  assert.equal(result.growth.daily.reduce((total, row) => total + row.reviews, 0), 1);
  assert.equal(result.growth.asOf, at(240));
  assert.equal(buildDashboard(input, { from: at(0), source: "Newsletter" }).growth.dau, 3);
  assert.equal(buildDashboard(input, { from: at(0), source: "Newsletter" }).growth.wau, 5);
});

test("new learners use the first-ever entry and daily charts count reviews separately from active learners", () => {
  const input = dataset([
    entry("old", -1), entry("old", 1), review("old", 2), review("old", 3),
    entry("new", 0), event("new", "goal_completed", 1, { goal: "progress_opened" }), review("new", 2),
    entry("after", 240), review("after", 240),
  ]);
  const result = buildDashboard(input, { from: at(0) });
  assert.equal(result.growth.newUsers, 1);
  assert.deepEqual(result.growth.daily[0], { date: "2026-09-01", newUsers: 1, active: 2, reviews: 3 });
});

test("D1 and D2 are half-open mature entry cohorts, and configured D7 remains a useful review", () => {
  const input = dataset([
    entry("lower"), event("lower", "goal_completed", 24, { goal: "progress_opened" }), review("lower", 120),
    entry("middle"), event("middle", "goal_completed", 48, { goal: "profile_opened" }),
    entry("upper"), review("upper", 72),
    entry("outbound"), event("outbound", "email_sent", 24), event("outbound", "email_delivered", 48),
    entry("young", 193), review("young", 217),
    entry("matures-d1", 192), review("matures-d1", 216),
  ]);
  const result = buildDashboard(input, { from: at(0) });
  assert.deepEqual(result.growth.d1, { eligible: 5, count: 2, immature: 1, rate: 40, label: "D1", anchor: "product_entered", startHours: 24, endHours: 48 });
  assert.deepEqual(result.growth.d2, { eligible: 4, count: 1, immature: 2, rate: 25, label: "D2", anchor: "product_entered", startHours: 48, endHours: 72 });
  assert.equal(result.growth.d7.eligible, result.retention.eligible);
  assert.equal(result.growth.d7.count, result.retention.returned);
  assert.equal(result.growth.d7.rate, result.retention.rate);
  assert.equal(result.growth.d7.count, 1);
});

test("source quality separates channel and source with mature denominators and first-touch attribution", () => {
  const input = dataset([
    entry("social", 0, "Partner", "Social"), event("social", "first_value", 2, { source: "Direct" }), review("social", 24), review("social", 48), review("social", 120),
    entry("email", 0, "Partner", "Email"), review("email", 24),
    entry("young", 239, "Partner", "Social"), event("young", "first_value", 239.5),
    entry("old", -1, "Partner", "Social"), review("old", 24),
  ]);
  const result = buildDashboard(input, { from: at(0), source: "Partner" });
  assert.equal(result.growth.sourceQuality.length, 2);
  const social = result.growth.sourceQuality.find((row) => row.channel === "Social");
  assert.equal(social?.starts, 2);
  assert.deepEqual(social?.activation, { eligible: 1, count: 1, immature: 1, rate: 100, windowHours: 48 });
  assert.equal(social?.d1.count, 1);
  assert.equal(social?.d2.rate, 100);
  assert.equal(social?.d7.rate, 100);
  assert.equal(result.growth.sourceQuality.find((row) => row.channel === "Email")?.activation.rate, 0);
});

test("profiles and learning enrich all matching users without changing period activity counts", () => {
  const input = dataset([entry("a"), review("a", 144), entry("b", 0, "Google")]);
  input.profiles = [profile("a"), profile("b"), profile("without-events")];
  input.learning = { capturedAt: at(240), learners: [learner("a"), learner("b")] };
  validateDataset(input);
  const result = buildDashboard(input, { from: at(216), source: "Newsletter" });
  assert.equal(result.overview.visitors, 0);
  assert.equal(result.users.length, 1);
  assert.equal(result.users[0].profile?.displayName, "Example Learner");
  assert.equal(result.users[0].profileCapturedAt, at(240));
  assert.equal(result.users[0].events, 0);
  assert.equal(result.users[0].lifetimeEvents, 2);
  assert.equal(result.users[0].learning?.cards, 10);
  assert.equal(result.learning?.cards, 10);
  assert.equal(result.learning?.learners, 1);
  assert.deepEqual(result.learning?.ratings, [{ key: "Good", count: 15 }]);
  assert.equal(buildDashboard(input, { from: at(0) }).users.length, 3);
  const historic = buildDashboard(input, { from: at(0), to: at(216) });
  assert.equal(historic.learning, undefined);
  assert.ok(historic.users.every((user) => user.learning === undefined));
  input.capabilities.identity = false;
  const unavailable = buildDashboard(input);
  assert.deepEqual(unavailable.users, []);
  assert.deepEqual(unavailable.journeys, []);
  assert.equal(unavailable.learning, undefined);
  assert.equal(unavailable.growth.dau, null);
  assert.equal(unavailable.growth.d1.eligible, null);
  assert.deepEqual(unavailable.growth.sourceQuality, []);
});

test("every user has a bounded lifetime journey, including users after the former first-50 cutoff", () => {
  const events = Array.from({ length: 65 }, (_, index) => entry(`person-${index}`, index));
  events.push(...Array.from({ length: 80 }, (_, index) => review("person-64", 100 + index)));
  events.push(review("person-64", 220));
  const result = buildDashboard(dataset(events), { from: at(180), to: at(200) });
  assert.equal(result.users.length, 65);
  assert.equal(result.journeys.length, 65);
  const journey = result.journeys.find((row) => row.id === "person-64");
  assert.equal(journey?.totalSteps, 81);
  assert.equal(journey?.truncated, true);
  assert.equal(journey?.steps.length, 60);
  assert.equal(journey?.steps.at(-1)?.occurredAt, at(179));
  assert.equal(result.users.find((row) => row.id === "person-64")?.events, 0);
  assert.equal(result.users.find((row) => row.id === "person-64")?.lifetimeEvents, 81);
  assert.equal(result.users[0].profile, undefined);
});

test("early completed milestones and their first timestamps survive the last-60 journey limit", () => {
  const input = dataset([
    entry("established"), event("established", "goal_completed", 1, { goal: "first_card" }), event("established", "first_value", 2),
    ...Array.from({ length: 80 }, (_, index) => event("established", "goal_completed", 10 + index, { goal: `extra_goal_${index}` })),
    event("established", "goal_completed", 239, { goal: "first_card" }),
    event("established", "payment_succeeded", 240, { provider: "example", paymentId: "future", amountMinor: 100, currency: "USD" }),
  ]);
  input.measurement?.funnel.steps.push({ key: "first-card", label: "First card", event: "goal_completed", goal: "first_card" });
  const journey = buildDashboard(input, { from: at(216) }).journeys[0];
  assert.equal(journey.truncated, true);
  assert.equal(journey.steps.length, 60);
  assert.ok(journey.steps.every((step) => step.name !== "first_value"));
  assert.equal(journey.milestones.find((step) => step.name === "first_value")?.occurredAt, at(2));
  assert.equal(journey.milestones.find((step) => step.name === "goal_completed" && step.goal === "first_card")?.occurredAt, at(1));
  assert.equal(journey.milestones.filter((step) => step.goal?.startsWith("extra_goal")).length, 0);
  assert.equal(journey.milestones.length, 4);
  assert.equal(journey.milestones.some((step) => step.name === "payment_succeeded"), false);
});

test("private extension validation rejects unsafe or untyped fields and invalid learning bounds", () => {
  const input = dataset([]);
  const invalidProfiles: unknown[] = [
    [{ ...profile("a"), telegramUserId: "123" }], [profile("a"), profile("a")], [{ ...profile("a"), displayName: "line\nline" }],
    [{ ...profile("a"), username: "@handle" }], [{ ...profile("a"), locale: "<script>" }],
    [{ ...profile("a"), reminders: { enabled: true, time: "25:00", timezone: "UTC" } }],
    [{ ...profile("a"), reminders: { enabled: true, time: "09:00", timezone: "invalid-time-zone" } }],
    [{ ...profile("a"), reminders: { enabled: true, time: "09:00", timezone: "UTC", token: "private" } }],
  ];
  for (const profiles of invalidProfiles) assert.throws(() => validateDataset({ ...input, profiles }), /profile/i);
  const invalidLearners: unknown[] = [
    [{ ...learner("a"), cards: -1 }], [{ ...learner("a"), xp: 0.5 }], [{ ...learner("a"), reviews: 1_000_000_001 }],
    [{ ...learner("a"), due: Infinity }], [{ ...learner("a"), context: "private" }], [learner("a"), learner("a")],
    [{ ...learner("a"), states: [{ key: "review", count: 1 }, { key: "review", count: 1 }] }],
    [{ ...learner("a"), ratings: [{ key: "Good", count: 1, userInput: "private" }] }],
    [{ ...learner("a"), reviewDays: [{ date: "2026-02-30", count: 1 }] }],
    [{ ...learner("a"), packs: [{ title: "Words", cards: 1, addedAt: at(1), payload: "private" }] }],
    [{ ...learner("a"), lastReviewedAt: "yesterday" }],
  ];
  for (const learners of invalidLearners) assert.throws(() => validateDataset({ ...input, learning: { capturedAt: at(240), learners } }), /learner/i);
  assert.throws(() => validateDataset({ ...input, learning: { capturedAt: at(241), learners: [] } }), /learning/i);
  assert.equal(validateDataset(input), input);
});
