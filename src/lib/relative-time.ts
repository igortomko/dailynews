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

/**
 * Знаков в минуту спокойного чтения. Замер по живому потоку: медиана
 * статьи — 7760 знаков, и шесть с половиной минут на неё правдоподобны
 * (около 1300 слов при двухстах в минуту). Число здесь, а не в разметке:
 * ползунок скорости чтения однажды понадобится, и искать его придётся
 * в одном месте.
 */
const CHARS_PER_MINUTE = 1200;

/**
 * Ниже этого текст — не статья, а анонс. «≈1 мин» о нём не говорит ничего,
 * зато выглядит как измеренное: догрузка уже отбрасывает всё короче ста
 * двадцати слов, и этот порог только чуть строже.
 */
const MIN_CHARS = 600;

/**
 * «≈6 мин» — сколько читать сам материал, а не наше описание.
 *
 * Показывается, только когда текст статьи у нас действительно есть: он
 * забирается догрузкой и лежит у 76 карточек из 200. Придумать время
 * по длине заголовка можно, но это было бы число, похожее на измеренное,
 * и проверить его читателю нечем до самого перехода по ссылке.
 *
 * Выше часа — в часах: «≈151 мин» читатель всё равно пересчитывает в уме,
 * а таких материалов в потоке три.
 */
export function readingTime(chars: number | null): string | null {
  if (chars === null || chars < MIN_CHARS) return null;
  const minutes = Math.max(1, Math.round(chars / CHARS_PER_MINUTE));
  return minutes < 60 ? `≈${minutes} мин` : `≈${Math.round(minutes / 60)} ч`;
}
