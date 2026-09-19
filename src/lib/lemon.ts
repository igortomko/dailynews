import { createHmac, timingSafeEqual } from "node:crypto";
import { PLANS, planOf, type Plan, type PlanId } from "./plans";
import type { Reader } from "./types";

/**
 * Оплата через Lemon Squeezy.
 *
 * Здесь только то, чего нельзя отдать им: какой тариф куплен, действует ли
 * он сейчас и куда вести читателя. Смена карты, отмена, возобновление, счета
 * и налоги — на их стороне, своего экрана для этого нет и не будет: у нас
 * это был бы второй набор состояний, расходящийся с настоящим.
 */

/** Варианты подписки: числовой id из Lemon Squeezy → тариф. */
function variants(): Partial<Record<PlanId, { id: string; buy: string }>> {
  const read = (plan: PlanId, id?: string, buy?: string) =>
    id && buy ? { [plan]: { id, buy } } : {};
  return {
    ...read("plus", process.env.LEMON_VARIANT_PLUS, process.env.LEMON_BUY_PLUS),
    ...read("pro", process.env.LEMON_VARIANT_PRO, process.env.LEMON_BUY_PRO),
  };
}

/** Тариф по номеру варианта из вебхука. Незнакомый вариант — не тариф. */
export function planOfVariant(variantId: string | number | null | undefined): Plan | null {
  const id = String(variantId ?? "");
  for (const [plan, variant] of Object.entries(variants())) {
    if (variant.id === id) return PLANS[plan as PlanId];
  }
  return null;
}

/**
 * Ссылка на оплату. Номер читателя уходит в custom-данные: вебхук приходит
 * от Lemon Squeezy, а не из браузера, и связать платёж с читателем больше
 * нечем — почта в чеке может отличаться от той, что в профиле.
 */
export function checkoutUrl(plan: PlanId, readerId: number): string | null {
  const variant = variants()[plan];
  if (!variant) return null;
  const url = new URL(variant.buy);
  url.searchParams.set("checkout[custom][reader_id]", String(readerId));
  // Свой экран «спасибо» не нужен: читатель возвращается туда, откуда ушёл,
  // и видит тариф уже применённым — вебхук приходит раньше редиректа редко,
  // поэтому страница подписки сама показывает «платёж обрабатывается».
  url.searchParams.set("embed", "0");
  return url.toString();
}

export const paymentsConfigured = () => Object.keys(variants()).length > 0;

/**
 * Действующий тариф, а не купленный.
 *
 * Отменённая подписка работает до конца оплаченного периода: человек
 * заплатил за месяц и получает месяц. Просроченная и истёкшая не работают
 * с той же секунды — ждать ночного прогона, чтобы погасить тариф, значит
 * отдать ещё один платный выпуск бесплатно.
 *
 * Считается на каждый запрос, а не хранится колонкой: колонку пришлось бы
 * гасить по расписанию, а оно здесь ходит раз в сутки.
 */
export function effectivePlan(reader: Reader, now = new Date()): Plan {
  // Владелец не покупает подписку у себя самого. Записать ему «pro»
  // в колонку было бы короче, но это данные о подписке, которой нет:
  // статус пришлось бы выдумать «active», и первый же настоящий вебхук
  // или взгляд в базу этому бы поверил. Тариф владельца — правило,
  // а не платёж, и живёт оно в коде.
  if (reader.owner) return PLANS.pro;

  const bought = planOf(reader.plan);
  if (bought.id === "free") return bought;

  const status = reader.subscription_status ?? "";
  if (status === "active" || status === "on_trial") return bought;

  // Отменённая, но оплаченная до конца периода — это ещё платный тариф.
  if (reader.plan_ends_at && new Date(reader.plan_ends_at) > now) return bought;

  return PLANS.free;
}

/** Отменена, но ещё работает: интерфейс обязан сказать, до какого числа. */
export const endingAt = (reader: Reader, now = new Date()): Date | null => {
  if (!reader.plan_ends_at) return null;
  const ends = new Date(reader.plan_ends_at);
  return ends > now ? ends : null;
};

/**
 * Подпись вебхука.
 *
 * Адрес открыт всему интернету, и единственное, что отличает Lemon Squeezy
 * от постороннего, — эта подпись. Незаданный секрет означает «нет», а не
 * «пропускай всех»: иначе забытая переменная превращает эндпоинт смены
 * тарифа в публичный.
 */
export function signatureValid(raw: string, signature: string | null): boolean {
  const secret = process.env.LEMON_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(raw).digest();
  let got: Buffer;
  try {
    got = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  // Длину сверяем отдельно: timingSafeEqual бросает на разных длинах,
  // и падение здесь читалось бы как ошибка сервера, а не как чужая подпись.
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

/** Что делать с тарифом по статусу подписки. */
export type SubscriptionUpdate = {
  plan: PlanId;
  status: string;
  renewsAt: string | null;
  endsAt: string | null;
  subscriptionId: string;
  portalUrl: string | null;
};

type LemonPayload = {
  meta?: { event_name?: string; custom_data?: { reader_id?: string | number } };
  data?: {
    id?: string;
    attributes?: {
      variant_id?: number | string;
      status?: string;
      renews_at?: string | null;
      ends_at?: string | null;
      urls?: { customer_portal?: string };
    };
  };
};

/**
 * Разбор события. Возвращает, что записать читателю, или причину отказа —
 * молча проглоченное событие означает тариф, который не включился
 * и не выключился, и заметно это будет через месяц по жалобе.
 */
export function readEvent(payload: LemonPayload):
  | { ok: true; readerId: number; update: SubscriptionUpdate }
  | { ok: false; why: string } {
  const event = payload.meta?.event_name ?? "";
  if (!event.startsWith("subscription_")) return { ok: false, why: `событие ${event} не про подписку` };

  const readerId = Number(payload.meta?.custom_data?.reader_id);
  if (!Number.isInteger(readerId) || readerId <= 0) {
    return { ok: false, why: "в custom_data нет номера читателя" };
  }

  const attributes = payload.data?.attributes ?? {};
  const plan = planOfVariant(attributes.variant_id);
  if (!plan) return { ok: false, why: `вариант ${attributes.variant_id} не привязан к тарифу` };

  const status = attributes.status ?? "";
  // Статусы, после которых тариф не действует, приводим к бесплатному сразу:
  // «expired» с оплаченным тарифом в колонке — это платный выпуск даром.
  const dead = status === "expired" || status === "unpaid";

  return {
    ok: true,
    readerId,
    update: {
      plan: dead ? "free" : plan.id,
      status,
      renewsAt: attributes.renews_at ?? null,
      endsAt: attributes.ends_at ?? null,
      subscriptionId: String(payload.data?.id ?? ""),
      portalUrl: attributes.urls?.customer_portal ?? null,
    },
  };
}
