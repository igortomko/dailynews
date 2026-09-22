import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Обложка выпуска голосом: наша иллюстрация, своя на каждый день.
 *
 * Без обложки плеер Telegram рисует во весь экран серую ноту-заглушку —
 * она и есть первое, что видит открывший подкаст. Картинка стоит пятнадцати
 * килобайт и ни одного запроса.
 *
 * Берётся из готовых квадратов (`scripts/export-podcast-covers.mjs`), а не
 * собирается на лету: Telegram принимает только JPEG не больше 200 КБ
 * и не больше 320 по стороне, а иллюстрации лежат PNG на прозрачности
 * и любых пропорций. Складывать их в момент отправки значило бы тащить
 * `sharp` в прогон и в веб ради картинки, которая не меняется.
 *
 * День выбирает обложку по остатку, а не случайно: выпуск переотправляют,
 * догружают и пересобирают, и случайная картинка делала бы один и тот же
 * выпуск каждый раз другим. Новые иллюстрации просто ложатся в папку —
 * круг становится длиннее сам.
 */
const DIR = join(process.cwd(), "public", "brand", "podcast-covers");

// Список читается один раз: файлы меняются с развёртыванием, а не
// в работающем процессе, и `readdir` на каждую карточку озвучки — это
// поход в файловую систему ради ответа, который не изменится.
let listed: string[] | null = null;

const covers = (): string[] => {
  if (listed) return listed;
  try {
    listed = readdirSync(DIR).filter((name) => name.endsWith(".jpg")).sort();
  } catch {
    // Папки нет — значит, обложек нет. Ронять из-за этого отправку нельзя:
    // без картинки подкаст приходит, без подкаста — нет.
    listed = [];
  }
  return listed;
};

/** Обложка того дня, за который собран выпуск. Нет обложек — `null`. */
export function coverFor(day: string): Buffer | null {
  const list = covers();
  if (!list.length) return null;
  // Полдень, а не полночь: день выпуска — это день, а не момент, и полночь
  // по UTC в западном поясе уже вчера (та же причина, что в `formatDay`).
  const at = Date.parse(`${day}T12:00:00Z`);
  const index = Number.isNaN(at) ? 0 : Math.floor(at / 86_400_000) % list.length;
  try {
    return readFileSync(join(DIR, list[index]));
  } catch {
    return null;
  }
}

export const coverToday = (): Buffer | null =>
  coverFor(new Date().toISOString().slice(0, 10));

/** Только для проверок: сколько обложек в круге и как они называются. */
export const coverFiles = (): string[] => covers();
