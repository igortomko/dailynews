import type { Metadata } from "next";
import Link from "next/link";
import { legalLocale } from "@/components/legal-page";
import { planRows } from "@/components/plan-table";
import { checkoutUrl, trialDaysFor, yearlyReady } from "@/lib/billing";
import { dictOf, featureWhat, LOCALES, LOCALE_LABELS } from "@/lib/i18n";
import { PLAN_IDS, PLANS } from "@/lib/plans";
import { PricingCards, type PricingCard, type PricingText } from "./cards";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { dailyId, recordBillingEvent } from "@/lib/analytics/billing-events";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pricing · Reporta" };

/**
 * Цены без входа.
 *
 * Paddle одобряет домен, только если без входа видно, что продаётся и почём,
 * и где условия и возврат. «Подписка» внутри за входом и, пока оплата
 * не включена, скрыта вовсе, — поэтому здесь отдельная страница. Строки
 * те же, что в «Подписке» (`planRows`): две таблицы, собранные порознь,
 * разошлись бы на первой правке тарифа.
 */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const locale = await legalLocale((await searchParams).lang);
  // Просмотр цен пишется только у вошедшего: у гостя нет номера, а воронка
  // считает людей. Гость посчитается потом — входом по кнопке на этой же странице.
  const viewer = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (viewer) {
    await recordBillingEvent({
      id: dailyId("plans", viewer), readerId: viewer, name: "plans_viewed", occurredAt: new Date().toISOString(),
    });
  }
  const t = dictOf(locale);
  const login = t.onboarding.login;
  const rows = planRows(t);
  const paid = PLAN_IDS.filter((id) => PLANS[id].price > 0);
  // Кнопка ведёт в оплату, а без входа proxy сам уведёт на вход: оплатить
  // тариф можно только своему профилю. Оплата не настроена — на вход.
  const cards: PricingCard[] = PLAN_IDS.map((id) => {
    const plan = PLANS[id];
    return {
      id,
      label: t.plans.label[id],
      tagline: t.plans.tagline[id],
      price: plan.price,
      yearPrice: plan.yearPrice,
      trialDays: plan.price > 0 ? trialDaysFor(id) : 0,
      href: {
        month: (plan.price > 0 && checkoutUrl(id, "month")) || "/login",
        year: (plan.price > 0 && checkoutUrl(id, "year")) || "/login",
      },
      rows: rows.map(({ feature, value }) => ({
        feature,
        title: t.plans.feature[feature].title,
        what: featureWhat(t, feature),
        value: value(plan),
      })),
    };
  });
  // Скидка за год считается из цен, а не пишется числом: поменяй цену —
  // надпись на переключателе поменяется с ней. Берётся наименьшая, чтобы
  // «до −17%» не обещать там, где выходит меньше.
  const save = Math.min(...paid.map((id) => Math.round((1 - PLANS[id].yearPrice / (PLANS[id].price * 12)) * 100)));
  const maxTrial = Math.max(0, ...paid.map(trialDaysFor));
  const text: PricingText = {
    monthly: t.plans.pricing.monthly,
    yearly: t.plans.pricing.yearly,
    save: t.plans.pricing.save(save),
    perMonth: t.plans.table.perMonth,
    perYear: t.plans.pricing.perYear,
    perMonthApprox: Object.fromEntries(
      paid.map((id) => [id, t.plans.pricing.perMonthApprox((PLANS[id].yearPrice / 12).toFixed(2))]),
    ),
    start: t.plans.pricing.start,
    tryFree: Object.fromEntries(paid.map((id) => [id, t.plans.table.tryFree(trialDaysFor(id))])),
    then: Object.fromEntries(
      paid.map((id) => [id, {
        month: t.plans.table.thenPerMonth(PLANS[id].price),
        year: t.plans.pricing.thenPerYear(PLANS[id].yearPrice),
      }]),
    ),
    move: Object.fromEntries(paid.map((id) => [id, t.plans.moveTo(t.plans.label[id])])),
    yes: t.plans.table.hasFeature,
    no: t.plans.table.noFeature,
  };
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12 text-sm">
      <nav className="flex gap-3 text-muted-foreground">
        {LOCALES.map((code) => (
          <Link
            key={code}
            href={`/pricing?lang=${code}`}
            aria-current={code === locale ? "page" : undefined}
            className={code === locale ? "font-medium text-foreground" : "hover:text-foreground"}
          >
            {LOCALE_LABELS[code]}
          </Link>
        ))}
      </nav>

      <header className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-2xl font-medium">{t.plans.pricing.title}</h1>
        <p className="leading-relaxed text-muted-foreground">{t.plans.pricing.intro}</p>
      </header>

      <PricingCards cards={cards} text={text} yearly={yearlyReady()} />

      {maxTrial > 0 ? <p className="text-muted-foreground">{t.plans.pricing.trialNote(maxTrial)}</p> : null}

      <p className="text-xs text-muted-foreground">
        {t.plans.table.techLimit(PLAN_IDS.map((id) => PLANS[id].maxItems).join(" / "))}
      </p>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={`/terms?lang=${locale}`} className="text-muted-foreground hover:text-foreground">{login.termsLink}</Link>
        <Link href={`/privacy?lang=${locale}`} className="text-muted-foreground hover:text-foreground">{login.privacyLink}</Link>
        <Link href={`/refund?lang=${locale}`} className="text-muted-foreground hover:text-foreground">{login.refundLink}</Link>
      </footer>
    </main>
  );
}
