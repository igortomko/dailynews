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

/**
 * Окно ленты: якорь плюс длина, а не «с какого по какое».
 *
 * Стрелки и календарь уже работают с одним днём как с якорем, окно растёт
 * назад от него — и режим «читаю по три дня» переживает переход к соседнему
 * дню сам собой. С парой `from`/`to` каждая стрелка двигала бы две границы,
 * и одна из них однажды уехала бы не туда.
 *
 * Семь дней — предел счёта за страницу, а не продуктовое решение: пять
 * выпусков по сорок карточек это впятеро больший HTML. Отсечка по времени
 * его прижимает, но заказ «всё» её не ставит.
 */
export const FEED_DAYS_MAX = 7;

/**
 * Сколько минут можно заказать. Список, а не любое число: кнопка показывает
 * выбранное, и значение, которого в меню нет, ей нечем назвать.
 */
export const FEED_MINUTES = [10, 20, 30] as const;

/** Первый день окна: якорь минус длина без единицы. Полдень UTC — день, а не момент. */
export function windowStart(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (Math.max(1, days) - 1));
  return date.toISOString().slice(0, 10);
}

/**
 * Окно и заказ из адреса. Умолчания (`days=1`, «всё время») в адрес
 * не пишутся и сюда приходят пропущенными.
 *
 * Повторённый параметр приезжает массивом — урок поиска: объявить его
 * строкой значит отдать массив в `Number` и получить NaN вместо ленты.
 */
export function feedWindow(params: {
  days?: string | string[];
  minutes?: string | string[];
}): { days: number; minutes: number | null } {
  const one = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const asked = Number(one(params.days));
  const minutes = Number(one(params.minutes));
  return {
    days: Number.isInteger(asked) ? Math.min(FEED_DAYS_MAX, Math.max(1, asked)) : 1,
    // Только из списка: адрес правят руками, и `minutes=1` отдал бы одну
    // карточку под кнопкой, которой нечего на себе написать.
    minutes: (FEED_MINUTES as readonly number[]).includes(minutes) ? minutes : null,
  };
}

/**
 * Адрес выпуска. Одна формула на стрелки, календарь, дропдаун минут
 * и на prefetch: вторая копия однажды забудет дописать `days`, и «следующий
 * день» молча выбросит из режима.
 */
export function feedHref(day: string, days = 1, minutes: number | null = null): string {
  const params = new URLSearchParams({ day });
  if (days > 1) params.set("days", String(days));
  if (minutes !== null) params.set("minutes", String(minutes));
  return `/?${params}`;
}
