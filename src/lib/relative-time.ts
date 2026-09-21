import type { Dict } from "@/lib/i18n";

export type TimeLabels = Dict["feed"]["time"];

/**
 * «21 сентября 2026 г.» из «2026-09-21» на языке читателя. Полдень,
 * а не полночь: день выпуска — это день, а не момент, и полночь по UTC
 * в западном поясе уже вчера. Одна функция на шапку ленты и на обзор —
 * дата выпуска в двух местах обязана читаться одинаково.
 */
export const formatDay = (day: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${day}T12:00:00`),
  );

/**
 * «10ч» вместо «10 часов назад». В строке метаданных время стоит рядом
 * с источником и темой, и развёрнутая форма занимает там больше места,
 * чем несёт смысла: «назад» не добавляет ничего, а читается в каждой
 * карточке заново.
 *
 * Словарь обязателен, и это не придирка к сигнатуре. Русский по умолчанию
 * прожил ровно до первого английского читателя: забытый аргумент отдавал
 * «10ч» посреди английского интерфейса — ни ошибки, ни предупреждения,
 * заметить нечем иначе как глазами на проде. Обязательный параметр
 * переносит это в сборку, где такую забывчивость видно бесплатно.
 */
export function relativeTime(value: string | Date, t: TimeLabels): string {
  const then = typeof value === "string" ? new Date(`${value}${value.length === 10 ? "T12:00:00" : ""}`) : value;
  if (Number.isNaN(then.getTime())) return "";

  const minutes = Math.round((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return t.now;
  if (minutes < 60) return t.minutesAgo(minutes);

  const hours = Math.round(minutes / 60);
  if (hours < 24) return t.hoursAgo(hours);

  const days = Math.round(hours / 24);
  if (days < 7) return t.daysAgo(days);

  return t.monthDay(then);
}
