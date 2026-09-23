import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { legalLocale } from "@/components/legal-page";
import { PlanCards } from "@/components/plan-table";
import { cycleOf, paddleEnv, trialDaysFor } from "@/lib/billing";
import { dictOf, LOCALES, LOCALE_LABELS } from "@/lib/i18n";
import { PLAN_IDS } from "@/lib/plans";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { dailyId, recordBillingEvent } from "@/lib/analytics/billing-events";
import { PaddleLink } from "./paddle-link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pricing · Reporta" };

/**
 * Цены без входа.
 *
 * Paddle одобряет домен, только если без входа видно, что продаётся и почём,
 * и где условия и возврат. Карточки те же, что в «Подписке» (`PlanCards`):
 * две разметки одних тарифов разошлись бы на первой правке.
 */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[]; cycle?: string | string[]; _ptxn?: string | string[] }>;
}) {
  const params = await searchParams;
  const locale = await legalLocale(params.lang);
  const cycle = cycleOf(params.cycle);
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
  const maxTrial = Math.max(0, ...PLAN_IDS.map(trialDaysFor));
  const lang = typeof params.lang === "string" ? `lang=${params.lang}` : "";
  const cycleHref = {
    month: `/pricing${lang ? `?${lang}` : ""}`,
    year: `/pricing?${lang ? `${lang}&` : ""}cycle=year`,
  };
  const token = process.env.PADDLE_CLIENT_TOKEN;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12 text-sm">
      {params._ptxn && token ? <PaddleLink token={token} environment={paddleEnv()} /> : null}
      <nav className="flex gap-3 text-muted-foreground">
        {LOCALES.map((code) => (
          <Link
            key={code}
            href={`/pricing?lang=${code}${cycle === "year" ? "&cycle=year" : ""}`}
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

      <PlanCards t={t} reader={null} current={null} cycle={cycle} cycleHref={cycleHref} />

      {maxTrial > 0 ? <p className="text-muted-foreground">{t.plans.pricing.trialNote(maxTrial)}</p> : null}

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={`/terms?lang=${locale}`} className="text-muted-foreground hover:text-foreground">{login.termsLink}</Link>
        <Link href={`/privacy?lang=${locale}`} className="text-muted-foreground hover:text-foreground">{login.privacyLink}</Link>
        <Link href={`/refund?lang=${locale}`} className="text-muted-foreground hover:text-foreground">{login.refundLink}</Link>
      </footer>
    </main>
  );
}
