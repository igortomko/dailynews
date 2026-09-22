import { en, type Dict } from "./en/index";
import { ru } from "./ru/index";
import { localeOf, type Locale } from "./locale";
import { cheapestFor, type FeatureId } from "../plans";

export type { Dict };
export { LOCALES, LOCALE_LABELS, DEFAULT_LOCALE, localeOf } from "./locale";
export type { Locale } from "./locale";

const DICTS: Record<Locale, Dict> = { en, ru };

/** Словарь по языку. Незнакомое значение уже прижато `localeOf`. */
export const dictOf = (locale: string | null | undefined): Dict => DICTS[localeOf(locale)];

/**
 * Описание возможности для окна оплаты и таблицы тарифов.
 *
 * У озвучки оно зависит от квоты, и квота живёт в `plans.ts` — числом
 * в тексте словаря она разъехалась бы с настоящим пределом молча, ровно
 * как это уже случилось с «45 минут» в двух словарях сразу. Остальные
 * описания чисел не содержат и приходят строкой.
 */
export function featureWhat(t: Dict, id: FeatureId): string {
  const what = t.plans.feature[id].what;
  if (typeof what !== "function") return what;
  return what(Math.floor(cheapestFor(id).audioSecondsPerDay / 60));
}
