export type ProductProfile = "saas" | "mobile" | "telegram" | "desktop" | "api";

export const eventNames = [
  "page_viewed", "product_entered", "registered", "first_value", "value_repeated",
  "checkout_started", "payment_succeeded", "payment_refunded", "goal_completed",
  "session_activity", "outbound_clicked", "crawler_requested", "email_sent",
  "email_delivered", "email_clicked", "email_bounced", "email_unsubscribed",
] as const;
export type EventName = (typeof eventNames)[number];
export type Surface = "landing" | "web" | "mobile" | "telegram" | "desktop" | "api";
export type CrawlerCategory = "answer" | "indexing" | "training";

export interface AnalyticsEvent {
  id: string;
  subjectId: string;
  occurredAt: string;
  name: EventName;
  surface: Surface;
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  route?: string;
  hostname?: string;
  country?: string;
  region?: string;
  city?: string;
  browser?: string;
  os?: string;
  device?: string;
  sessionId?: string;
  activeSeconds?: number;
  amountMinor?: number;
  currency?: string;
  provider?: string;
  currencyExponent?: number;
  paymentId?: string;
  refundId?: string;
  goal?: string;
  plan?: string;
  crawlerName?: string;
  crawlerCategory?: CrawlerCategory;
}

export interface ProductMeasurement {
  audienceLabel: string;
  activationLabel: string;
  description: string;
  activationWindowHours: number;
  funnel: {
    label: string;
    mode: "independent";
    steps: { key: string; label: string; event: EventName; goal?: string }[];
  };
  retention: {
    label: string;
    anchor: "product_entered";
    event: EventName;
    goal?: string;
    startHours: number;
    endHours: number;
  };
}

export interface AnalyticsUserProfile {
  subjectId: string;
  displayName?: string;
  username?: string;
  createdAt: string;
  onboardingCompletedAt: string | null;
  locale?: string;
  reminders?: { enabled: boolean; time: string; timezone: string };
}

export interface LearnerSnapshot {
  subjectId: string;
  cards: number;
  xp: number;
  familiar: number;
  mastered: number;
  due: number;
  reviews: number;
  lapses: number;
  firstCardAt: string | null;
  lastReviewedAt: string | null;
  states: { key: string; count: number }[];
  ratings: { key: string; count: number }[];
  reviewDays: { date: string; count: number }[];
  packs: { title: string; cards: number; addedAt: string }[];
}

export interface CohortResult {
  eligible: number | null;
  count: number | null;
  immature: number | null;
  rate: number | null;
}

export interface RetentionResult extends CohortResult {
  label: string;
  anchor: "product_entered" | "first_value";
  startHours: number;
  endHours: number;
}

export interface GrowthReport {
  asOf: string;
  dau: number | null;
  wau: number | null;
  newUsers: number | null;
  activation: CohortResult & { windowHours: number };
  d1: RetentionResult;
  d2: RetentionResult;
  d7: RetentionResult;
  sourceQuality: { channel: string; source: string; starts: number | null; activation: CohortResult & { windowHours: number }; d1: RetentionResult; d2: RetentionResult; d7: RetentionResult }[];
  daily: { date: string; newUsers: number | null; active: number; reviews: number }[];
}

export interface AnalyticsDataset {
  schemaVersion: 1;
  mode: "demo" | "local";
  product: { name: string; profile: ProductProfile; firstValueLabel: string; currency: string };
  generatedAt: string;
  capabilities: {
    sessions: boolean;
    payments: boolean;
    lifecycle: boolean;
    crawlers: boolean;
    geography: boolean;
    identity: boolean;
  };
  events: AnalyticsEvent[];
  health: { lastEventAt: string | null; errors: number };
  measurement?: ProductMeasurement;
  profiles?: AnalyticsUserProfile[];
  learning?: { capturedAt: string; learners: LearnerSnapshot[] };
}

export interface AnalyticsFilters {
  rangeDays?: number;
  from?: string;
  to?: string;
  source?: string;
  country?: string;
  device?: string;
  campaign?: string;
  currency?: string;
}

export const dimensions = [
  "source", "medium", "campaign", "content", "term", "route", "hostname",
  "country", "region", "city", "browser", "os", "device",
] as const;
export type Dimension = (typeof dimensions)[number];

export interface BreakdownRow {
  key: string;
  visitors: number;
  pageviews: number;
  activated: number;
  payers: number | null;
  revenueMinor: number | null;
  conversionRate: number | null;
  cohortEligible: number | null;
}

export interface Overview {
  visitors: number;
  pageviews: number;
  activated: number;
  activationRate: number | null;
  payers: number | null;
  paymentCount: number | null;
  grossMinor: number | null;
  refundsMinor: number | null;
  revenueMinor: number | null;
  conversionRate: number | null;
  revenuePerVisitorMinor: number | null;
  visitorRevenueMinor: number | null;
  linkedPaymentCount: number | null;
  linkedPaymentCoverage: number | null;
  bounceRate: number | null;
  bounceEligibleSessions: number | null;
  bounceUnmeasuredSessions: number | null;
  sessionSeconds: number | null;
  returningVisitors: number | null;
  returningRate: number | null;
}

export interface DashboardData {
  measurement?: ProductMeasurement;
  activationCohort?: { eligible: number; activated: number; immature: number; windowHours: number };
  growth: GrowthReport;
  learning?: { capturedAt: string; learners: number; cards: number; xp: number; familiar: number; mastered: number; due: number; reviews: number; lapses: number; states: { key: string; count: number }[]; ratings: { key: string; count: number }[]; reviewDays: { date: string; count: number }[] };
  range: { from: string; to: string; days: number };
  currency: string;
  currencyExponent: number;
  overview: Overview;
  trend: {
    date: string; visitors: number; pageviews: number; activated: number;
    revenueMinor: number | null; revenuePerVisitorMinor: number | null; visitorRevenueMinor: number | null;
    linkedPaymentCount: number | null; linkedPaymentCoverage: number | null; conversionRate: number | null;
    bounceRate: number | null; bounceEligibleSessions: number | null; bounceUnmeasuredSessions: number | null;
    sessionSeconds: number | null; returningVisitors: number | null;
  }[];
  breakdowns: Record<Dimension, BreakdownRow[]>;
  goals: { key: string; count: number; visitors: number }[];
  goalTrend: { date: string; values: Record<string, number> }[];
  funnel: { key: string; label: string; count: number | null; conversionRate: number | null; dropoffRate: number | null }[];
  funnelCohort: { entered: number; eligible: number; immature: number; windowDays: number; mode?: "independent"; label?: string };
  users: { id: string; source: string; country: string; device: string; firstSeen: string; firstEntryAt: string | null; lastSeen: string; events: number; lifetimeEvents: number; spentMinor: number | null; activated: boolean; profile?: AnalyticsUserProfile; profileCapturedAt?: string; learning?: LearnerSnapshot; learningCapturedAt?: string }[];
  journeys: { id: string; source: string; totalSteps: number; truncated: boolean; milestones: { name: EventName; occurredAt: string; goal?: string }[]; steps: { name: string; occurredAt: string; route?: string; goal?: string }[] }[];
  retention: { eligible: number | null; returned: number | null; rate: number | null; windowDays: number };
  crawlers: { name: string; category: string; count: number; routes: { key: string; count: number }[] }[];
  crawlerTrend: { date: string; values: Record<string, number> }[];
  crawlerSeries: { key: string; name: string; category: string }[];
  lifecycle: { campaign: string; sent: number; delivered: number; clicked: number; bounced: number; unsubscribed: number; activated: number; paid: number | null }[];
  summary: { medianHoursToPurchase: number | null; firstVisitPurchaseRate: number | null; firstPurchaseCount: number; sessionLinkedPurchaseCount: number; averageDailyVisitors: number; averageDailyRevenueMinor: number | null };
  money: { currency: string; currencyExponent: number; grossMinor: number; refundsMinor: number; netMinor: number }[];
  health: { lastEventAt: string | null; errors: number; replayedEvents: number; orphanRefunds: number; warnings: string[] };
}
