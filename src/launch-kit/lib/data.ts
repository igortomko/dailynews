import {
  dimensions, eventNames, type AnalyticsDataset, type AnalyticsEvent, type AnalyticsFilters,
  type BreakdownRow, type DashboardData, type Dimension, type Overview, type ProductMeasurement,
  type CohortResult, type GrowthReport, type RetentionResult, type AnalyticsUserProfile, type LearnerSnapshot,
} from "./types";
import { validateModelCosts } from "./costs";
import { validatePlacements } from "./placements";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const UNKNOWN = "Unknown";
const activityNames = new Set(["page_viewed", "product_entered", "registered", "first_value", "value_repeated", "checkout_started", "goal_completed", "session_activity", "outbound_clicked"]);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value));
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f]/.test(value);
const rate = (count: number, total: number): number | null => total > 0 ? count / total * 100 : null;
const unique = (events: AnalyticsEvent[]): number => new Set(events.map((event) => event.subjectId)).size;
const sum = (values: number[]): number => values.reduce((total, value) => {
  const next = total + value;
  if (!Number.isFinite(next) || Math.abs(next) > Number.MAX_SAFE_INTEGER) throw new Error("Analytics total exceeds the safe numerical range.");
  return next;
}, 0);
const isPayment = (event: AnalyticsEvent): boolean => event.name === "payment_succeeded" || event.name === "payment_refunded";
const paymentKey = (event: AnalyticsEvent): string => `${event.provider ?? "local"}:${event.paymentId}`;
const eventTime = (event: AnalyticsEvent): number => Date.parse(event.occurredAt);
const dim = (event: AnalyticsEvent | undefined, key: Dimension): string => event?.[key] || UNKNOWN;
const learnerCounters = ["cards", "xp", "familiar", "mastered", "due", "reviews", "lapses"] as const;

function validatePrivateExtensions(input: { profiles?: unknown; learning?: unknown; generatedAt: string }): void {
  const shape = (value: Record<string, unknown>, required: string[], optional: string[] = []): boolean => required.every((key) => key in value) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
  const label = (value: unknown, limit = 160): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f]/.test(value);
  const subjectId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
  const nullableTime = (value: unknown): boolean => value === null || timestamp(value);
  const count = (value: unknown): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
  const namedCounts = (value: unknown, maxRows: number): boolean => {
    if (!Array.isArray(value) || value.length > maxRows) return false;
    const keys = new Set<string>();
    return value.every((row) => {
      if (!record(row) || !shape(row, ["key", "count"]) || typeof row.key !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(row.key) || keys.has(row.key) || !count(row.count)) return false;
      keys.add(row.key);
      return true;
    });
  };
  if (input.profiles !== undefined) {
    if (!Array.isArray(input.profiles) || input.profiles.length > 100_000) throw new Error("Invalid analytics profiles.");
    const ids = new Set<string>();
    for (const profile of input.profiles) {
      if (!record(profile) || !shape(profile, ["subjectId", "createdAt", "onboardingCompletedAt"], ["displayName", "username", "locale", "reminders"]) || !subjectId(profile.subjectId) || ids.has(profile.subjectId) || !timestamp(profile.createdAt) || !nullableTime(profile.onboardingCompletedAt)) throw new Error("Invalid analytics profile.");
      ids.add(profile.subjectId);
      if (profile.displayName !== undefined && !label(profile.displayName)) throw new Error("Invalid profile display name.");
      if (profile.username !== undefined && (typeof profile.username !== "string" || !/^[A-Za-z0-9_]{1,32}$/.test(profile.username))) throw new Error("Invalid profile username.");
      if (profile.locale !== undefined && (typeof profile.locale !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(profile.locale))) throw new Error("Invalid profile locale.");
      if (profile.reminders !== undefined) {
        const reminder = profile.reminders;
        if (!record(reminder) || !shape(reminder, ["enabled", "time", "timezone"]) || typeof reminder.enabled !== "boolean" || typeof reminder.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(reminder.time) || !label(reminder.timezone, 128)) throw new Error("Invalid profile reminder.");
        try { new Intl.DateTimeFormat("en", { timeZone: reminder.timezone }); } catch { throw new Error("Invalid profile reminder timezone."); }
      }
    }
  }
  if (input.learning !== undefined) {
    const learning = input.learning;
    if (!record(learning) || !shape(learning, ["capturedAt", "learners"]) || !timestamp(learning.capturedAt) || Date.parse(learning.capturedAt) > Date.parse(input.generatedAt) || !Array.isArray(learning.learners) || learning.learners.length > 100_000) throw new Error("Invalid learning snapshot.");
    const ids = new Set<string>();
    for (const learner of learning.learners) {
      if (!record(learner) || !shape(learner, ["subjectId", ...learnerCounters, "firstCardAt", "lastReviewedAt", "states", "ratings", "reviewDays", "packs"]) || !subjectId(learner.subjectId) || ids.has(learner.subjectId) || learnerCounters.some((key) => !count(learner[key])) || !nullableTime(learner.firstCardAt) || !nullableTime(learner.lastReviewedAt) || !namedCounts(learner.states, 32) || !namedCounts(learner.ratings, 16)) throw new Error("Invalid learner snapshot.");
      ids.add(learner.subjectId);
      if (!Array.isArray(learner.reviewDays) || learner.reviewDays.length > 3660 || !Array.isArray(learner.packs) || learner.packs.length > 1000) throw new Error("Invalid learner snapshot history.");
      const dates = new Set<string>();
      for (const day of learner.reviewDays) {
        if (!record(day) || !shape(day, ["date", "count"]) || typeof day.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !timestamp(`${day.date}T00:00:00.000Z`) || new Date(`${day.date}T00:00:00.000Z`).toISOString().slice(0, 10) !== day.date || dates.has(day.date) || !count(day.count)) throw new Error("Invalid learner review day.");
        dates.add(day.date);
      }
      for (const pack of learner.packs) {
        if (!record(pack) || !shape(pack, ["title", "cards", "addedAt"]) || !label(pack.title) || !count(pack.cards) || !timestamp(pack.addedAt)) throw new Error("Invalid learner pack.");
      }
    }
  }
}

function validateMeasurement(input: unknown): asserts input is ProductMeasurement {
  const fields = (value: Record<string, unknown>, allowed: string[]): boolean => Object.keys(value).every((key) => allowed.includes(key));
  const label = (value: unknown, maxLength = 160): boolean => typeof value === "string" && value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u001f]/.test(value);
  const goal = (value: unknown): boolean => typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);
  const hours = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 366 * 24;
  const knownEvent = (value: unknown): boolean => eventNames.includes(value as AnalyticsEvent["name"]);
  if (!record(input) || !fields(input, ["audienceLabel", "activationLabel", "description", "activationWindowHours", "funnel", "retention"]) || !label(input.audienceLabel) || !label(input.activationLabel) || !label(input.description, 500) || !hours(input.activationWindowHours) || input.activationWindowHours === 0) throw new Error("Invalid product measurement configuration.");
  const funnel = input.funnel;
  if (!record(funnel) || !fields(funnel, ["label", "mode", "steps"]) || !label(funnel.label) || funnel.mode !== "independent" || !Array.isArray(funnel.steps) || funnel.steps.length < 1 || funnel.steps.length > 12) throw new Error("Invalid measurement funnel.");
  const keys = new Set<string>();
  for (const step of funnel.steps) {
    if (!record(step) || !fields(step, ["key", "label", "event", "goal"]) || typeof step.key !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(step.key) || keys.has(step.key) || !label(step.label) || !knownEvent(step.event) || (step.goal !== undefined && !goal(step.goal))) throw new Error("Invalid measurement funnel step.");
    keys.add(step.key);
  }
  const retention = input.retention;
  if (!record(retention) || !fields(retention, ["label", "anchor", "event", "goal", "startHours", "endHours"]) || !label(retention.label) || retention.anchor !== "product_entered" || !knownEvent(retention.event) || (retention.goal !== undefined && !goal(retention.goal)) || !hours(retention.startHours) || !hours(retention.endHours) || retention.endHours <= retention.startHours) throw new Error("Invalid measurement retention window.");
}

export function currencyExponent(currency: string): number {
  if (currency === "XTR") return 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export function formatAmount(amountMinor: number | null, currency: string, exponent = currencyExponent(currency)): string {
  if (amountMinor === null) return "—";
  if (currency === "XTR") return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: exponent }).format(amountMinor / 10 ** exponent)} Stars`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(amountMinor / 10 ** exponent);
}

export function validateDataset(input: unknown): AnalyticsDataset {
  if (!record(input) || input.schemaVersion !== 1 || !["demo", "local"].includes(String(input.mode))) throw new Error("Invalid analytics dataset version or mode.");
  if (!timestamp(input.generatedAt)) throw new Error("generatedAt must be a UTC timestamp.");
  const product = input.product;
  if (!record(product) || !text(product.name) || !text(product.firstValueLabel) || !["saas", "mobile", "telegram", "desktop", "api"].includes(String(product.profile)) || !/^[A-Z]{3}$/.test(String(product.currency))) throw new Error("Invalid analytics product configuration.");
  const capabilities = input.capabilities;
  if (!record(capabilities) || ["sessions", "payments", "lifecycle", "crawlers", "geography", "identity"].some((key) => typeof capabilities[key] !== "boolean")) throw new Error("Analytics capabilities must be explicit booleans.");
  if (!record(input.health) || !(input.health.lastEventAt === null || timestamp(input.health.lastEventAt)) || !Number.isSafeInteger(input.health.errors) || Number(input.health.errors) < 0) throw new Error("Invalid analytics health status.");
  if (input.measurement !== undefined) validateMeasurement(input.measurement);
  validatePrivateExtensions({ profiles: input.profiles, learning: input.learning, generatedAt: input.generatedAt });
  if (input.modelCosts !== undefined) validateModelCosts(input.modelCosts, String(input.generatedAt));
  if (input.placements !== undefined) validatePlacements(input.placements);
  if (!Array.isArray(input.events) || input.events.length > 100_000) throw new Error("Expected at most 100,000 analytics events.");
  const allowed = new Set(["id", "subjectId", "occurredAt", "name", "surface", ...dimensions, "sessionId", "activeSeconds", "amountMinor", "currency", "provider", "currencyExponent", "paymentId", "refundId", "goal", "plan", "crawlerName", "crawlerCategory"]);
  for (const event of input.events) {
    if (!record(event) || !text(event.id) || !text(event.subjectId) || !timestamp(event.occurredAt) || !eventNames.includes(event.name as AnalyticsEvent["name"]) || !["landing", "web", "mobile", "telegram", "desktop", "api"].includes(String(event.surface))) throw new Error("Invalid analytics event envelope.");
    if (Object.keys(event).some((key) => !allowed.has(key))) throw new Error("Unknown analytics event property; use the typed allowlist.");
    for (const [key, value] of Object.entries(event)) {
      if (["activeSeconds", "amountMinor", "currencyExponent"].includes(key)) continue;
      if (!text(value)) throw new Error(`Invalid event field: ${key}.`);
    }
    if (typeof event.route === "string" && /[?#]/.test(event.route)) throw new Error("Routes must omit query strings and fragments.");
    if (event.activeSeconds !== undefined && (typeof event.activeSeconds !== "number" || !Number.isFinite(event.activeSeconds) || event.activeSeconds < 0 || event.activeSeconds > 86_400)) throw new Error("Invalid activeSeconds.");
    if (event.currencyExponent !== undefined && (!Number.isInteger(event.currencyExponent) || Number(event.currencyExponent) < 0 || Number(event.currencyExponent) > 6)) throw new Error("Invalid currencyExponent.");
    if (event.name === "payment_succeeded" || event.name === "payment_refunded") {
      if (!text(event.paymentId) || !text(event.provider) || !Number.isSafeInteger(event.amountMinor) || Number(event.amountMinor) <= 0 || !/^[A-Z]{3}$/.test(String(event.currency))) throw new Error("Payments require provider, paymentId, a positive integer amountMinor, and currency.");
      if (event.name === "payment_refunded" && !text(event.refundId)) throw new Error("Refunds require refundId.");
    }
    if (event.crawlerCategory !== undefined && !["answer", "indexing", "training"].includes(String(event.crawlerCategory))) throw new Error("Invalid crawler category.");
  }
  return input as unknown as AnalyticsDataset;
}

function normalizedEvents(dataset: AnalyticsDataset): { events: AnalyticsEvent[]; replayed: number; orphanRefunds: number; warnings: string[] } {
  const ids = new Map<string, AnalyticsEvent>();
  const payments = new Map<string, AnalyticsEvent>();
  const refunds = new Map<string, AnalyticsEvent>();
  const exponents = new Map<string, number>();
  const firstValues = new Set<string>();
  const events: AnalyticsEvent[] = [];
  let replayed = 0;
  for (const event of [...dataset.events].sort((a, b) => eventTime(a) - eventTime(b) || a.id.localeCompare(b.id))) {
    const previousId = ids.get(event.id);
    if (previousId) {
      const keys = new Set([...Object.keys(previousId), ...Object.keys(event)]) as Set<keyof AnalyticsEvent>;
      if ([...keys].some((key) => previousId[key] !== event[key])) throw new Error("Conflicting analytics event ID.");
      replayed++; continue;
    }
    ids.set(event.id, event);
    if (event.name === "first_value") {
      if (firstValues.has(event.subjectId)) { replayed++; continue; }
      firstValues.add(event.subjectId);
    }
    if (isPayment(event)) {
      const currency = event.currency ?? dataset.product.currency;
      const exponent = event.currencyExponent ?? currencyExponent(currency);
      if (exponents.has(currency) && exponents.get(currency) !== exponent) throw new Error(`Conflicting currency exponent for ${currency}.`);
      exponents.set(currency, exponent);
      const registry = event.name === "payment_succeeded" ? payments : refunds;
      const key = event.name === "payment_succeeded" ? paymentKey(event) : `${event.provider ?? "local"}:${event.refundId}`;
      const prior = registry.get(key);
      if (prior) {
        if (prior.amountMinor !== event.amountMinor || prior.currency !== event.currency || prior.subjectId !== event.subjectId || prior.paymentId !== event.paymentId) throw new Error("Conflicting replay in payment ledger.");
        replayed++; continue;
      }
      registry.set(key, event);
    }
    events.push(event);
  }
  let orphanRefunds = 0;
  const refunded = new Map<string, number>();
  const clean = events.filter((event) => {
    if (event.name !== "payment_refunded") return true;
    const key = paymentKey(event);
    const charge = payments.get(key);
    if (!charge) { orphanRefunds++; return false; }
    if (charge.currency !== event.currency || charge.subjectId !== event.subjectId || eventTime(event) < eventTime(charge)) throw new Error("Refund does not match its original charge.");
    const amount = (refunded.get(key) ?? 0) + (event.amountMinor ?? 0);
    if (amount > (charge.amountMinor ?? 0)) throw new Error("Refund total exceeds the original charge.");
    refunded.set(key, amount);
    return true;
  });
  return { events: clean, replayed, orphanRefunds, warnings: orphanRefunds ? ["Unmatched refunds were excluded. Import their original charges to reconcile revenue."] : [] };
}

function grouped<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const group = groups.get(name) ?? [];
    group.push(item);
    groups.set(name, group);
  }
  return groups;
}

function eventCountTrend(events: AnalyticsEvent[], keys: string[], dates: string[], key: (event: AnalyticsEvent) => string): { date: string; values: Record<string, number> }[] {
  if (!events.length) return [];
  const daily = grouped(events, (event) => event.occurredAt.slice(0, 10));
  return dates.map((date) => {
    const counts = grouped(daily.get(date) ?? [], key);
    return { date, values: Object.fromEntries(keys.map((name) => [name, counts.get(name)?.length ?? 0])) };
  });
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sessionMetrics(sessions: AnalyticsEvent[][]): { duration: number | null; bounceRate: number | null; eligible: number; unmeasured: number } {
  const measured = sessions.map((events) => ({
    events,
    samples: events.filter((event) => event.name === "session_activity" && event.activeSeconds !== undefined),
  }));
  const durations = measured.filter((row) => row.samples.length).map((row) => sum(row.samples.map((event) => event.activeSeconds ?? 0)));
  const web = measured.filter((row) => row.events.some((event) => event.name === "page_viewed"));
  const eligible = web.filter((row) => row.samples.length);
  const bounced = eligible.filter((row) => (
    row.events.filter((event) => event.name === "page_viewed").length === 1
    && !row.events.some((event) => ["first_value", "value_repeated", "goal_completed"].includes(event.name))
    && sum(row.samples.map((event) => event.activeSeconds ?? 0)) < 10
  )).length;
  return { duration: durations.length ? sum(durations) / durations.length : null, bounceRate: rate(bounced, eligible.length), eligible: eligible.length, unmeasured: web.length - eligible.length };
}

function visitorRevenue(events: AnalyticsEvent[], visitorIds: Set<string>): { amount: number; linkedPayments: number; coverage: number | null } {
  const linked = events.filter((event) => visitorIds.has(event.subjectId));
  const payments = events.filter((event) => event.name === "payment_succeeded");
  const linkedPayments = linked.filter((event) => event.name === "payment_succeeded").length;
  return { amount: sum(linked.map((event) => (event.name === "payment_refunded" ? -1 : 1) * (event.amountMinor ?? 0))), linkedPayments, coverage: rate(linkedPayments, payments.length) };
}

interface EntryCohortMember { id: string; events: AnalyticsEvent[]; entry: AnalyticsEvent }

function measuredCohort(measurement: ProductMeasurement, entries: EntryCohortMember[], to: number, identity: boolean): {
  activation: NonNullable<DashboardData["activationCohort"]>;
  funnel: DashboardData["funnel"];
  funnelCohort: DashboardData["funnelCohort"];
  retention: DashboardData["retention"];
} {
  const activationWindow = measurement.activationWindowHours * HOUR;
  const eligible = entries.filter(({ entry }) => eventTime(entry) + activationWindow <= to);
  const matches = (event: AnalyticsEvent, criterion: { event: AnalyticsEvent["name"]; goal?: string }): boolean => event.name === criterion.event && (criterion.goal === undefined || event.goal === criterion.goal);
  const activation = {
    eligible: eligible.length,
    activated: eligible.filter(({ entry, events }) => events.some((event) => event.name === "first_value" && eventTime(event) >= eventTime(entry) && eventTime(event) < eventTime(entry) + activationWindow)).length,
    immature: entries.length - eligible.length,
    windowHours: measurement.activationWindowHours,
  };
  const funnel = measurement.funnel.steps.map((step) => {
    const count = entries.filter(({ entry, events }) => events.some((event) => matches(event, step) && eventTime(event) >= eventTime(entry) && eventTime(event) < to && (step.event !== "first_value" || eventTime(event) < eventTime(entry) + activationWindow))).length;
    return { key: step.key, label: step.label, count: identity ? count : null, conversionRate: identity ? rate(count, entries.length) : null, dropoffRate: null };
  });
  const retained = entries.filter(({ entry }) => eventTime(entry) + measurement.retention.endHours * HOUR <= to);
  const returned = retained.filter(({ entry, events }) => events.some((event) => matches(event, measurement.retention) && eventTime(event) >= eventTime(entry) + measurement.retention.startHours * HOUR && eventTime(event) < eventTime(entry) + measurement.retention.endHours * HOUR)).length;
  return {
    activation,
    funnel,
    funnelCohort: { entered: entries.length, eligible: eligible.length, immature: activation.immature, windowDays: measurement.activationWindowHours / 24, mode: measurement.funnel.mode, label: measurement.funnel.label },
    retention: { eligible: identity ? retained.length : null, returned: identity ? returned : null, rate: identity ? rate(returned, retained.length) : null, windowDays: measurement.retention.endHours / 24 },
  };
}

function cohortResult(entries: EntryCohortMember[], to: number, identity: boolean, startHours: number, endHours: number, predicate: (event: AnalyticsEvent) => boolean, includeEnd = false): CohortResult {
  const eligible = entries.filter(({ entry }) => eventTime(entry) + endHours * HOUR <= to);
  const count = eligible.filter(({ entry, events }) => events.some((event) => predicate(event) && eventTime(event) >= eventTime(entry) + startHours * HOUR && (includeEnd ? eventTime(event) <= eventTime(entry) + endHours * HOUR : eventTime(event) < eventTime(entry) + endHours * HOUR))).length;
  return { eligible: identity ? eligible.length : null, count: identity ? count : null, immature: identity ? entries.length - eligible.length : null, rate: identity ? rate(count, eligible.length) : null };
}

function growthReport(dataset: AnalyticsDataset, entries: EntryCohortMember[], firstValues: EntryCohortMember[], selectedAll: AnalyticsEvent[], selected: AnalyticsEvent[], attribution: Map<string, AnalyticsEvent>, to: number, dates: string[]): GrowthReport {
  const identity = dataset.capabilities.identity;
  const usefulActivity = (event: AnalyticsEvent): boolean => activityNames.has(event.name);
  const activationHours = dataset.measurement?.activationWindowHours ?? 168;
  const retentionDefinition = dataset.measurement?.retention;
  const d7Anchor = retentionDefinition?.anchor ?? "first_value";
  const d7Start = retentionDefinition?.startHours ?? 24;
  const d7End = retentionDefinition?.endHours ?? 168;
  const d7Entries = retentionDefinition ? entries : firstValues;
  const d7Predicate = (event: AnalyticsEvent): boolean => retentionDefinition ? event.name === retentionDefinition.event && (retentionDefinition.goal === undefined || event.goal === retentionDefinition.goal) : event.name === "value_repeated";
  const activation = (cohort: EntryCohortMember[]): GrowthReport["activation"] => ({ ...cohortResult(cohort, to, identity, 0, activationHours, (event) => event.name === "first_value", !dataset.measurement), windowHours: activationHours });
  const retained = (cohort: EntryCohortMember[], startHours: number, endHours: number, label: string): RetentionResult => ({ ...cohortResult(cohort, to, identity, startHours, endHours, usefulActivity), label, anchor: "product_entered", startHours, endHours });
  const d7 = (cohort: EntryCohortMember[]): RetentionResult => ({ ...cohortResult(cohort, to, identity, d7Start, d7End, d7Predicate, !retentionDefinition), label: retentionDefinition?.label ?? "Repeat useful action", anchor: d7Anchor, startHours: d7Start, endHours: d7End });
  const dimensionsFor = (id: string): [string, string] => [dim(attribution.get(id), "medium"), dim(attribution.get(id), "source")];
  const sourceGroups = grouped(entries, ({ id }) => JSON.stringify(dimensionsFor(id)));
  const retainedGroups = grouped(d7Entries, ({ id }) => JSON.stringify(dimensionsFor(id)));
  const sourceKeys = new Set([...sourceGroups.keys(), ...retainedGroups.keys()]);
  const sourceQuality = identity ? [...sourceKeys].map((key) => {
    const cohort = sourceGroups.get(key) ?? [];
    const [channel, source] = JSON.parse(key) as [string, string];
    return { channel, source, starts: cohort.length, activation: activation(cohort), d1: retained(cohort, 24, 48, "D1"), d2: retained(cohort, 48, 72, "D2"), d7: d7(retainedGroups.get(key) ?? []) };
  }).sort((a, b) => b.starts - a.starts || a.channel.localeCompare(b.channel) || a.source.localeCompare(b.source)) : [];
  const dailyActivity = grouped(selected.filter(usefulActivity), (event) => event.occurredAt.slice(0, 10));
  const dailyEntries = grouped(entries, ({ entry }) => entry.occurredAt.slice(0, 10));
  const dailyReviews = grouped(selected.filter((event) => event.name === "goal_completed" && event.goal === "review_rated"), (event) => event.occurredAt.slice(0, 10));
  return {
    asOf: new Date(to).toISOString(),
    dau: identity ? unique(selectedAll.filter((event) => usefulActivity(event) && eventTime(event) >= to - 24 * HOUR)) : null,
    wau: identity ? unique(selectedAll.filter((event) => usefulActivity(event) && eventTime(event) >= to - 168 * HOUR)) : null,
    newUsers: identity ? entries.length : null,
    activation: activation(entries), d1: retained(entries, 24, 48, "D1"), d2: retained(entries, 48, 72, "D2"), d7: d7(d7Entries), sourceQuality,
    daily: dates.map((date) => ({ date, newUsers: identity ? (dailyEntries.get(date)?.length ?? 0) : null, active: unique(dailyActivity.get(date) ?? []), reviews: dailyReviews.get(date)?.length ?? 0 })),
  };
}

function learningReport(learners: LearnerSnapshot[], capturedAt: string): NonNullable<DashboardData["learning"]> {
  const namedCounts = (field: "states" | "ratings"): { key: string; count: number }[] => [...grouped(learners.flatMap((row) => row[field]), (row) => row.key)].map(([key, rows]) => ({ key, count: sum(rows.map((row) => row.count)) })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return {
    capturedAt, learners: learners.length,
    cards: sum(learners.map((row) => row.cards)), xp: sum(learners.map((row) => row.xp)), familiar: sum(learners.map((row) => row.familiar)), mastered: sum(learners.map((row) => row.mastered)), due: sum(learners.map((row) => row.due)), reviews: sum(learners.map((row) => row.reviews)), lapses: sum(learners.map((row) => row.lapses)),
    states: namedCounts("states"), ratings: namedCounts("ratings"),
    reviewDays: [...grouped(learners.flatMap((row) => row.reviewDays), (row) => row.date)].map(([date, rows]) => ({ date, count: sum(rows.map((row) => row.count)) })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function buildDashboard(dataset: AnalyticsDataset, filters: AnalyticsFilters = {}): DashboardData {
  if (dataset.measurement !== undefined) validateMeasurement(dataset.measurement);
  validatePrivateExtensions(dataset);
  const normalized = normalizedEvents(dataset);
  const all = normalized.events;
  const snapshotAt = Date.parse(dataset.generatedAt);
  const to = filters.to ? Math.min(Date.parse(filters.to), snapshotAt) : snapshotAt;
  const rangeDays = filters.rangeDays ?? 30;
  if (!Number.isInteger(rangeDays) || rangeDays < 1 || rangeDays > 366) throw new Error("rangeDays must be an integer from 1 to 366.");
  const from = filters.from ? Date.parse(filters.from) : Math.ceil(to / DAY) * DAY - rangeDays * DAY;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 366 * DAY) throw new Error("Choose a valid reporting range of at most 366 days.");
  const inRange = (event: AnalyticsEvent): boolean => eventTime(event) >= from && eventTime(event) < to;
  const currency = filters.currency ?? dataset.product.currency;
  const exponent = all.find((event) => event.currency === currency)?.currencyExponent ?? currencyExponent(currency);
  const people = grouped(all.filter((event) => event.name !== "crawler_requested" && eventTime(event) < to), (event) => event.subjectId);
  const attribution = new Map<string, AnalyticsEvent>();
  for (const [id, events] of people) {
    const entry = events.find((event) => event.name === "product_entered") ?? events.find((event) => event.name === "page_viewed") ?? events[0];
    const previousLanding = events.find((event) => event.name === "page_viewed" && eventTime(event) <= eventTime(entry));
    attribution.set(id, previousLanding ? { ...previousLanding, ...entry } : entry);
  }
  const matches = (id: string): boolean => (["source", "country", "device", "campaign"] as const).every((key) => !filters[key] || dim(attribution.get(id), key) === filters[key]);
  const selectedAll = all.filter((event) => event.name !== "crawler_requested" && eventTime(event) < to && matches(event.subjectId));
  const selected = selectedAll.filter(inRange);
  const activity = selected.filter((event) => activityNames.has(event.name));
  const visitorIds = new Set(activity.map((event) => event.subjectId));
  const activated = selected.filter((event) => event.name === "first_value");
  const financial = selected.filter((event) => isPayment(event) && event.currency === currency);
  const charges = financial.filter((event) => event.name === "payment_succeeded");
  const refunds = financial.filter((event) => event.name === "payment_refunded");
  const gross = sum(charges.map((event) => event.amountMinor ?? 0));
  const refundAmount = sum(refunds.map((event) => event.amountMinor ?? 0));
  const moneyAvailable = dataset.capabilities.payments;
  const visitorMoneyAvailable = moneyAvailable && dataset.capabilities.identity;
  const sessions = grouped(activity.filter((event) => event.sessionId), (event) => `${event.subjectId}:${event.sessionId}`);
  const session = sessionMetrics([...sessions.values()]);
  const linkedRevenue = visitorRevenue(financial, visitorIds);
  const returning = [...visitorIds].filter((id) => people.get(id)?.some((event) => activityNames.has(event.name) && eventTime(event) < from)).length;
  const overview: Overview = {
    visitors: visitorIds.size, pageviews: activity.filter((event) => event.name === "page_viewed").length,
    activated: unique(activated), activationRate: rate(unique(activated.filter((event) => visitorIds.has(event.subjectId))), visitorIds.size),
    payers: moneyAvailable ? unique(charges) : null, paymentCount: moneyAvailable ? charges.length : null,
    grossMinor: moneyAvailable ? gross : null, refundsMinor: moneyAvailable ? refundAmount : null, revenueMinor: moneyAvailable ? gross - refundAmount : null,
    conversionRate: moneyAvailable ? rate(unique(charges.filter((event) => visitorIds.has(event.subjectId))), visitorIds.size) : null,
    revenuePerVisitorMinor: visitorMoneyAvailable && visitorIds.size ? linkedRevenue.amount / visitorIds.size : null,
    visitorRevenueMinor: visitorMoneyAvailable ? linkedRevenue.amount : null,
    linkedPaymentCount: visitorMoneyAvailable ? linkedRevenue.linkedPayments : null,
    linkedPaymentCoverage: visitorMoneyAvailable ? linkedRevenue.coverage : null,
    bounceRate: dataset.capabilities.sessions ? session.bounceRate : null,
    bounceEligibleSessions: dataset.capabilities.sessions ? session.eligible : null,
    bounceUnmeasuredSessions: dataset.capabilities.sessions ? session.unmeasured : null,
    sessionSeconds: dataset.capabilities.sessions ? session.duration : null,
    returningVisitors: dataset.capabilities.identity ? returning : null,
    returningRate: dataset.capabilities.identity ? rate(returning, visitorIds.size) : null,
  };
  const trend: DashboardData["trend"] = [];
  for (let day = Math.floor(from / DAY) * DAY; day < to; day += DAY) {
    const events = selected.filter((event) => eventTime(event) >= Math.max(day, from) && eventTime(event) < Math.min(day + DAY, to));
    const dailyActivity = events.filter((event) => activityNames.has(event.name));
    const dailyIds = new Set(dailyActivity.map((event) => event.subjectId));
    const dailySessions = [...grouped(dailyActivity.filter((event) => event.sessionId), (event) => `${event.subjectId}:${event.sessionId}`).values()];
    const dailySession = sessionMetrics(dailySessions);
    const dailyMoney = events.filter((event) => isPayment(event) && event.currency === currency);
    const dailyLinkedRevenue = visitorRevenue(dailyMoney, dailyIds);
    const revenueMinor = moneyAvailable ? sum(dailyMoney.map((event) => (event.name === "payment_refunded" ? -1 : 1) * (event.amountMinor ?? 0))) : null;
    trend.push({
      date: new Date(day).toISOString().slice(0, 10), visitors: dailyIds.size,
      pageviews: dailyActivity.filter((event) => event.name === "page_viewed").length,
      activated: unique(events.filter((event) => event.name === "first_value")), revenueMinor,
      revenuePerVisitorMinor: visitorMoneyAvailable && dailyIds.size ? dailyLinkedRevenue.amount / dailyIds.size : null,
      visitorRevenueMinor: visitorMoneyAvailable ? dailyLinkedRevenue.amount : null,
      linkedPaymentCount: visitorMoneyAvailable ? dailyLinkedRevenue.linkedPayments : null,
      linkedPaymentCoverage: visitorMoneyAvailable ? dailyLinkedRevenue.coverage : null,
      conversionRate: null,
      bounceRate: dataset.capabilities.sessions ? dailySession.bounceRate : null,
      bounceEligibleSessions: dataset.capabilities.sessions ? dailySession.eligible : null,
      bounceUnmeasuredSessions: dataset.capabilities.sessions ? dailySession.unmeasured : null,
      sessionSeconds: dataset.capabilities.sessions ? dailySession.duration : null,
      returningVisitors: dataset.capabilities.identity ? [...dailyIds].filter((id) => people.get(id)?.some((event) => activityNames.has(event.name) && eventTime(event) < Math.max(day, from))).length : null,
    });
  }
  const breakdowns = Object.fromEntries(dimensions.map((dimension) => {
    if (["country", "region", "city"].includes(dimension) && !dataset.capabilities.geography) return [dimension, []];
    const rows: BreakdownRow[] = [...grouped(selected, (event) => dimension === "route" || dimension === "hostname" ? dim(event, dimension) : dim(attribution.get(event.subjectId), dimension))].map(([key, events]) => {
      const visitors = unique(events.filter((event) => activityNames.has(event.name)));
      const payments = events.filter((event) => event.name === "payment_succeeded" && event.currency === currency);
      const revenue = sum(events.filter((event) => isPayment(event) && event.currency === currency).map((event) => (event.name === "payment_refunded" ? -1 : 1) * (event.amountMinor ?? 0)));
      return { key, visitors, pageviews: events.filter((event) => event.name === "page_viewed").length, activated: unique(events.filter((event) => event.name === "first_value")), payers: moneyAvailable ? unique(payments) : null, revenueMinor: moneyAvailable ? revenue : null, conversionRate: null, cohortEligible: null };
    }).sort((a, b) => b.visitors - a.visitors || a.key.localeCompare(b.key));
    return [dimension, rows];
  })) as Record<Dimension, BreakdownRow[]>;
  const goalEvents = selected.filter((event) => ["goal_completed", "first_value", "checkout_started", "outbound_clicked"].includes(event.name));
  const goalKey = (event: AnalyticsEvent): string => event.goal ?? event.name;
  const goals = [...grouped(goalEvents, goalKey)].map(([key, events]) => ({ key, count: events.length, visitors: unique(events) })).sort((a, b) => b.count - a.count);
  const dates = trend.map((row) => row.date);
  const goalTrend = eventCountTrend(goalEvents, goals.map((goal) => goal.key), dates, goalKey);
  const firstEntries = [...people].flatMap(([id, events]): EntryCohortMember[] => {
    const entry = events.find((event) => event.name === "product_entered");
    return entry && inRange(entry) && matches(id) ? [{ id, events, entry }] : [];
  });
  const measured = dataset.measurement ? measuredCohort(dataset.measurement, firstEntries, to, dataset.capabilities.identity) : undefined;
  if (measured) overview.activationRate = dataset.capabilities.identity ? rate(measured.activation.activated, measured.activation.eligible) : null;
  const eligibleEntries = firstEntries.filter(({ entry }) => entry && eventTime(entry) + 7 * DAY <= to);
  const funnelCohort = measured?.funnelCohort ?? { entered: firstEntries.length, eligible: eligibleEntries.length, immature: firstEntries.length - eligibleEntries.length, windowDays: 7 as const };
  const counts = [eligibleEntries.length, 0, 0];
  const converted = new Set<string>();
  for (const { events, entry } of eligibleEntries) {
    if (!entry) continue;
    let cursor = eventTime(entry);
    for (const [index, name] of ["first_value", "payment_succeeded"].entries()) {
      const next = events.find((event) => event.name === name && eventTime(event) >= cursor && eventTime(event) <= eventTime(entry) + 7 * DAY && eventTime(event) < to && (name !== "payment_succeeded" || event.currency === currency));
      if (!next) break;
      counts[index + 1]++;
      if (name === "payment_succeeded") converted.add(next.subjectId);
      cursor = eventTime(next);
    }
  }
  const funnel = measured?.funnel ?? ["product_entered", "first_value", "payment_succeeded"].map((key, index) => {
    const unavailable = !dataset.capabilities.identity || (index > 1 && !moneyAvailable);
    return { key, label: ["Entered product", dataset.product.firstValueLabel, "Paid"][index], count: unavailable ? null : counts[index], conversionRate: unavailable ? null : rate(counts[index], counts[0]), dropoffRate: index === 0 || unavailable ? null : rate(counts[index - 1] - counts[index], counts[index - 1]) };
  });
  overview.conversionRate = moneyAvailable && !measured ? funnel[2].conversionRate : null;
  for (const day of trend) {
    const cohort = eligibleEntries.filter(({ entry }) => entry?.occurredAt.slice(0, 10) === day.date);
    day.conversionRate = moneyAvailable && dataset.capabilities.identity && !measured ? rate(cohort.filter(({ id }) => converted.has(id)).length, cohort.length) : null;
  }
  for (const dimension of dimensions) {
    for (const row of breakdowns[dimension]) {
      const cohort = eligibleEntries.filter(({ id }) => dim(attribution.get(id), dimension) === row.key);
      row.cohortEligible = dataset.capabilities.identity && !measured ? cohort.length : null;
      row.conversionRate = moneyAvailable && dataset.capabilities.identity && !measured ? rate(cohort.filter(({ id }) => converted.has(id)).length, cohort.length) : null;
    }
  }
  const periodUsers = grouped(selected.filter((event) => !event.name.startsWith("email_")), (event) => event.subjectId);
  const lifetimeUsers = grouped(selectedAll.filter((event) => !event.name.startsWith("email_")), (event) => event.subjectId);
  const profiles = new Map<string, AnalyticsUserProfile>((dataset.profiles ?? []).filter((profile) => Date.parse(profile.createdAt) < to && matches(profile.subjectId)).map((profile) => [profile.subjectId, profile]));
  const learningSnapshot = dataset.learning && Date.parse(dataset.learning.capturedAt) <= to && dataset.capabilities.identity ? dataset.learning : undefined;
  const learners = new Map<string, LearnerSnapshot>((learningSnapshot?.learners ?? []).filter((row) => matches(row.subjectId)).map((row) => [row.subjectId, row]));
  const userIds = new Set([...lifetimeUsers.keys(), ...profiles.keys(), ...learners.keys()]);
  const users: DashboardData["users"] = [...userIds].map((id) => {
    const events = periodUsers.get(id) ?? [];
    const lifetime = lifetimeUsers.get(id) ?? [];
    const profile = profiles.get(id);
    const learner = learners.get(id);
    const firstSeen = lifetime[0]?.occurredAt ?? profile?.createdAt ?? learner?.firstCardAt ?? learningSnapshot?.capturedAt ?? new Date(to).toISOString();
    return {
      id, source: dim(attribution.get(id), "source"), country: dataset.capabilities.geography ? dim(attribution.get(id), "country") : UNKNOWN, device: dim(attribution.get(id), "device"),
      firstSeen, firstEntryAt: lifetime.find((event) => event.name === "product_entered")?.occurredAt ?? null, lastSeen: lifetime.at(-1)?.occurredAt ?? learner?.lastReviewedAt ?? firstSeen,
      events: events.length, lifetimeEvents: lifetime.length,
      spentMinor: moneyAvailable ? sum(events.filter((event) => isPayment(event) && event.currency === currency).map((event) => (event.name === "payment_refunded" ? -1 : 1) * (event.amountMinor ?? 0))) : null,
      activated: lifetime.some((event) => event.name === "first_value" || event.name === "value_repeated"),
      ...(profile ? { profile, profileCapturedAt: dataset.generatedAt } : {}),
      ...(learner && learningSnapshot ? { learning: learner, learningCapturedAt: learningSnapshot.capturedAt } : {}),
    };
  }).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.id.localeCompare(b.id));
  const configuredMilestones = new Set((dataset.measurement?.funnel.steps ?? []).filter((step) => step.goal !== undefined).map((step) => JSON.stringify([step.event, step.goal])));
  const journeys = users.map((user) => {
    const steps = (lifetimeUsers.get(user.id) ?? []).filter((event) => event.name !== "session_activity");
    const milestones = new Map<string, DashboardData["journeys"][number]["milestones"][number]>();
    for (const event of steps) {
      if (!milestones.has(event.name)) milestones.set(event.name, { name: event.name, occurredAt: event.occurredAt });
      const goalKey = JSON.stringify([event.name, event.goal]);
      if (event.goal !== undefined && configuredMilestones.has(goalKey) && !milestones.has(goalKey)) milestones.set(goalKey, { name: event.name, goal: event.goal, occurredAt: event.occurredAt });
    }
    return { id: user.id, source: user.source, totalSteps: steps.length, truncated: steps.length > 60, milestones: [...milestones.values()], steps: steps.slice(-60).map((event) => ({ name: event.name, occurredAt: event.occurredAt, ...(event.route ? { route: event.route } : {}), ...(event.goal ? { goal: event.goal } : {}) })) };
  });
  const firstValueCohort = [...people].map(([id, events]) => ({ id, events, first: events.find((event) => event.name === "first_value") })).filter((row) => row.first && inRange(row.first) && eventTime(row.first) + 7 * DAY <= to && matches(row.id));
  const returned = firstValueCohort.filter(({ events, first }) => first && events.some((event) => event.name === "value_repeated" && eventTime(event) >= eventTime(first) + DAY && eventTime(event) <= eventTime(first) + 7 * DAY)).length;
  const retention = measured?.retention ?? { eligible: dataset.capabilities.identity ? firstValueCohort.length : null, returned: dataset.capabilities.identity ? returned : null, rate: dataset.capabilities.identity ? rate(returned, firstValueCohort.length) : null, windowDays: 7 as const };
  const firstValues = [...people].flatMap(([id, events]): EntryCohortMember[] => {
    const entry = events.find((event) => event.name === "first_value");
    return entry && inRange(entry) && matches(id) ? [{ id, events, entry }] : [];
  });
  const growth = growthReport(dataset, firstEntries, firstValues, selectedAll, selected, attribution, to, dates);
  const learning = learningSnapshot ? learningReport([...learners.values()], learningSnapshot.capturedAt) : undefined;
  const hasPeopleFilter = Boolean(filters.source || filters.country || filters.device || filters.campaign);
  const crawlerEvents = dataset.capabilities.crawlers && !hasPeopleFilter ? all.filter((event) => event.name === "crawler_requested" && inRange(event)) : [];
  const crawlers = [...grouped(crawlerEvents, (event) => `${event.crawlerName ?? UNKNOWN}:${event.crawlerCategory ?? UNKNOWN}`)].map(([, events]) => ({ name: events[0].crawlerName ?? UNKNOWN, category: events[0].crawlerCategory ?? UNKNOWN, count: events.length, routes: [...grouped(events, (event) => event.route ?? UNKNOWN)].map(([key, rows]) => ({ key, count: rows.length })).sort((a, b) => b.count - a.count) })).sort((a, b) => b.count - a.count);
  const crawlerSeries = crawlers.map(({ name, category }) => ({ key: `${category}:${name}`, name, category }));
  const crawlerTrend = eventCountTrend(crawlerEvents, crawlerSeries.map((series) => series.key), dates, (event) => `${event.crawlerCategory ?? UNKNOWN}:${event.crawlerName ?? UNKNOWN}`);
  const lifecycle = dataset.capabilities.lifecycle ? [...grouped(selected.filter((event) => event.name.startsWith("email_")), (event) => event.campaign ?? UNKNOWN)].map(([campaign, events]) => {
    const clicks = events.filter((event) => event.name === "email_clicked");
    const afterClick = (name: AnalyticsEvent["name"]): number => unique(selected.filter((event) => event.name === name && clicks.some((click) => click.subjectId === event.subjectId && eventTime(event) >= eventTime(click) && eventTime(event) <= eventTime(click) + 7 * DAY)));
    const count = (name: AnalyticsEvent["name"]): number => events.filter((event) => event.name === name).length;
    return { campaign, sent: count("email_sent"), delivered: count("email_delivered"), clicked: unique(clicks), bounced: count("email_bounced"), unsubscribed: unique(events.filter((event) => event.name === "email_unsubscribed")), activated: afterClick("first_value"), paid: moneyAvailable ? afterClick("payment_succeeded") : null };
  }) : [];
  const firstCharges = [...people.values()].map((events) => ({ events, charge: events.find((event) => event.name === "payment_succeeded" && event.currency === currency), entry: events.find((event) => event.name === "product_entered" || event.name === "page_viewed") })).filter((row) => row.charge && row.entry && inRange(row.charge) && matches(row.charge.subjectId) && eventTime(row.charge) >= eventTime(row.entry));
  const purchaseHours = firstCharges.map(({ charge, entry }) => (eventTime(charge!) - eventTime(entry!)) / 3_600_000);
  const observedSessionPurchases = firstCharges.filter(({ charge, entry }) => charge?.sessionId && entry?.sessionId);
  const days = trend.length;
  const money = moneyAvailable ? [...grouped(selected.filter(isPayment), (event) => event.currency ?? UNKNOWN)].map(([code, events]) => {
    const grossMinor = sum(events.filter((event) => event.name === "payment_succeeded").map((event) => event.amountMinor ?? 0));
    const refundsMinor = sum(events.filter((event) => event.name === "payment_refunded").map((event) => event.amountMinor ?? 0));
    return { currency: code, currencyExponent: events[0].currencyExponent ?? currencyExponent(code), grossMinor, refundsMinor, netMinor: grossMinor - refundsMinor };
  }).sort((a, b) => a.currency.localeCompare(b.currency)) : [];
  return {
    ...(dataset.measurement && measured ? { measurement: dataset.measurement, activationCohort: measured.activation } : {}),
    growth, ...(learning ? { learning } : {}),
    range: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), days }, currency, currencyExponent: exponent, overview, trend, breakdowns, goals, goalTrend, funnel, funnelCohort,
    users: dataset.capabilities.identity ? users : [], journeys: dataset.capabilities.identity ? journeys : [], retention, crawlers, crawlerTrend, crawlerSeries, lifecycle, money,
    summary: { medianHoursToPurchase: moneyAvailable && dataset.capabilities.identity ? median(purchaseHours) : null, firstVisitPurchaseRate: moneyAvailable && dataset.capabilities.sessions && dataset.capabilities.identity ? rate(observedSessionPurchases.filter(({ charge, entry }) => charge?.sessionId === entry?.sessionId).length, observedSessionPurchases.length) : null, firstPurchaseCount: firstCharges.length, sessionLinkedPurchaseCount: observedSessionPurchases.length, averageDailyVisitors: sum(trend.map((day) => day.visitors)) / days, averageDailyRevenueMinor: moneyAvailable ? (gross - refundAmount) / days : null },
    health: { ...dataset.health, replayedEvents: normalized.replayed, orphanRefunds: normalized.orphanRefunds, warnings: [...normalized.warnings, ...(hasPeopleFilter && dataset.capabilities.crawlers ? ["Crawler requests have no human acquisition identity; clear audience filters to view them."] : []), ...(!dataset.capabilities.identity ? ["Visitors count observed subject IDs. Stable identity is unavailable; returning-user, attributed revenue/visitor and cohort metrics cannot be calculated."] : []), ...(dataset.capabilities.sessions && session.unmeasured ? [`Bounce excludes ${session.unmeasured} web sessions without foreground-time measurements; denominator: ${session.eligible} measured web sessions.`] : []), "Attribution uses the first observed product entry, retaining a linked earlier landing campaign. Unlinked or blocked visits remain Unknown.", ...(dataset.measurement ? [
      `Activation rate uses first-entry cohorts observed for ${dataset.measurement.activationWindowHours} hours. Activation counts and trend show milestones occurring in the selected period.`,
      "Funnel stages are independent predicates on the same entry cohort; they do not imply sequential drop-offs.",
      `${dataset.measurement.retention.label}: the configured useful action in [${dataset.measurement.retention.startHours}, ${dataset.measurement.retention.endHours}) hours after entry, for fully observed cohorts.`,
      ...(moneyAvailable ? ["Payment conversion is unavailable for this product measurement definition; payment amounts remain recorded ledger totals."] : []),
    ] : ["Retention is a repeat useful action 24 hours–7 days after first value, for fully observed cohorts."]), "Revenue is recorded charges minus refunds, not profit. No fee/tax reconciliation or currency conversion is performed.", "Revenue/visitor only includes ledger amounts linked to active visitors in that same window and currency. Linked-payment coverage is the share of charges with that visitor link."] },
  };
}
