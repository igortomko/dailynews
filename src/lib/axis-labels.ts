/**
 * Как ответы скоринга называются для читателя.
 *
 * В базе они лежат ключами (`fact`, `noise`, `other`), и показать их как есть
 * значит показать язык, на котором с моделью говорим мы. Словарь один на всё:
 * карточка новости и разбор попаданий берут отсюда же — две копии одного
 * перевода разъедутся тем тише, чем дольше их не сводить.
 */
export const KIND: Record<string, string> = {
  fact: "факт",
  forecast: "прогноз",
  opinion: "мнение",
  announcement: "анонс",
  reprint: "перепечатка",
};

export const HORIZON: Record<string, string> = {
  years: "годы",
  months: "месяцы",
  noise: "шум дня",
};

/**
 * Любое значение любой оси. `other` — это «ни одна тема не подошла»,
 * и встречается оно только в разборе попаданий.
 *
 * Незнакомый ключ возвращается как есть: выдуманный перевод врал бы тише,
 * чем английское слово, которое хотя бы видно.
 */
export const axisValue = (value: string): string => {
  if (Object.hasOwn(KIND, value)) return KIND[value];
  if (Object.hasOwn(HORIZON, value)) return HORIZON[value];
  return value === "other" ? "прочее" : value;
};
