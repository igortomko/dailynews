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
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
