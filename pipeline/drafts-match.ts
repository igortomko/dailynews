/**
 * Какой опубликованный пост вырос из какого черновика. Чистые функции без
 * базы и сети: отчёт (`drafts-report.ts`) зовёт их на живых данных,
 * `npm test` — на выдуманных.
 */

/** Просмотры добираются около двух суток: моложе — сравнивать рано. */
export const MATURE_MS = 48 * 3600 * 1000;

/** Сколько общих слов делает пост «тем самым черновиком». */
export const MATCH_AT = 0.5;

const wordsOf = (text: string): Set<string> =>
  new Set(text.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]{3,}/gu) ?? []);

/**
 * Доля общих слов. Пост он правит и после копирования — прямо в Telegram,
 * — поэтому совпадение по тексту целиком не находит ничего; по словам
 * переписанный на треть пост остаётся тем же постом.
 */
export function overlap(a: string, b: string): number {
  const left = wordsOf(a);
  const right = wordsOf(b);
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const word of left) if (right.has(word)) common++;
  return common / Math.min(left.size, right.size);
}

/**
 * Какой опубликованный пост вырос из какого черновика. Пост берётся только
 * опубликованный позже, чем черновик взяли, и один пост — одному черновику:
 * иначе два черновика по одной новости делили бы одни просмотры.
 */
export function matchPublished<P extends { text: string; at: Date | null }>(
  drafts: { id: number; text: string; taken_at: Date }[],
  posts: P[],
): Map<number, P> {
  const found = new Map<number, P>();
  const used = new Set<P>();
  for (const draft of drafts) {
    let best: P | null = null;
    let score = MATCH_AT;
    for (const post of posts) {
      if (used.has(post) || (post.at && post.at < draft.taken_at)) continue;
      const value = overlap(draft.text, post.text);
      if (value >= score) {
        best = post;
        score = value;
      }
    }
    if (best) {
      found.set(draft.id, best);
      used.add(best);
    }
  }
  return found;
}

