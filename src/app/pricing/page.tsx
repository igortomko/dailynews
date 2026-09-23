import type { Metadata } from "next";
import Link from "next/link";
import { legalLocale } from "@/components/legal-page";
import { Value, planRows } from "@/components/plan-table";
import { dictOf, LOCALES, LOCALE_LABELS } from "@/lib/i18n";
import { PLAN_IDS, PLANS } from "@/lib/plans";

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
  const t = dictOf(locale);
  const login = t.onboarding.login;
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

      <div className="grid gap-3 sm:grid-cols-3">
        {PLAN_IDS.map((id) => {
          const plan = PLANS[id];
          return (
            <section key={id} className="flex flex-col gap-3 rounded-lg border p-4">
              <h2 className="font-medium">{t.plans.label[id]}</h2>
              <p className="flex items-baseline gap-1">
                <span className="text-2xl font-medium tabular-nums">${plan.price}</span>
                <span className="text-xs text-muted-foreground">{t.plans.table.perMonth}</span>
              </p>
              <p className="font-medium">{t.plans.tagline[id]}</p>
              <dl className="flex flex-col gap-1.5">
                {planRows(t).map(({ feature, value }) => (
                  <div key={feature} className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">{t.plans.feature[feature].title}</dt>
                    <dd className="shrink-0 whitespace-nowrap tabular-nums">
                      <Value value={value(plan)} yes={t.plans.table.hasFeature} no={t.plans.table.noFeature} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {t.plans.table.techLimit(PLAN_IDS.map((id) => PLANS[id].maxItems).join(" / "))}
      </p>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href="/login" className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">
          {t.plans.pricing.start}
        </Link>
        <Link href={`/terms?lang=${locale}`} className="text-muted-foreground hover:text-foreground">{login.termsLink}</Link>
        <Link href={`/privacy?lang=${locale}`} className="text-muted-foreground hover:text-foreground">{login.privacyLink}</Link>
        <Link href={`/refund?lang=${locale}`} className="text-muted-foreground hover:text-foreground">{login.refundLink}</Link>
      </footer>
    </main>
  );
}
