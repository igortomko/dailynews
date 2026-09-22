/**
 * День выпуска, как он пишется в адресе и в базе: `YYYY-MM-DD`.
 *
 * Проверяется до запроса, а не приведением в SQL: день приходит из адреса
 * непроверенным, и `'2026-02-31'::date` ронял бы страницу вместо того, чтобы
 * открыть последний выпуск. Проверка строгая — с нулями и по календарю:
 * `2026-9-1` в базе не лежит ни в каком виде, а `new Date("2026-02-31")`
 * молча дотягивает такую строку до ближайшей настоящей даты.
 *
 * Без «server-only»: чистая функция, проверяется в `npm test`.
 */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  // Год ставится отдельно: Date.UTC читает 0–99 как 1900–1999, и «0026-01-01»
  // не сходился бы с самим собой. В адресе ленты таких лет не бывает, но
  // функция обещает «любой день формы YYYY-MM-DD», а не «день после 1900».
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Локальная дата без часового пояса: «2026-09-19» — это день, а не момент. */
export const toDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
