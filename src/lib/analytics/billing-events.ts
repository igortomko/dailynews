import { sql } from "@/lib/db";

/**
 * События оплаты для воронки: от просмотра тарифов до платежа.
 *
 * Пишет их веб (просмотр тарифов, открытие оплаты) и вебхук Paddle
 * (триал, платёж, возврат, отмена). Запись никогда не роняет то, ради чего
 * человек пришёл: страница тарифов, открывшаяся с ошибкой из-за счётчика,
 * стоит дороже потерянной строки в воронке.
 */
export type BillingEventName =
  | "plans_viewed" | "checkout_started" | "trial_started"
  | "payment_succeeded" | "payment_refunded" | "canceled"
  | "cancel_scheduled" | "resumed" | "upgraded" | "downgraded" | "payment_failed";

export type BillingEvent = {
  id: string;
  readerId: number | null;
  name: BillingEventName;
  occurredAt: string;
  plan?: string | null;
  cycle?: "month" | "year" | null;
  amountMinor?: number | null;
  currency?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
};

export async function recordBillingEvent(event: BillingEvent): Promise<void> {
  try {
    await sql`
      insert into dailynews.billing_events
        (id, reader_id, name, occurred_at, plan, cycle, amount_minor, currency, payment_id, refund_id)
      values (${event.id}, ${event.readerId}, ${event.name}, ${event.occurredAt}::timestamptz,
              ${event.plan ?? null}, ${event.cycle ?? null}, ${event.amountMinor ?? null},
              ${event.currency ?? null}, ${event.paymentId ?? null}, ${event.refundId ?? null})
      on conflict (id) do nothing
    `;
  } catch (error) {
    console.error(`аналитика: событие ${event.name} не записано — ${(error as Error).message}`);
  }
}

/**
 * Одно событие на читателя в сутки: воронка считает людей, а не нажатия,
 * и десять заходов в «Подписку» за утро — это один день с просмотром.
 */
export const dailyId = (name: string, readerId: number, extra = "") =>
  `${name}-${readerId}-${new Date().toISOString().slice(0, 10)}${extra ? `-${extra}` : ""}`;
