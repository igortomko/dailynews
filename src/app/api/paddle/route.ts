import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cycleOfPrice, readEvent, readMoney, signatureValid } from "@/lib/billing";
import { recordBillingEvent } from "@/lib/analytics/billing-events";

/**
 * Вебхук Paddle: единственный путь, которым тариф меняется.
 *
 * Читателю тариф не выдаётся по закрытию окна оплаты: это событие приходит
 * из браузера, и подделать его может кто угодно. Право на платный тариф
 * даёт только подписанное событие с их стороны.
 *
 * Кроме тарифа, отсюда же пишется воронка оплаты: триал, платёж, возврат,
 * отмена (`billing_events`). Ключ каждой строки — номер сущности Paddle,
 * а не доставки: повтор того же события ничего не удваивает.
 */
export const dynamic = "force-dynamic";

/** Читатель по подписке — для продлений и возвратов, где номера в custom_data нет. */
async function readerOfSubscription(subscriptionId: string | null): Promise<number | null> {
  if (!subscriptionId) return null;
  const [row] = await sql<{ id: number }[]>`
    select id::int from dailynews.readers where subscription_id = ${subscriptionId} limit 1
  `;
  return row?.id ?? null;
}

export async function POST(request: Request) {
  // Тело читаем строкой: подпись считается по байтам, и JSON.parse →
  // JSON.stringify меняет их так, что подпись перестаёт сходиться.
  const raw = await request.text();

  if (!signatureValid(raw, request.headers.get("paddle-signature"))) {
    // Адрес открыт всему интернету — отказ обязан быть тихим для чужого
    // и заметным в логе для нас. Не-2xx Paddle повторит: если это наш
    // сменённый и ещё не развёрнутый секрет, событие доедет после деплоя.
    console.error("paddle: подпись не сошлась");
    return new NextResponse("нет", { status: 401 });
  }

  let payload: { event_type?: string; data?: { items?: { price?: { id?: string } }[] } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("не JSON", { status: 400 });
  }

  // Деньги: платёж и возврат идут в воронку, тариф они не меняют —
  // тариф решают события подписки.
  const money = readMoney(payload as Parameters<typeof readMoney>[0]);
  if (money) {
    const readerId = money.readerId ?? await readerOfSubscription(money.subscriptionId);
    await recordBillingEvent({
      id: money.kind === "payment_succeeded" ? `pay-${money.paymentId}` : `refund-${money.refundId}`,
      readerId,
      name: money.kind,
      occurredAt: money.occurredAt,
      plan: money.plan,
      cycle: money.kind === "payment_succeeded" ? money.cycle : null,
      amountMinor: money.amountMinor,
      currency: money.currency,
      paymentId: money.paymentId,
      refundId: money.refundId,
    });
    console.log(`paddle: ${money.kind} ${money.amountMinor} ${money.currency}, читатель ${readerId ?? "?"}`);
    return NextResponse.json({ ok: true });
  }

  const read = readEvent(payload as Parameters<typeof readEvent>[0]);
  if (!read.ok) {
    // 200, а не ошибка: Paddle повторяет неуспешные доставки трое суток,
    // и событие, которое мы всё равно не применим, повторялось бы зря.
    console.error(`paddle: событие пропущено — ${read.why}`);
    return NextResponse.json({ skipped: read.why });
  }

  const { readerId, update } = read;
  const priceId = payload.data?.items?.[0]?.price?.id;
  // Воронка пишется до тарифа и независимо от порядка: «взял триал» — факт,
  // даже если следом пришло более новое событие и тариф уже другой.
  if (payload.event_type === "subscription.created" && update.status === "trialing") {
    await recordBillingEvent({
      id: `trial-${update.subscriptionId}`, readerId, name: "trial_started", occurredAt: update.occurredAt,
      plan: update.plan, cycle: cycleOfPrice(priceId),
    });
  }
  if (payload.event_type === "subscription.canceled") {
    await recordBillingEvent({
      id: `canceled-${update.subscriptionId}`, readerId, name: "canceled", occurredAt: update.occurredAt,
      plan: update.plan, cycle: cycleOfPrice(priceId),
    });
  }

  // Условие на время события — защита от доставки не по порядку: старое
  // событие, пришедшее после нового, не перезаписывает то, что уже стало.
  // Повтор того же события проходит (<=) и записывает то же самое.
  const updated = await sql<{ id: number }[]>`
    update dailynews.readers
       set plan = ${update.plan},
           subscription_id = ${update.subscriptionId || null},
           subscription_status = ${update.status || null},
           plan_renews_at = ${update.renewsAt},
           plan_ends_at = ${update.endsAt},
           subscription_event_at = ${update.occurredAt},
           updated_at = now()
     where id = ${readerId}
       and (subscription_event_at is null or subscription_event_at <= ${update.occurredAt}::timestamptz)
    returning id
  `;

  if (updated.length === 0) {
    console.error(`paddle: читатель ${readerId} не найден или событие старше применённого — пропущено`);
    return NextResponse.json({ skipped: "нет читателя или событие устарело" });
  }

  console.log(`paddle: читатель ${readerId} → ${update.plan} (${update.status})`);
  return NextResponse.json({ ok: true });
}
