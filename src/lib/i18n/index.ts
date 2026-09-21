import { en, type Dict } from "./en/index";
import { ru } from "./ru/index";
import { localeOf, type Locale } from "./locale";

export type { Dict };
export { LOCALES, LOCALE_LABELS, LOCALE_SHORT, DEFAULT_LOCALE, localeOf } from "./locale";
export type { Locale } from "./locale";

const DICTS: Record<Locale, Dict> = { en, ru };

/** Словарь по языку. Незнакомое значение уже прижато `localeOf`. */
export const dictOf = (locale: string | null | undefined): Dict => DICTS[localeOf(locale)];
