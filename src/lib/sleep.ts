import type { Reader } from "./types";

/**
 * Спящий читатель.
 *
 * Выпуск пишется каждую ночь и каждую ночь стоит денег. Читатель, который
 * две недели не открывал ленту, платит за них нашими — а вернуть его
 * дешевле одним вопросом, чем продолжать писать в пустоту.
 *
 * Пауза ставится сама и снимается чем угодно: кнопкой в боте или первым же
 * заходом на сайт. Спросить и не дать простого «да» — значит потерять
 * читателя на ровном месте.
 */
export const SLEEP_DAYS = 14;

export type SleepVerdict =
  /** Выпуск пишется как обычно. */
  | { verdict: "run" }
  /** Пора спросить: выпуск не пишется, в бот уходит вопрос. */
  | { verdict: "ask"; silentDays: number }
  /** Уже спросили, ответа нет: молчим до возвращения. */
  | { verdict: "paused" };

/**
 * Отсчёт идёт от последнего события чтения, а если их нет вовсе —
 * от онбординга: у нового читателя ещё не было случая что-то открыть,
 * и пауза на второй день выглядела бы поломкой.
 *
 * Событие любое, включая показ: карточка отмечается показанной только
 * при заходе на сайт, и это уже признак живого читателя.
 */
export function sleepVerdict(
  reader: Pick<Reader, "paused_at" | "onboarded_at">,
  lastActivityAt: string | Date | null,
  now: Date = new Date(),
): SleepVerdict {
  if (reader.paused_at) return { verdict: "paused" };

  const since = lastActivityAt ?? reader.onboarded_at;
  // Ни активности, ни онбординга — читатель заведён только что, и мерить
  // нечего: молчание без начала отсчёта не значит ничего.
  if (!since) return { verdict: "run" };

  const days = (now.getTime() - new Date(since).getTime()) / 86_400_000;
  if (days < SLEEP_DAYS) return { verdict: "run" };
  return { verdict: "ask", silentDays: Math.floor(days) };
}
