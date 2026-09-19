/**
 * Русское склонение после числа.
 *
 * «1 материалов» — не опечатка, а признак того, что число подставили
 * в готовую строку. Читается как машинный текст, и чинится это один раз
 * и в одном месте, а не в каждом месте, где появилось число.
 *
 * Формы в том же порядке, в каком их называют: 1 материал, 2 материала,
 * 5 материалов.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const tens = Math.abs(n) % 100;
  if (tens >= 11 && tens <= 14) return many;
  const ones = tens % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

/** «12 материалов» — число и форма вместе: порознь они разъезжаются. */
export const count = (n: number, one: string, few: string, many: string) =>
  `${n} ${plural(n, one, few, many)}`;
