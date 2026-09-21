import "server-only";
import { currentReader } from "@/lib/session";
import { dictOf, localeOf, DEFAULT_LOCALE, type Dict, type Locale } from "./index";

/**
 * Язык и словарь для серверных компонентов.
 *
 * Берётся у читателя, а не из заголовка браузера: `Accept-Language` говорит,
 * на чём читатель говорит, а колонка — что он выбрал. Первое подсказывает
 * значение по умолчанию при заведении, второе решает, и путать их значит
 * переключать интерфейс под человеком при заходе с чужого компьютера.
 *
 * `currentReader` обёрнут в `cache()`, поэтому лишнего запроса здесь нет:
 * страница и раскладка спрашивают ту же строку.
 */
export async function currentLocale(): Promise<Locale> {
  return localeOf((await currentReader()).ui_language);
}

export async function getDict(): Promise<Dict> {
  return dictOf((await currentReader()).ui_language);
}

/**
 * Язык для экрана входа — единственного, где currentLocale()/getDict()
 * не работают: оба спрашивают currentReader(), а тот на этом экране сам
 * уводит на /login — вход не может спросить у входа. Читателя ещё нет,
 * и спросить некого, поэтому язык не читается, а фиксирован: английский,
 * тот же DEFAULT_LOCALE, что и всюду, где выбор неизвестен.
 */
export function loginLocale(): Locale {
  return DEFAULT_LOCALE;
}
