import type { AnalyticsDataset, AnalyticsEvent, ProductProfile, Surface } from "./types";

const DAY = 86_400_000;
const labels: Record<ProductProfile, string> = {
  saas: "First project published", mobile: "First activity completed", telegram: "First useful answer",
  desktop: "First file processed", api: "First successful API response",
};

export function makeDemoDataset(profile: ProductProfile = "saas", now: Date | string = new Date()): AnalyticsDataset {
  const reference = new Date(now);
  if (!Number.isFinite(reference.getTime())) throw new Error("Invalid demo reference date.");
  const end = reference.getTime();
  const midnight = Math.floor(end / DAY) * DAY;
  const currency = profile === "telegram" ? "XTR" : "USD";
  const provider = profile === "telegram" ? "telegram-stars" : profile === "mobile" ? "app-store" : "lemonsqueezy";
  const surface: Surface = profile === "saas" ? "web" : profile;
  const events: AnalyticsEvent[] = [];
  let counter = 0;
  const sources = ["Google", "X", "Newsletter", "Direct", "YouTube", "Partner", "ChatGPT"];
  const countries = ["United States", "United Kingdom", "Germany", "Brazil", "France", "Canada", "Portugal"];
  const cities = ["New York", "London", "Berlin", "São Paulo", "Paris", "Toronto", "Lisbon"];
  const add = (base: Omit<AnalyticsEvent, "id" | "name" | "occurredAt">, name: AnalyticsEvent["name"], time: number, extra: Partial<AnalyticsEvent> = {}): void => {
    if (time >= end) return;
    events.push({ ...base, id: `demo-event-${counter++}`, name, occurredAt: new Date(time).toISOString(), ...extra });
  };
  for (let index = 0; index < 1_200; index++) {
    const age = index % 74;
    const started = midnight - age * DAY + ((index * 37) % 1_300) * 60_000;
    if (started >= end) continue;
    const sourceIndex = (index * 13 + Math.floor(index / 19)) % sources.length;
    const countryIndex = index % countries.length;
    const device = index % 4 === 0 ? "Mobile" : "Desktop";
    const base: Omit<AnalyticsEvent, "id" | "name" | "occurredAt"> = {
      subjectId: `visitor-${String(index + 1).padStart(4, "0")}`, surface,
      source: sources[sourceIndex], medium: ["organic", "social", "email", "direct", "video", "referral", "ai-referral"][sourceIndex],
      campaign: ["evergreen", "launch-week", "welcome", "none", "tutorial", "partner-launch", "none"][sourceIndex],
      content: index % 3 === 0 ? "headline-a" : "headline-b",
      ...(sourceIndex === 0 && index % 3 === 0 ? { term: "launch software" } : {}),
      country: countries[countryIndex], region: `Region ${countryIndex + 1}`, city: cities[countryIndex],
      browser: device === "Mobile" ? "Safari" : index % 7 === 0 ? "Firefox" : "Chrome",
      os: device === "Mobile" ? "iOS" : index % 3 === 0 ? "Windows" : "macOS",
      device, hostname: "demo-product.example", sessionId: `session-${index}-1`, route: "/",
    };
    add(base, "page_viewed", started, { surface: "landing" });
    add(base, "product_entered", started + 60_000);
    add(base, "session_activity", started + 150_000, { activeSeconds: 30 + index % 260 });
    if (index % 3 !== 0) {
      add(base, "goal_completed", started + 120_000, { surface: "landing", goal: "Viewed pricing" });
      add(base, "page_viewed", started + 180_000, { surface: "landing", route: "/pricing" });
    }
    if (index % 4 !== 0) add(base, "registered", started + 240_000, { route: "/app" });
    if (index % 5 === 0) add(base, "outbound_clicked", started + 180_000, { route: "/docs", goal: "Opened documentation" });
    const firstValueTime = started + (index % 7 === 0 ? 2 * DAY : 10 * 60_000);
    if (index % 3 !== 0) {
      add(base, "first_value", firstValueTime, { route: "/app" });
      if (index % 4 === 0) add(base, "value_repeated", firstValueTime + 2 * DAY, { route: "/app", sessionId: `session-${index}-2` });
      if (index % 5 === 0) add(base, "value_repeated", firstValueTime + 9 * DAY, { route: "/app", sessionId: `session-${index}-3` });
      if (index % 2 === 0) add(base, "checkout_started", firstValueTime + 20 * 60_000, { route: "/checkout", plan: index % 4 ? "starter" : "pro" });
      if (index % 4 === 0) {
        const paymentCurrency = currency !== "XTR" && index % 28 === 0 ? "EUR" : currency;
        const payment = { provider, currency: paymentCurrency, currencyExponent: currency === "XTR" ? 0 : 2, paymentId: `payment-${index}`, amountMinor: currency === "XTR" ? 300 : index % 8 === 0 ? 4_900 : 1_900, plan: index % 8 === 0 ? "pro" : "starter", route: "/checkout" };
        add(base, "payment_succeeded", firstValueTime + 25 * 60_000, payment);
        if (index % 44 === 0) add(base, "payment_refunded", firstValueTime + 4 * DAY, { ...payment, refundId: `refund-${index}`, amountMinor: currency === "XTR" ? 100 : 500 });
      }
    }
    if (index % 4 !== 0) {
      const email = { campaign: index % 2 ? "welcome" : "return-to-value", route: "/app" };
      add(base, "email_sent", started + DAY, email);
      add(base, index % 19 === 0 ? "email_bounced" : "email_delivered", started + DAY + 60_000, email);
      if (index % 5 === 0) add(base, "email_clicked", started + DAY + 3_600_000, email);
      if (index % 67 === 0) add(base, "email_unsubscribed", started + DAY + 7_200_000, email);
    }
  }
  for (let index = 0; index < 620; index++) {
    const started = midnight - (index % 65) * DAY + ((index * 47) % 1_300) * 60_000;
    const category = (["answer", "indexing", "training"] as const)[index % 3];
    add({ subjectId: `crawler-${index}`, surface: "landing", hostname: "demo-product.example", route: ["/", "/pricing", "/docs"][index % 3], crawlerName: ["ChatGPT", "Googlebot", "ClaudeBot"][index % 3], crawlerCategory: category }, "crawler_requested", started);
  }
  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  return {
    schemaVersion: 1, mode: "demo", product: { name: "Demo product", profile, firstValueLabel: labels[profile], currency },
    generatedAt: reference.toISOString(), capabilities: { sessions: true, payments: true, lifecycle: true, crawlers: true, geography: true, identity: true }, events,
    health: { lastEventAt: events.at(-1)?.occurredAt ?? null, errors: 0 },
  };
}
