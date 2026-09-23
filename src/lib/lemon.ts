import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PLANS, billingFrom, billingOn, founderGraceEnds, isFounder, planOf, type Plan, type PlanId,
} from "./plans";
import type { Voice } from "./voice";
import type { Reader } from "./types";

/**
 * Оплата через Lemon Squeezy.
 *
 * Здесь только то, чего нельзя отдать им: какой тариф куплен, действует ли
 * он сейчас и куда вести читателя. Смена карты, отмена, возобновление, счета
 * и налоги — на их стороне, своего экрана для этого нет и не будет: у нас
 * это был бы второй набор состояний, расходящийся с настоящим.
 */

/**
 * Варианты подписки: числовой id из Lemon Squeezy → тариф.
 *
 * Длина триала лежит здесь же, рядом с вариантом, а не одной переменной
 * на весь продукт: включается триал на стороне Lemon и на конкретном
 * варианте. Одна общая переменная обещала бы «7 дней бесплатно» и на том
 * тарифе, где триала не завели, — надпись, которая врёт ровно тому, кто
 * по ней нажал.
 *
 * Не задана или не число — триала нет. Ноль и «нет» здесь одно и то же:
 * обещать нечего.
 */
function variants(): Partial<Record<PlanId, { id: string; buy: string; trialDays: number }>> {
  const read = (plan: PlanId, id?: string, buy?: string, trial?: string) =>
    id && buy
      ? { [plan]: { id, buy, trialDays: Math.max(0, Math.trunc(Number(trial)) || 0) } }
      : {};
  return {
    ...read("plus", process.env.LEMON_VARIANT_PLUS, process.env.LEMON_BUY_PLUS, process.env.LEMON_TRIAL_PLUS),
    ...read("pro", process.env.LEMON_VARIANT_PRO, process.env.LEMON_BUY_PRO, process.env.LEMON_TRIAL_PRO),
  };
}

/**
 * Сколько дней триала у этого тарифа. Ноль — триала нет, и говорить о нём
 * нельзя: в Lemon он живёт настройкой варианта, а не нашим желанием.
 *
 * Замер 22 сентября 2026, предельная себестоимость Pro: $0.019 в день
 * типично и $0.053 в потолке (сто карточек, свой список X). Неделя выходит
 * $0.15–0.38 — дешевле, чем $0.50 фиксированной комиссии Lemon с одного
 * платежа, и окупается при конверсии от 1,9%. Расчёт — в docs/economics.md.
 */
export const trialDaysFor = (plan: PlanId): number => variants()[plan]?.trialDays ?? 0;

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
export function checkoutUrl(
  plan: PlanId,
  reader: Pick<Reader, "id" | "created_at">,
): string | null {
  const variant = variants()[plan];
  if (!variant) return null;
  const url = new URL(variant.buy);
  url.searchParams.set("checkout[custom][reader_id]", String(reader.id));
  // Скидка ранним подставляется сама: код, который надо помнить и вводить,
  // до оплаты не доживает. Код не задан — ссылка без скидки, а не сломанная.
  if (hasFounderDiscount(reader)) {
    url.searchParams.set("checkout[discount_code]", process.env.LEMON_DISCOUNT_FOUNDER!);
  }
  // Свой экран «спасибо» не нужен: читатель возвращается туда, откуда ушёл,
  // и видит тариф уже применённым — вебхук приходит раньше редиректа редко,
  // поэтому страница подписки сама показывает «платёж обрабатывается».
  url.searchParams.set("embed", "0");
  return url.toString();
}

/**
 * Достаётся ли этому читателю скидка ранних. Код не задан — не достаётся
 * никому, и интерфейс о ней молчит: обещанная и не подставленная скидка
 * хуже несуществующей.
 */
export const hasFounderDiscount = (reader: Pick<Reader, "created_at">): boolean =>
  Boolean(process.env.LEMON_DISCOUNT_FOUNDER) && isFounder(reader.created_at);

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
/**
 * Голос выпуска: на каком языке, какой сложности и в какой манере.
 *
 * Тариф сюда больше не входит. Перевод гасился по тарифу и не экономил
 * ничего — тот же вызов, те же токены, — а означал разное у разных людей:
 * при англоязычных источниках бесплатный англичанин получал свой язык,
 * а бесплатный русский — чужой. Подробности в `GATED` (`lib/plans.ts`).
 *
 * Функция остаётся одна на прогон, догрузку и замер: умолчание при пустой
 * колонке живёт здесь, а не в трёх местах порознь. «Язык источника» —
 * законный выбор читателя, а не признак тарифа: он есть в списке и означает
 * «оставь как в источнике».
 *
 * Выбор читателя при этом не подменяется записью — ни тогда, ни теперь.
 * Подмена была необратимой: двадцатого сентября 2026 выпуск пришёл на сорок
 * материалов по-английски при русском в настройках, потому что сохранение
 * когда-то переписало колонку.
 */
export function effectiveVoice(reader: Reader): Voice {
  return {
    language: reader.language || "русском",
    complexity: reader.complexity,
    style: reader.style,
  };
}

export function effectivePlan(reader: Reader, now = new Date(), from: string | null = billingFrom()): Plan {
  // Оплата не включена — Pro у всех, включая владельца: смотреть продукт
  // глазами бесплатного читателя незачем, пока бесплатного тарифа нет.
  if (!billingOn(now, from)) return PLANS.pro;

  // У владельца действует то, что стоит в колонке: подписки он у себя
  // самого не покупает, и проверять её статус не по чему. Так у него
  // и стояло «pro» — и гасло каждой проверкой на подписку, которой нет.
  // Выдать ему Pro прямо здесь было бы короче, но тогда он не может
  // посмотреть на продукт глазами бесплатного читателя, а проверка
  // «платный источник просит Pro» меряет владельца и потому мертва.
  if (reader.owner) return planOf(reader.plan);

  // Ранний читатель дочитывает месяц Pro после включения, даже если купил
  // Plus раньше конца этого месяца: купленное не должно отнимать подаренное.
  const grace = founderGraceEnds(from);
  if (grace && now < grace && isFounder(reader.created_at, from)) return PLANS.pro;

  const bought = planOf(reader.plan);
  if (bought.id === "free") return bought;

  /**
   * Подписки нет вовсе — значит тариф выставлен не оплатой: так стоит pro
   * у владельца (0019 и перенос 0020) и так же выдаётся тариф руками.
   * Спрашивать у отсутствующей подписки, действует ли она, бессмысленно,
   * а ответ «нет» гасил бы владельцу его же возможности — молча, потому что
   * колонка plan при этом остаётся правильной.
   */
  if (!reader.subscription_id) return bought;

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
