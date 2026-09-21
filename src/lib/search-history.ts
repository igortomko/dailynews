/**
 * Недавние запросы: где лежат и как считаются.
 *
 * История поиска живёт в браузере, а не в базе. Что человеку прислали —
 * это лента, а что он искал — первое по-настоящему личное, что пришлось бы
 * завести на сервере; ради пяти строк, полезных в одном браузере, это
 * плохой размен, а в общей базе тем более.
 *
 * Чистые функции и отдельный файл, а не половина компонента: их проверяет
 * `npm test`, а он не должен тянуть за собой ни React, ни Next ради разбора
 * строки.
 */

/** Ключ хранилища. Имя продукта в нём — чтобы соседи по домену не мешали. */
export const HISTORY_KEY = "reporta:searches";

/** Сколько подсказок помещается в строку под полем. */
export const HISTORY_MAX = 5;

/**
 * Что лежит в хранилище, знает не наш код: ключ переживает наши правки,
 * его пишет соседняя вкладка другой версии и правит кто угодно из консоли.
 * Поэтому разбор ничего не обещает и на любую неожиданность отвечает
 * пустой историей, а не исключением посреди отрисовки шапки.
 *
 * Повторы убираются здесь, а не только при записи: строка рисуется списком,
 * и два одинаковых запроса — это два одинаковых ключа React и одна и та же
 * подсказка дважды.
 */
export function recentFrom(raw: string | null): string[] {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    return list
      .filter((item): item is string => typeof item === "string")
      .filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

/**
 * Список после нового запроса: свежий первым, повтор не удваивается,
 * длина не растёт.
 *
 * Регистр не считается различием: «Uranium» следом за «uranium» — это один
 * и тот же поиск, и две подсказки вместо одной съедают место, ничего
 * не добавляя.
 */
export function remember(list: string[], query: string): string[] {
  const text = query.trim();
  if (!text) return list;
  const rest = list.filter((old) => old.toLowerCase() !== text.toLowerCase());
  return [text, ...rest].slice(0, HISTORY_MAX);
}
