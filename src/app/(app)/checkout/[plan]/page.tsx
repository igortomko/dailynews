import { redirect } from "next/navigation";
import { currentReader } from "@/lib/session";
import { checkoutFor, checkoutUrl, cycleOf } from "@/lib/billing";
import { priceIdFor } from "@/lib/paddle-catalog";
import { PLANS, type PlanId } from "@/lib/plans";
import { CheckoutOverlay } from "./overlay";
import { dailyId, recordBillingEvent } from "@/lib/analytics/billing-events";

export const dynamic = "force-dynamic";

/**
 * Оплата тарифа: окно Paddle поверх этой страницы.
 *
 * Всё, что уходит в оплату, собирает сервер (`checkoutFor`): номер читателя
 * в custom_data, код скидки ранних, почта. Клиенту достаются только эти
 * значения — цены и коды в браузерном бандле жили бы до следующей сборки,
 * а не до смены переменной.
 *
 * Тариф здесь не выдаётся: закрытие окна приходит из браузера. Тариф
 * включает вебхук (`/api/paddle`), а страница подписки его уже покажет.
 */
export default async function CheckoutPage({
  params, searchParams,
}: {
  params: Promise<{ plan: string }>;
  searchParams: Promise<{ cycle?: string | string[] }>;
}) {
  const { plan } = await params;
  const cycle = cycleOf((await searchParams).cycle);
  if (!(plan in PLANS) || PLANS[plan as PlanId].price === 0) redirect("/settings/subscription");
  const reader = await currentReader();
  // Цена находится по метке тарифа и периода, а не по id из окружения:
  // каталог Paddle — производное от PLANS (`lib/paddle-catalog.ts`).
  const priceId = checkoutUrl(plan as PlanId, cycle)
    ? await priceIdFor(plan as PlanId, cycle).catch((error) => {
        console.error(`paddle: цена ${plan}/${cycle} не нашлась — ${(error as Error).message}`);
        return null;
      })
    : null;
  const checkout = checkoutFor(priceId, reader);
  if (!checkout) redirect("/settings/subscription");
  // Открыл оплату — шаг воронки между «посмотрел тарифы» и «взял триал»:
  // без него не отличить «не понравилась цена» от «не справился с окном».
  await recordBillingEvent({
    id: dailyId("checkout", reader.id, `${plan}-${cycle}`), readerId: reader.id, name: "checkout_started",
    occurredAt: new Date().toISOString(), plan, cycle,
  });
  return <CheckoutOverlay checkout={checkout} />;
}
