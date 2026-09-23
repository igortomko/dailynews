import { redirect } from "next/navigation";
import { currentReader } from "@/lib/session";
import { checkoutFor } from "@/lib/billing";
import { PLANS, type PlanId } from "@/lib/plans";
import { CheckoutOverlay } from "./overlay";

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
export default async function CheckoutPage({ params }: { params: Promise<{ plan: string }> }) {
  const { plan } = await params;
  if (!(plan in PLANS) || PLANS[plan as PlanId].price === 0) redirect("/settings/subscription");
  const checkout = checkoutFor(plan as PlanId, await currentReader());
  if (!checkout) redirect("/settings/subscription");
  return <CheckoutOverlay checkout={checkout} />;
}
