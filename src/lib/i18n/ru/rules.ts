import { plural } from "@/lib/plural";
import type { rules as En } from "../en/rules";

/** Русский повторяет раскладку английского файл в файл. */
export const rules: typeof En = {
  follow: {
    label: "За чем следить",
    description: "Компании, продукты, люди. Упомянутое встанет первым в своей теме.",
    placeholder: "Figma, Framer, Webflow",
    limit: (max: number) => `Следить можно не больше чем за ${max}`,
  },
  exclude: {
    label: "Что исключать",
    description: "Имена, продукты, фразы. Упомянутое до тебя не дойдёт.",
    examples: [
      ["Илон Маск", "Илона Маска", "Илону Маску", "Elon Musk", "Musk"],
      ["Трамп", "Трампа", "Трампу", "Трампом", "Trump"],
      ["NFT"],
      ["мемкоин", "мемкоины", "мемкоинов", "memecoin", "memecoins"],
      ["спойлер", "спойлеры", "спойлеров", "spoiler", "spoilers"],
    ],
    placeholder: "Название компании, имя, фраза",
    limit: (max: number) => `Исключений может быть не больше ${max}`,
  },
  optional: "необязательно",
  counter: (n: number, limit: number) => `${n} из ${limit}`,
  add: "Добавить",
  remove: "Убрать",
  removeAria: (name: string) => `Убрать ${name}`,
  chipAria: (name: string, others: string[]) =>
    others.length > 0 ? `${name}, ещё ${others.length}: ${others.join(", ")}` : name,
  more: (n: number) => `+${n}`,
  variantsAria: (name: string) => `Другие написания для «${name}»`,
  variantsPlaceholder: "Другие написания через запятую: Фигма, figma.com",
  variantsHelp: (max: number) => `Ищется каждое написание, буквально. До ${max} на одно название`,
  limitReached: (max: number) => `Не больше ${max}. Убери одно, чтобы добавить другое`,
  tooLong: (name: string, max: number) => `«${name}…» длиннее ${max} знаков`,
  exists: (name: string) => `«${name}» уже есть`,
  existsElsewhere: (name: string) => `«${name}» уже есть в другом правиле`,
  tooManyVariants: (max: number) => `Не больше ${max} написаний на одно название`,
  examplesLabel: "Например",
  addExample: (name: string) => `Добавить ${name}`,
  hitsTitle: (n: number, days: number) =>
    `${n} ${plural(n, "упоминание", "упоминания", "упоминаний")} в твоих источниках за ${days} дней`,
  misses: (names: string[], days: number) =>
    `${names.map((n) => `«${n}»`).join(", ")}: ни разу за ${days} дней. Ищется по написанию — нажми на название и добавь другое.`,
  badList: "Список не разобрался — обнови страницу и попробуй ещё раз",
};
