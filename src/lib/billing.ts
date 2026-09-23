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
 * Цены подписки: id цены из Paddle → тариф.
 *
 * Длина триала лежит здесь же, рядом с ценой, а не одной переменной на весь
 * продукт: включается триал на стороне Paddle и на конкретной цене. Одна
 * общая переменная обещала бы «7 дней бесплатно» и на том тарифе, где триала
 * не завели, — надпись, которая врёт ровно тому, кто по ней нажал.
 *
 * Не задана или не число — триала нет. Ноль и «нет» здесь одно и то же.
 */
/**
 * Период оплаты. Годовая цена — отдельная цена того же тарифа: тариф один,
 * отличается только частота списания, и вебхук сводит обе к одному `plan`.
 */
export type Cycle = "month" | "year";
export const cycleOf = (value: unknown): Cycle => (value === "year" ? "year" : "month");

type Price = { id: string; yearId: string | null; trialDays: number };

function prices(): Partial<Record<PlanId, Price>> {
  const read = (plan: PlanId, id?: string, yearId?: string, trial?: string) =>
    id ? { [plan]: { id, yearId: yearId || null, trialDays: Math.max(0, Math.trunc(Number(trial)) || 0) } } : {};
  return {
    ...read("plus", process.env.PADDLE_PRICE_PLUS, process.env.PADDLE_PRICE_PLUS_YEAR, process.env.PADDLE_TRIAL_PLUS),
    ...read("pro", process.env.PADDLE_PRICE_PRO, process.env.PADDLE_PRICE_PRO_YEAR, process.env.PADDLE_TRIAL_PRO),
  };
}

/** id цены под период. Годовой не заведено — годовой оплаты у тарифа нет. */
const priceId = (price: Price, cycle: Cycle) => (cycle === "year" ? price.yearId : price.id);

/** Заведена ли годовая оплата хоть у одного тарифа: без неё переключателю нечего переключать. */
export const yearlyReady = (): boolean => Object.values(prices()).some((price) => price.yearId);

/**
 * Сколько дней триала у этого тарифа. Ноль — триала нет, и говорить о нём
 * нельзя: в Paddle он живёт настройкой цены, а не нашим желанием.
 *
 * Замер 22 сентября 2026, предельная себестоимость Pro: $0.019 в день
 * типично и $0.053 в потолке. Неделя выходит $0.15–0.38 — дешевле, чем
 * $0.50 фиксированной комиссии с одного платежа. Расчёт — в docs/economics.md.
 */
export const trialDaysFor = (plan: PlanId): number => prices()[plan]?.trialDays ?? 0;

/** Тариф по id цены из вебхука. Незнакомая цена — не тариф. */
export function planOfPrice(priceId: string | null | undefined): Plan | null {
  for (const [plan, price] of Object.entries(prices())) {
    if (priceId && (price.id === priceId || price.yearId === priceId)) return PLANS[plan as PlanId];
  }
  return null;
}

/**
 * Оплата настроена: есть цена и клиентский токен. Без токена Paddle.js
 * не откроет окно, и кнопка, ведущая на пустую страницу, хуже кнопки,
 * которой нет.
 */
const checkoutReady = (plan: PlanId, cycle: Cycle) => {
  const price = prices()[plan];
  return Boolean(price && priceId(price, cycle) && process.env.PADDLE_CLIENT_TOKEN);
};

/**
 * Куда ведёт «Выбрать». Своя страница, а не ссылка Paddle: окно оплаты —
 * overlay Paddle.js, и открыть его можно только у себя. Всё, что уходит
 * в оплату, собирает `checkoutFor` на сервере этой страницы.
 */
export const checkoutUrl = (plan: PlanId, cycle: Cycle = "month"): string | null =>
  checkoutReady(plan, cycle) ? `/checkout/${plan}${cycle === "year" ? "?cycle=year" : ""}` : null;

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

export function checkoutFor(
  plan: PlanId,
  reader: Pick<Reader, "id" | "created_at" | "email">,
  cycle: Cycle = "month",
): CheckoutParams | null {
  const price = prices()[plan];
  const id = price && priceId(price, cycle);
  const token = process.env.PADDLE_CLIENT_TOKEN;
  if (!id || !token) return null;
  return {
    token,
    environment: paddleEnv(),
    priceId: id,
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
};

type PaddlePayload = {
  event_type?: string;
  occurred_at?: string;
  data?: {
    id?: string;
    status?: string;
    custom_data?: { reader_id?: string | number } | null;
    items?: { price?: { id?: string } }[];
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

  const priceId = data.items?.[0]?.price?.id;
  const plan = planOfPrice(priceId);
  if (!plan) return { ok: false, why: `цена ${priceId} не привязана к тарифу` };

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
    },
  };
}
