/**
 * Тарифы и их пределы.
 *
 * Пределы стоят здесь, а не в базе: это продуктовое решение, а не настройка
 * читателя, и таблица из трёх строк, меняющаяся раз в квартал, стоила бы
 * миграции на каждую правку цены.
 *
 * Считать пределы умеет и интерфейс, и конвейер — и оба обязаны считать
 * одинаково. Понижение тарифа не выключает лишние источники задним числом:
 * они остаются в наборе читателя, и только прогон решает, кого опрашивать.
 * Поэтому предел применяется в двух местах, а живёт в одном.
 */
import type { Source } from "./types";
import { plural } from "./plural";

export const PLAN_IDS = ["free", "plus", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/**
 * Разделы настроек, которые тариф может закрыть.
 *
 * Список короткий намеренно. Закрывать имеет смысл то, что стоит денег:
 * лишний источник и лишняя сотня описаний — это счёт за модель. Язык,
 * сложность и манера не стоят ничего: тот же вызов, другой промпт, —
 * и держать их за тарифом значит ухудшать бесплатный выпуск без причины,
 * ради ощущения, что платное что-то даёт.
 */
export const GATED = ["delivery", "language"] as const;
export type Gated = (typeof GATED)[number];

export type Plan = {
  id: PlanId;
  label: string;
  /** $ в месяц. Ноль — бесплатный тариф. */
  price: number;
  /** Сколько источников опрашивается. Остальные включённые просто ждут. */
  maxSources: number;
  /**
   * Сколько интересов живёт одновременно.
   *
   * Персонален только предел, а цена — общая: темы всех читателей уходят
   * в вопрос Jev одним списком, и каждая удлиняет его на каждом материале
   * потока. Пятикратный рост предела сам по себе ничего не стоит, а вот
   * три сотни заведённых тем — это уже $2.8 в месяц на всех.
   */
  maxTopics: number;
  /** Размеры выпуска, доступные на тарифе. Первый — по умолчанию. */
  digestSizes: number[];
  /** Виды источников, разрешённые тарифом. X платный, поэтому только Pro. */
  kinds: Source["kind"][];
  /** Разделы настроек, открытые тарифом. */
  sections: Gated[];
  /**
   * Через сколько дней приходит выпуск. Единица — каждую ночь.
   *
   * Это честнее, чем урезать размер выпуска: на бесплатном лента остаётся
   * такой же, просто реже. Урезанный выпуск выглядит как плохой продукт,
   * редкий — как бесплатный.
   */
  everyDays: number;
};

// Telegram и почта ничего не стоят: публичный канал читается как страница,
// а ящик свой. Платный здесь только X — у него счёт за прочитанные посты.
const FREE_KINDS: Source["kind"][] = ["rss", "hackernews", "reddit", "telegram", "email"];

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    label: "Бесплатный",
    price: 0,
    maxSources: 5,
    maxTopics: 5,
    digestSizes: [5, 10],
    everyDays: 2,
    kinds: FREE_KINDS,
    // На бесплатном остаётся то, без чего ленты не будет: интересы
    // и источники. Манера письма и разбор статистики — уже выбор,
    // за который платят.
    sections: [],
  },
  plus: {
    id: "plus",
    label: "Plus",
    price: 1.99,
    maxSources: 40,
    maxTopics: 15,
    digestSizes: [20, 40],
    everyDays: 1,
    kinds: FREE_KINDS,
    sections: ["language"],
  },
  pro: {
    id: "pro",
    label: "Pro",
    price: 4.99,
    maxSources: 100,
    maxTopics: 30,
    digestSizes: [20, 40, 60, 80, 100],
    everyDays: 1,
    // X — единственный платный источник: twitterapi.io берёт около $0.15
    // за тысячу постов. На бесплатном тарифе он окупаться не может.
    kinds: [...FREE_KINDS, "x"],
    sections: ["delivery", "language"],
  },
};

/**
 * Незнакомое значение читается как бесплатный тариф, а не как Pro.
 * Опечатка в колонке не должна открывать платный источник (урок 0014:
 * код знает свои варианты сам и откатывается к безопасному).
 */
export function planOf(id: string | null | undefined): Plan {
  return PLANS[(id ?? "") as PlanId] ?? PLANS.free;
}

/**
 * Почему этот вид источника тарифу не положен, или null, если положен.
 *
 * Отдельной функцией, потому что спросить надо дважды и в разных местах:
 * при сохранении и до разбора ссылки. X — платный, у него счёт
 * за прочитанные посты, и разбор сам по себе уже стоит денег.
 */
export function kindDenial(plan: Plan, kind: Source["kind"]): string | null {
  if (plan.kinds.includes(kind)) return null;
  const where = PLAN_IDS.filter((id) => PLANS[id].kinds.includes(kind)).map((id) => PLANS[id].label);
  return where.length
    ? `Источники ${kind} есть только на тарифе «${where.join("», «")}»`
    : `Источники ${kind} недоступны`;
}

export const maxDigestOf = (plan: Plan) => plan.digestSizes[plan.digestSizes.length - 1];

export const allows = (plan: Plan, section: Gated) => plan.sections.includes(section);

/** «2 интереса», «5 интересов» — форма нужна и в отказе, и в заглушке. */
export const topicsWord = (n: number) => plural(n, "интерес", "интереса", "интересов");

/** Самый дешёвый тариф, который открывает раздел. Для подписи в заглушке. */
export const cheapestWith = (section: Gated): Plan =>
  PLAN_IDS.map((id) => PLANS[id]).find((plan) => allows(plan, section)) ?? PLANS.pro;

/**
 * Что именно закрыто тарифом — описано данными, а не разложено по экранам.
 *
 * `has` — та же проверка, по которой возможность работает. Корона, текст
 * окна и настоящий предел обязаны опираться на одно правило: корона над
 * работающей кнопкой и работающая кнопка без короны — одинаково стыдно,
 * и оба случая на глаз незаметны.
 */
export type FeatureId =
  | "personalization" | "delivery" | "language" | "x"
  | "topics" | "digest" | "sources" | "cadence";

export type Feature = {
  title: string;
  /** Одна фраза: что читатель получит. Без «улучшенный» и «расширенный». */
  what: string;
  has: (plan: Plan) => boolean;
};

export const FEATURES: Record<FeatureId, Feature> = {
  personalization: {
    title: "Язык и подача",
    what: "На каком языке приходит выпуск и как он написан: попроще или как специалисту, суховато или живее. Есть на любом тарифе.",
    // Доступна всем: промпт от неё не дорожает ни на токен.
    has: () => true,
  },
  language: {
    title: "Перевод на свой язык",
    what: "Выпуск приходит на выбранном языке. На бесплатном заголовки и описания остаются на языке источника.",
    has: (plan) => allows(plan, "language"),
  },
  delivery: {
    title: "Выпуск на читалку",
    what: "Выпуск приходит книгой на Kindle — читать с электронных чернил, без телефона.",
    has: (plan) => allows(plan, "delivery"),
  },
  x: {
    title: "Посты из X",
    what: "Твиты попадают в выпуск наравне с новостями сайтов. X берёт за доступ отдельно, поэтому только на Pro.",
    has: (plan) => plan.kinds.includes("x"),
  },
  topics: {
    title: "Темы",
    what: "О чём тебе интересно читать — например, ИИ или дизайн. Выпуск делится между темами, чтобы одна не заняла всё.",
    has: (plan) => plan.maxTopics > PLANS.free.maxTopics,
  },
  cadence: {
    title: "Как часто приходит",
    what: "На платных тарифах выпуск приходит каждую ночь, на бесплатном — через день.",
    has: (plan) => plan.everyDays <= 1,
  },
  digest: {
    title: "Новостей в выпуске",
    what: "Сколько новостей приходит за раз. Десять — прочитать за кофе, сто — растянуть на день.",
    has: (plan) => maxDigestOf(plan) > maxDigestOf(PLANS.free),
  },
  sources: {
    title: "Источников",
    what: "Сайты, блоги и каналы, за которыми лента следит каждый день. Чем их больше, тем шире выбор для выпуска.",
    has: (plan) => plan.maxSources > PLANS.free.maxSources,
  },
};

/**
 * Выпуск этой ночью или нет.
 *
 * День считается от даты, а не от прошлого выпуска: прогон могут запустить
 * дважды за сутки или пропустить ночь, и отсчёт «от прошлого раза» тогда
 * съезжает навсегда. Номер читателя в формуле разносит бесплатных по разным
 * ночам — иначе половина ленты просыпается в один день.
 */
export function issuesToday(plan: Plan, readerId: number, day: string | Date): boolean {
  if (plan.everyDays <= 1) return true;
  const epochDay = Math.floor(new Date(day).getTime() / 86_400_000);
  return (epochDay + readerId) % plan.everyDays === 0;
}

/** Самый дешёвый тариф, на котором возможность есть. */
export const cheapestFor = (id: FeatureId): Plan =>
  PLAN_IDS.map((planId) => PLANS[planId]).find((plan) => FEATURES[id].has(plan)) ?? PLANS.pro;

/**
 * Что из выбранного читателем опрашивать в этом прогоне.
 *
 * На вход идёт его собственный набор (`readerSources`), а не каталог:
 * каталог общий, чтобы один фид опрашивался один раз на всех, но чей это
 * выпуск — решает личный выбор.
 *
 * Порядок — по id: при понижении тарифа остаются те, что заведены раньше,
 * и набор не пляшет от прогона к прогону. Запрещённый вид отсекается до
 * предела по числу, иначе три ленты X на бесплатном тарифе съедали бы
 * места живых источников, ничего при этом не собирая.
 */
export function sourcesForPlan(sources: Source[], plan: Plan): Source[] {
  return sources
    .filter((source) => plan.kinds.includes(source.kind))
    .sort((a, b) => a.id - b.id)
    .slice(0, plan.maxSources);
}
