/**
 * Транслитерация названия темы в slug: он уходит в Jev как имя варианта
 * choice и остаётся в оценках уже собранного, поэтому переименование темы
 * его не трогает.
 *
 * Лежит отдельно от actions.ts, чтобы проверяться тестами: тот файл помечен
 * "use server" и тянет next/headers и подключение к базе прямо на загрузке.
 */
/** Транслитерация в slug: он уходит в Jev как имя варианта choice. */
export function toSlug(label: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e",
    ю: "yu", я: "ya", ь: "", ъ: "",
  };
  return label
    .toLowerCase()
    .split("")
    .map((char) => map[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "topic";
}
