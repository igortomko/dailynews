const MONTH = new Intl.DateTimeFormat("ru", { day: "numeric", month: "short" });

/**
 * «10ч» вместо «10 часов назад». В строке метаданных время стоит рядом
 * с источником и темой, и развёрнутая форма занимает там больше места,
 * чем несёт смысла: «назад» не добавляет ничего, а читается в каждой
 * карточке заново.
 */
export function relativeTime(value: string | Date): string {
  const then = typeof value === "string" ? new Date(`${value}${value.length === 10 ? "T12:00:00" : ""}`) : value;
  if (Number.isNaN(then.getTime())) return "";

  const minutes = Math.round((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return "сейчас";
  if (minutes < 60) return `${minutes}м`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}ч`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}д`;

  return MONTH.format(then);
}
