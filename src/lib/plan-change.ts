import { sql } from "./db";
import { cycleOf, paddleApi, readEvent, type Cycle, type SubscriptionUpdate } from "./billing";
import { priceIdFor } from "./paddle-catalog";
import { PLANS, type PlanId } from "./plans";
import type { Reader } from "./types";

/**
 * Смена тарифа у того, кто уже платит.
 *
 * Новое окно оплаты здесь нельзя: оно заводит вторую подписку, и человек
 * платит за оба тарифа сразу. Поэтому переход — правка той же подписки
 * через API Paddle, а портал клиента остаётся для карты, счетов и отмены.
 *
 * Повышение списывает разницу сразу, понижение применяется сразу же,
 * а остаток Paddle зачитывает в следующий платёж (`prorated_immediately`):
 * отложенной смены цены Paddle не умеет, а «Pro до конца месяца, потом
 * Plus» пришлось бы держать своим расписанием. На триале денег не
 * трогаем (`do_not_bill`) — триал продолжается уже на новом тарифе.
 *
 * Бесплатный — это отмена с конца оплаченного периода: доплаченное
 * дочитывается. Возобновление — снятие этой отмены.
 *
 * Ответ Paddle записывается сразу, тем же путём, что и вебхук: иначе
 * страница после нажатия показала бы старый тариф до прихода события.
 */
export type ChangeResult = { ok: true; plan: PlanId } | { ok: false; why: string };

const LIVE = new Set(["active", "trialing", "past_due"]);

type PaddleSubscription = {
  id: string;
  status: string;
  updated_at: string;
  scheduled_change: { action: string } | null;
};

async function paddle<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${paddleApi()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.PADDLE_API_KEY}`, "Content-Type": "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${body?.error?.code ?? ""} ${body?.error?.detail ?? ""}`.trim());
  return body.data as T;
}

/** Записать состояние подписки читателю — одна запись на вебхук и на смену тарифа. */
export async function applySubscription(readerId: number, update: SubscriptionUpdate): Promise<boolean> {
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
  return updated.length > 0;
}

export async function changePlan(
  reader: Pick<Reader, "id" | "subscription_id" | "subscription_status">,
  target: PlanId,
  cycle: Cycle = "month",
): Promise<ChangeResult> {
  if (!process.env.PADDLE_API_KEY) return { ok: false, why: "оплата не подключена" };
  if (!reader.subscription_id || !LIVE.has(reader.subscription_status ?? "")) {
    return { ok: false, why: "нет действующей подписки — это новая оплата, а не смена" };
  }
  const id = encodeURIComponent(reader.subscription_id);
  const current = await paddle<PaddleSubscription>(`/subscriptions/${id}`);
  if (!LIVE.has(current.status)) return { ok: false, why: `подписка ${current.status}` };

  let next: unknown;
  if (PLANS[target].price <= 0) {
    next = await paddle(`/subscriptions/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ effective_from: "next_billing_period" }),
    });
  } else {
    const priceId = await priceIdFor(target, cycleOf(cycle));
    if (!priceId) return { ok: false, why: `цены ${target}/${cycle} нет в каталоге` };
    next = await paddle(`/subscriptions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        items: [{ price_id: priceId, quantity: 1 }],
        proration_billing_mode: current.status === "trialing" ? "do_not_bill" : "prorated_immediately",
        // Выбрал платный тариф при назначенной отмене — значит, передумал
        // уходить: отмена снимается тем же нажатием.
        ...(current.scheduled_change ? { scheduled_change: null } : {}),
      }),
    });
  }

  const read = readEvent({
    event_type: "subscription.updated",
    occurred_at: (next as PaddleSubscription).updated_at,
    data: next as never,
  });
  if (!read.ok) return { ok: false, why: read.why };
  await applySubscription(reader.id, read.update);
  return { ok: true, plan: read.update.plan };
}

/**
 * Полный возврат или chargeback закрывают доступ сразу: подписка
 * отменяется немедленно, дальше `subscription.canceled` переводит читателя
 * на бесплатный обычным путём вебхука.
 *
 * Только если вернули платёж **текущего** периода: возврат прошлогоднего
 * списания не отменяет период, оплаченный отдельно. Период сверяется
 * по транзакции: её `billing_period` начинается не раньше текущего
 * периода подписки (доплата за повышение начинается посреди него).
 *
 * Повтор безопасен: отменённую подписку Paddle отменить не даст, и она
 * пропускается проверкой статуса.
 */
export async function endOnRefund(subscriptionId: string, transactionId: string): Promise<string> {
  const sub = await paddle<{ status: string; current_billing_period: { starts_at: string } | null }>(
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
  );
  if (!LIVE.has(sub.status)) return `подписка уже ${sub.status}`;
  const txn = await paddle<{ billing_period: { starts_at: string } | null }>(
    `/transactions/${encodeURIComponent(transactionId)}`,
  );
  const periodStart = sub.current_billing_period?.starts_at;
  const paidFrom = txn.billing_period?.starts_at;
  if (periodStart && paidFrom && new Date(paidFrom) < new Date(periodStart)) {
    return "возврат прошлого периода — текущий оплачен отдельно";
  }
  await paddle(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ effective_from: "immediately" }),
  });
  return "подписка отменена сразу";
}
