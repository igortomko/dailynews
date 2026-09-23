import { currentReader } from "@/lib/session";
import { effectivePlan, hasFounderDiscount } from "@/lib/billing";
import { FOUNDER_DISCOUNT, founderGraceEnds, isFounder } from "@/lib/plans";
import { currentLocale, getDict } from "@/lib/i18n/server";
import { PlanTable } from "@/components/plan-table";
import { dailyId, recordBillingEvent } from "@/lib/analytics/billing-events";

export const dynamic = "force-dynamic";

/**
 * Страница открыта на любом тарифе: прайс за замком — это предложение,
 * которого не видит ровно тот, кому оно адресовано.
 *
 * Видна и до включения оплаты (`BILLING_FROM`): у всех тогда Pro, и таблица
 * работает сравнением — что даёт каждый тариф и что останется после
 * включения. Кнопок «Выбрать» при этом нет по построению: выше Pro нечего.
 *
 * Своего ключа здесь больше нет. Он лежал в базе открытым текстом, и раздел
 * убран вместе с ним: хранить чужой секрет ради настройки, которой никто
 * не пользовался, незачем. Модель дайджеста задаётся окружением.
 */
export default async function SubscriptionPage() {
  const [reader, t, locale] = await Promise.all([currentReader(), getDict(), currentLocale()]);
  // Ранним — сколько ещё Pro и какая скидка: без этой строки месяц Pro
  // после включения выглядел бы как чужой тариф, а скидка — как её отсутствие.
  const grace = founderGraceEnds();
  const inGrace = grace !== null && new Date() < grace && isFounder(reader.created_at);
  const date = grace?.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "long" });
  const discount = hasFounderDiscount(reader);
  await recordBillingEvent({
    id: dailyId("plans", reader.id), readerId: reader.id, name: "plans_viewed", occurredAt: new Date().toISOString(),
  });
  // Действующий, а не купленный: отменённая подписка ещё работает,
  // истёкшая — уже нет, и страница обязана показывать то же, что и предел.
  return (
    <div className="flex flex-col gap-6">
      {inGrace || discount ? (
        <p className="rounded-lg border border-amber-400/70 bg-amber-50 p-4 text-sm dark:bg-amber-400/10">
          {inGrace && date ? t.plans.table.founderGrace(date) : null}{" "}
          {discount ? t.plans.table.founderDiscount(FOUNDER_DISCOUNT) : null}
        </p>
      ) : null}
      <PlanTable reader={reader} current={effectivePlan(reader)} />
    </div>
  );
}
