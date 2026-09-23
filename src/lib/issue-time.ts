/**
 * Когда читателю пора получить выпуск.
 *
 * Выпуск собирается в 02:00 по его поясу, а не в одно окно на всех:
 * общее окно по Сан-Паулу приходит москвичу к обеду, а токийцу вечером.
 * Сбор и оценка общие и идут своим расписанием (Actions, раз в час),
 * а письмо выпуска и так персональное — его время тоже.
 *
 * Два часа ночи, а не время пробуждения: к утру выпуск должен уже лежать,
 * а сборка с подкастом занимает до десяти минут. Своего времени читатель
 * не выбирает — только пояс.
 *
 * Без «server-only»: чистые функции, проверяются в `npm test`.
 */

/** Пояс по умолчанию: в нём выпуск приходил всем до того, как пояс стал личным. */
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/** Местный час, с которого выпуск этого дня можно собирать. */
export const ISSUE_HOUR = 2;

/**
 * Имя пояса, которое понимает `Intl`. Приходит из браузера и из формы,
 * то есть снаружи: неизвестное имя уронило бы `Intl.DateTimeFormat`
 * у таймера на каждом круге.
 */
export function isTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Пояс читателя; пустой или сломанный читается как умолчание, а не роняет таймер. */
export const timezoneOf = (timezone: string | null | undefined) =>
  isTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;

/** Местные дата (`YYYY-MM-DD`) и час в поясе. */
export function localClock(now: Date, timezone: string): { day: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map((part) => [part.type, part.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/**
 * Местный день, за который пора собирать выпуск, или null.
 *
 * Не «ровно в два», а «после двух и ещё не брали»: контейнер мог лежать
 * в два часа, и выпуск тогда приходит с его подъёмом, а не пропадает.
 */
export function dueDay(
  reader: { timezone: string | null; issue_day: string | null },
  now: Date,
): string | null {
  const { day, hour } = localClock(now, timezoneOf(reader.timezone));
  if (hour < ISSUE_HOUR) return null;
  // «Не раньше», а не «не равно»: сменивший пояс на западный оказывается
  // во вчерашнем дне, и выпуск за него он уже получил.
  return reader.issue_day !== null && reader.issue_day >= day ? null : day;
}
