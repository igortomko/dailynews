/**
 * Тарифы и их пределы.
 *
 * Пределы стоят здесь, а не в базе: это продуктовое решение, а не настройка
 * читателя, и таблица из трёх строк, меняющаяся раз в квартал, стоила бы
 * миграции на каждую правку цены.
 *
 * Считать пределы умеет и интерфейс, и конвейер — и оба обязаны считать
 * одинаково. Понижение тарифа не выключает лишние источники задним числом:
 * они остаются в каталоге включёнными, и только прогон решает, кого
 * опрашивать. Поэтому предел применяется в двух местах, а живёт в одном.
 */
import type { Source } from "./types";

export const PLAN_IDS = ["free", "plus", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/**
 * Разделы настроек, которые тариф может закрыть. Лента, интересы
 * и источники не закрываются никогда: без них продукта нет.
 */
export const GATED = ["personalization", "calibration", "subscription"] as const;
export type Gated = (typeof GATED)[number];

export type Plan = {
  id: PlanId;
  label: string;
  /** $ в месяц. Ноль — бесплатный тариф. */
  price: number;
  /** Сколько источников опрашивается. Остальные включённые просто ждут. */
  maxSources: number;
  /** Сколько интересов живёт одновременно. */
  maxTopics: number;
  /** Размеры выпуска, доступные на тарифе. Первый — по умолчанию. */
  digestSizes: number[];
  /** Виды источников, разрешённые тарифом. X платный, поэтому только Pro. */
  kinds: Source["kind"][];
  /** Разделы настроек, открытые тарифом. */
  sections: Gated[];
};

const FREE_KINDS: Source["kind"][] = ["rss", "hackernews", "reddit"];

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    label: "Бесплатный",
    price: 0,
    maxSources: 5,
    maxTopics: 2,
    digestSizes: [5, 10],
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
    maxSources: 15,
    maxTopics: 5,
    digestSizes: [20, 40],
    kinds: FREE_KINDS,
    sections: ["personalization", "calibration"],
  },
  pro: {
    id: "pro",
    label: "Pro",
    price: 4.99,
    maxSources: 40,
    maxTopics: 10,
    digestSizes: [20, 40, 60, 80, 100],
    // X — единственный платный источник: twitterapi.io берёт около $0.15
    // за тысячу постов. На бесплатном тарифе он окупаться не может.
    kinds: [...FREE_KINDS, "x"],
    // Свой ключ и своя модель — Pro: на них держится и цена дайджеста,
    // и возможность увести расход за пределы тарифа.
    sections: ["personalization", "calibration", "subscription"],
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

export const maxDigestOf = (plan: Plan) => plan.digestSizes[plan.digestSizes.length - 1];

export const allows = (plan: Plan, section: Gated) => plan.sections.includes(section);

/** «2 интереса», «5 интересов» — форма нужна и в отказе, и в заглушке. */
export function topicsWord(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return "интересов";
  const ones = n % 10;
  if (ones === 1) return "интерес";
  if (ones >= 2 && ones <= 4) return "интереса";
  return "интересов";
}

/** Самый дешёвый тариф, который открывает раздел. Для подписи в заглушке. */
export const cheapestWith = (section: Gated): Plan =>
  PLAN_IDS.map((id) => PLANS[id]).find((plan) => allows(plan, section)) ?? PLANS.pro;

/**
 * Кого опрашивать в этом прогоне.
 *
 * Порядок — по id: при понижении тарифа остаются те, что заведены раньше,
 * и набор не пляшет от прогона к прогону. Запрещённый вид отсекается до
 * предела по числу, иначе три ленты X на бесплатном тарифе съедали бы
 * места живых источников, ничего при этом не собирая.
 */
export function sourcesForPlan(sources: Source[], plan: Plan): Source[] {
  return sources
    .filter((source) => source.active && plan.kinds.includes(source.kind))
    .sort((a, b) => a.id - b.id)
    .slice(0, plan.maxSources);
}
