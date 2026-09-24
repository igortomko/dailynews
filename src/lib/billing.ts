import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PLANS, billingFrom, billingOn, founderGraceEnds, isFounder, planOf, type Plan, type PlanId,
} from "./plans";
import type { Voice } from "./voice";
import type { Reader } from "./types";

/**
 * Оплата через Paddle.
 *
 * Здесь только то, чего нельзя отдать им: какой тариф куплен, действует ли
 * он сейчас и куда вести читателя. Смена карты, отмена, возобновление, счета
 * и налоги — на их стороне, в портале клиента: у нас это был бы второй набор
 * состояний, расходящийся с настоящим.
 *
 * Sandbox и боевой аккаунт у Paddle — два разных аккаунта с разными ключами,
 * ценами и секретами. Какой из них, решает `PADDLE_ENV`; всё остальное
 * берётся из той же пары переменных, так что переезд на боевой — смена
 * значений, а не кода.
 */
export const paddleEnv = (): "sandbox" | "production" =>
  process.env.PADDLE_ENV === "production" ? "production" : "sandbox";

export const paddleApi = () =>
  paddleEnv() === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";

/**
 * Период оплаты. Годовая цена — отдельная цена того же тарифа: тариф один,
 * отличается только частота списания, и вебхук сводит обе к одному `plan`.
 */
export type Cycle = "month" | "year";
export const cycleOf = (value: unknown): Cycle => (value === "year" ? "year" : "month");

/**
 * Оплата подключена: есть серверный ключ (им находится цена) и клиентский
 * токен (им открывается окно). Цены, триал и годовая оплата — не здесь,
 * а в `PLANS`: Paddle подтягивается к ним сам (`lib/paddle-catalog.ts`).
 */
export const paymentsReady = (): boolean =>
  Boolean(process.env.PADDLE_API_KEY && process.env.PADDLE_CLIENT_TOKEN);

/**
 * Сколько дней триала у этого тарифа. Ноль — триала нет, и говорить о нём
 * нельзя. Число одно на кнопку и на Paddle — `PLANS[plan].trialDays`, —
 * поэтому обещание не расходится с тем, что Paddle спишет.
 */
export const trialDaysFor = (plan: PlanId): number => (paymentsReady() ? PLANS[plan].trialDays : 0);

/** Есть ли годовая оплата хоть у одного тарифа: без неё переключателю нечего переключать. */
export const yearlyReady = (): boolean => paymentsReady() && Object.values(PLANS).some((p) => p.yearPrice > 0);

/**
 * Тариф и период по метке цены (`custom_data: { plan, cycle }`), которую
 * ставит синхронизация каталога. Вебхук получает цену целиком внутри
 * события, поэтому id цен не хранятся нигде. Незнакомая метка — не тариф:
 * цена, заведённая руками в кабинете, платного тарифа не выдаёт.
 */
export function planOfPrice(
  price: { custom_data?: { plan?: string; cycle?: string } | null } | null | undefined,
): { plan: Plan; cycle: Cycle } | null {
  const id = price?.custom_data?.plan;
  if (!id || !(id in PLANS) || PLANS[id as PlanId].price <= 0) return null;
  return { plan: PLANS[id as PlanId], cycle: cycleOf(price?.custom_data?.cycle) };
}

/**
 * Куда ведёт «Выбрать». Своя страница, а не ссылка Paddle: окно оплаты —
 * overlay Paddle.js, и открыть его можно только у себя. Без оплаты, у
 * бесплатного тарифа и у периода, которого у тарифа нет, кнопке вести
 * некуда: кнопка на пустое окно хуже отсутствующей.
 */
export const checkoutUrl = (plan: PlanId, cycle: Cycle = "month"): string | null =>
  paymentsReady() && PLANS[plan].price > 0 && (cycle === "month" || PLANS[plan].yearPrice > 0)
    ? `/checkout/${plan}${cycle === "year" ? "?cycle=year" : ""}`
    : null;

/** Что нужно Paddle.js, чтобы открыть оплату этому читателю. */
export type CheckoutParams = {
  token: string;
  environment: "sandbox" | "production";
  priceId: string;
  /**
   * Номер читателя уходит в custom_data: вебхук приходит от Paddle, а не
   * из браузера, и связать платёж с читателем больше нечем — почта в чеке
   * может отличаться от той, что в профиле. Paddle переносит custom_data
   * с транзакции на подписку, и оттуда его читает `readEvent`.
   */
  customData: { reader_id: string };
  discountCode: string | null;
  email: string | null;
};

/** Параметры окна. id цены находит вызывающий (`priceIdFor`) — здесь только сборка. */
export function checkoutFor(
  priceId: string | null,
  reader: Pick<Reader, "id" | "created_at" | "email">,
): CheckoutParams | null {
  const token = process.env.PADDLE_CLIENT_TOKEN;
  if (!priceId || !token) return null;
  return {
    token,
    environment: paddleEnv(),
    priceId,
    customData: { reader_id: String(reader.id) },
    // Скидка ранним подставляется сама: код, который надо помнить и вводить,
    // до оплаты не доживает. Код не задан — оплата без скидки, а не сломанная.
    discountCode: hasFounderDiscount(reader) ? process.env.PADDLE_DISCOUNT_FOUNDER! : null,
    email: reader.email ?? null,
  };
}


/**
 * Достаётся ли этому читателю скидка ранних. Код не задан — не достаётся
 * никому, и интерфейс о ней молчит: обещанная и не подставленная скидка
 * хуже несуществующей.
 */
export const hasFounderDiscount = (reader: Pick<Reader, "created_at">): boolean =>
  Boolean(process.env.PADDLE_DISCOUNT_FOUNDER) && isFounder(reader.created_at);

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
  // У владельца действует то, что стоит в колонке, — и до включения оплаты
  // тоже: подписки он у себя самого не покупает, а посмотреть на продукт
  // глазами бесплатного читателя и пройти оплату в sandbox до того, как
  // её увидят все, может только так. Выдать ему Pro было бы короче, но
  // тогда проверка «платный источник просит Pro» меряет владельца и мертва.
  if (reader.owner) return planOf(reader.plan);

  // Оплата не включена — Pro у всех остальных.
  if (!billingOn(now, from)) return PLANS.pro;

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
  // past_due у Paddle — не просрочка, а попытки списать заново (dunning,
  // до месяца): карта истекла, человек ещё ничего не решал. Гасить тариф
  // на первой неудачной попытке значит наказать платящего за банк; сам
  // Paddle переведёт подписку в canceled, когда попытки кончатся.
  if (status === "active" || status === "trialing" || status === "past_due") return bought;

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
 * Подпись вебхука: `Paddle-Signature: ts=<секунды>;h1=<hex>`, где h1 —
 * HMAC-SHA256 от `<ts>:<сырое тело>` секретом этого адреса уведомлений.
 *
 * Адрес открыт всему интернету, и единственное, что отличает Paddle
 * от постороннего, — эта подпись. Незаданный секрет означает «нет», а не
 * «пропускай всех»: иначе забытая переменная превращает эндпоинт смены
 * тарифа в публичный.
 *
 * Старше пяти минут — отказ: подписанное тело, перехваченное однажды,
 * иначе можно было бы прислать снова через месяц и вернуть отменённый
 * тариф. Повтор доставки самим Paddle приходит со свежим ts, его это
 * не задевает.
 */
export const SIGNATURE_MAX_AGE_S = 300;

export function signatureValid(raw: string, header: string | null, now = Date.now()): boolean {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret || !header) return false;

  const parts = Object.fromEntries(
    header.split(";").map((part) => {
      const at = part.indexOf("=");
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()];
    }),
  );
  const ts = Number(parts.ts);
  if (!Number.isInteger(ts) || !parts.h1) return false;
  if (Math.abs(now / 1000 - ts) > SIGNATURE_MAX_AGE_S) return false;

  const expected = createHmac("sha256", secret).update(`${parts.ts}:${raw}`).digest();
  const got = Buffer.from(parts.h1, "hex");
  // Длину сверяем отдельно: timingSafeEqual бросает на разных длинах,
  // и падение здесь читалось бы как ошибка сервера, а не как чужая подпись.
  // Мусор вместо hex даёт буфер другой длины и отсекается тут же.
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

/** Что записать читателю по событию подписки. */
export type SubscriptionUpdate = {
  plan: PlanId;
  status: string;
  renewsAt: string | null;
  endsAt: string | null;
  subscriptionId: string;
  /** Когда событие случилось у Paddle: по нему отсекается опоздавшее старое. */
  occurredAt: string;
  cycle: Cycle;
  /** Тариф цены — и у закончившейся подписки: воронке отмены важно, с чего ушли. */
  pricePlan: PlanId;
};

type PaddlePayload = {
  event_id?: string;
  event_type?: string;
  occurred_at?: string;
  data?: {
    id?: string;
    status?: string;
    custom_data?: { reader_id?: string | number } | null;
    items?: { price?: { id?: string; custom_data?: { plan?: string; cycle?: string } | null } }[];
    next_billed_at?: string | null;
    canceled_at?: string | null;
    current_billing_period?: { ends_at?: string } | null;
    scheduled_change?: { action?: string; effective_at?: string } | null;
  };
};

/**
 * Разбор события. Возвращает, что записать читателю, или причину отказа —
 * молча проглоченное событие означает тариф, который не включился
 * и не выключился, и заметно это будет через месяц по жалобе.
 */
export function readEvent(payload: PaddlePayload):
  | { ok: true; readerId: number; update: SubscriptionUpdate }
  | { ok: false; why: string } {
  const event = payload.event_type ?? "";
  if (!event.startsWith("subscription.")) return { ok: false, why: `событие ${event} не про подписку` };

  const data = payload.data ?? {};
  const readerId = Number(data.custom_data?.reader_id);
  if (!Number.isInteger(readerId) || readerId <= 0) {
    return { ok: false, why: "в custom_data нет номера читателя" };
  }

  const price = data.items?.[0]?.price;
  const priced = planOfPrice(price);
  if (!priced) return { ok: false, why: `цена ${price?.id} не привязана к тарифу` };
  const { plan, cycle } = priced;

  const status = data.status ?? "";
  // canceled у Paddle — уже конец, а не «отменена, дочитывает»: отмена
  // посреди периода приходит как active с scheduled_change. Paused — без
  // оплаты и без доступа. Оба сразу к бесплатному: платный тариф в колонке
  // при мёртвой подписке — это платный выпуск даром.
  const dead = status === "canceled" || status === "paused";
  const cancelling = data.scheduled_change?.action === "cancel";

  return {
    ok: true,
    readerId,
    update: {
      plan: dead ? "free" : plan.id,
      status,
      renewsAt: cancelling ? null : data.next_billed_at ?? null,
      endsAt: cancelling
        ? data.scheduled_change?.effective_at ?? data.current_billing_period?.ends_at ?? null
        : dead ? data.canceled_at ?? null : null,
      subscriptionId: String(data.id ?? ""),
      occurredAt: payload.occurred_at ?? new Date().toISOString(),
      cycle,
      pricePlan: plan.id,
    },
  };
}

/** Платёж или возврат для воронки: сумма в центах, как её прислал Paddle. */
export type MoneyEvent = {
  eventId: string;
  kind: "payment_succeeded" | "payment_refunded";
  readerId: number | null;
  subscriptionId: string | null;
  paymentId: string;
  refundId: string | null;
  /**
   * Вернули всё: полный возврат или chargeback. Только такой закрывает
   * доступ — частичный возврат это компенсация, а не отказ от покупки.
   */
  full: boolean;
  amountMinor: number;
  currency: string;
  plan: PlanId | null;
  cycle: Cycle;
  occurredAt: string;
};

type MoneyPayload = {
  event_id?: string;
  event_type?: string;
  occurred_at?: string;
  data?: {
    id?: string;
    status?: string;
    action?: string;
    type?: string;
    transaction_id?: string;
    subscription_id?: string | null;
    currency_code?: string;
    custom_data?: { reader_id?: string | number } | null;
    items?: { price?: { id?: string; custom_data?: { plan?: string; cycle?: string } | null } | null }[];
    details?: { totals?: { grand_total?: string; grand_total_tax?: string; tax?: string } } | null;
    totals?: { total?: string; subtotal?: string } | null;
  };
};

/**
 * Деньги из вебхука: `transaction.completed` — платёж, одобренный возврат
 * (`adjustment.*`, action refund, status approved) — возврат. Нулевая
 * транзакция — это начало триала, а не платёж: кит отвергает платёж без
 * суммы, и нулевой «платёж» в воронке выдал бы триал за покупку.
 *
 * Номер читателя может не прийти: у продления custom_data переносится
 * не всегда, у возврата его нет вовсе. Тогда вебхук ищет читателя
 * по подписке — поэтому она возвращается рядом.
 */
export function readMoney(payload: MoneyPayload): MoneyEvent | null {
  const data = payload.data ?? {};
  const type = payload.event_type ?? "";
  const reader = Number(data.custom_data?.reader_id);
  const base = {
    eventId: payload.event_id ?? "",
    readerId: Number.isInteger(reader) && reader > 0 ? reader : null,
    subscriptionId: data.subscription_id ?? null,
    currency: data.currency_code ?? "",
    occurredAt: payload.occurred_at ?? new Date().toISOString(),
  };
  if (!base.eventId || !/^[A-Z]{3}$/.test(base.currency)) return null;

  if (type === "transaction.completed") {
    // Выручка — без налога: НДС уходит государству, а не нам, и с ним
    // европейский платёж выглядел бы на пятую часть дороже американского.
    // Берётся то, что списано (`grand_total` — за вычетом зачтённого
    // баланса), минус налог в этом списании.
    const totals = data.details?.totals;
    const amount = Number(totals?.grand_total) - Number(totals?.grand_total_tax ?? totals?.tax ?? 0);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !data.id) return null;
    const priced = planOfPrice(data.items?.[0]?.price);
    return {
      ...base, kind: "payment_succeeded", paymentId: data.id, refundId: null, full: false, amountMinor: amount,
      plan: priced?.plan.id ?? null, cycle: priced?.cycle ?? "month",
    };
  }

  // Chargeback — деньги забрал банк по спору: для воронки это тот же возврат,
  // и доступ он закрывает так же, как полный возврат.
  const refundLike = data.action === "refund" || data.action === "chargeback";
  if (type.startsWith("adjustment.") && refundLike && data.status === "approved") {
    // Тоже без налога — вычитается из выручки, посчитанной без него.
    const amount = Number(data.totals?.subtotal ?? data.totals?.total);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !data.id || !data.transaction_id) return null;
    return {
      ...base, kind: "payment_refunded", paymentId: data.transaction_id, refundId: data.id, amountMinor: amount,
      full: data.action === "chargeback" || data.type === "full",
      plan: null, cycle: "month",
    };
  }
  return null;
}

/**
 * Что случилось с подпиской между прежним и новым состоянием — для воронки.
 *
 * Отмена, вступившая в силу, и платежи пишутся своими событиями Paddle;
 * здесь — то, что видно только сравнением: назначил отмену, передумал,
 * повысил, понизил, платёж не прошёл. Без них между «заплатил» и «ушёл»
 * пусто, и отток видно на месяц позже, чем решение о нём.
 *
 * Другая подписка — не переход: её начало пишут триал и платёж.
 */
export type Transition = "cancel_scheduled" | "resumed" | "upgraded" | "downgraded" | "payment_failed";

const LIVE_STATUS = new Set(["active", "trialing", "past_due"]);

export function transitions(
  prev: { plan: string; subscription_id: string | null; subscription_status: string | null; plan_ends_at: string | Date | null } | undefined,
  next: SubscriptionUpdate,
): Transition[] {
  if (!prev || !next.subscriptionId || prev.subscription_id !== next.subscriptionId) return [];
  const wasLive = LIVE_STATUS.has(prev.subscription_status ?? "");
  const isLive = LIVE_STATUS.has(next.status);
  const found: Transition[] = [];
  if (isLive && next.endsAt && !prev.plan_ends_at) found.push("cancel_scheduled");
  if (isLive && !next.endsAt && prev.plan_ends_at) found.push("resumed");
  if (wasLive && isLive) {
    const before = planOf(prev.plan).price;
    const after = PLANS[next.pricePlan].price;
    if (after > before) found.push("upgraded");
    if (after < before && before > 0) found.push("downgraded");
  }
  if (next.status === "past_due" && prev.subscription_status !== "past_due") found.push("payment_failed");
  return found;
}
