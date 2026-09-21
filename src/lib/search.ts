/**
 * Разбор поискового запроса и подсветка найденного.
 *
 * Чистые функции и без «server-only»: их зовёт серверная страница, а
 * проверяются они без базы и без сети — `npm test`.
 */

/**
 * Границы найденного внутри отрывка от `ts_headline`.
 *
 * Управляющие символы, а не `<b>`: отрывок собирается из описания и текста
 * статьи, и вставить туда разметку значит однажды отрисовать чужой
 * `<script>` как свой. Символы, которых в тексте не бывает, режутся
 * обратно на куски и уезжают в `<mark>` обычными строками.
 */
export const HL_START = "\u0001";
export const HL_END = "\u0002";

/**
 * Настройки отрывка. Два фрагмента, а не один: совпадение бывает и в начале
 * описания, и в конце, а показанное начало отвечает не на тот вопрос.
 *
 * Разделитель — многоточие, как и обрезанные края отрывка: штатные «...»
 * рядом с «…» по краям читаются как два разных пропуска. Пробелы вокруг
 * него Postgres всё равно срезает.
 */
export const HL_OPTIONS =
  `StartSel=${HL_START},StopSel=${HL_END},MaxFragments=2,MaxWords=28,MinWords=14,FragmentDelimiter=…`;

export type Part = { text: string; mark: boolean };

/** Отрывок, разложенный на обычный текст и найденное. */
export function highlight(text: string): Part[] {
  const parts: Part[] = [];
  let rest = text;
  while (rest.length > 0) {
    const open = rest.indexOf(HL_START);
    if (open === -1) {
      parts.push({ text: rest, mark: false });
      break;
    }
    if (open > 0) parts.push({ text: rest.slice(0, open), mark: false });
    const close = rest.indexOf(HL_END, open);
    // Незакрытая метка — это обрезанный отрывок. Остаток уходит обычным
    // текстом: подсветить «до конца строки» значит залить половину карточки.
    if (close === -1) {
      parts.push({ text: rest.slice(open + 1), mark: false });
      break;
    }
    parts.push({ text: rest.slice(open + 1, close), mark: true });
    rest = rest.slice(close + 1);
  }
  return parts;
}

/**
 * Тот же запрос, но «хотя бы одно слово», или null, если ослаблять нечего.
 *
 * Ищут вопросом, а не ключевыми словами: «где я видел про uranium
 * и дата-центры». Требование всех слов разом просит ровно того, чего
 * в тексте нет («видел»), и поиск отвечает «ничего не нашлось» на запрос,
 * ответ на который лежит в архиве. Поэтому вторым заходом слова связываются
 * через «или», а порядок выдачи сам поднимает наверх те материалы,
 * где сошлось больше слов.
 *
 * Слова соединяются оператором самого websearch, а не подменой «&» на «|»
 * в готовом tsquery: в запросе бывает «AT&T», и такая подмена ломает
 * не оператор, а само слово.
 */
export function anyOf(query: string): string | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.join(" or ") : null;
}
