/**
 * Строки личных правил отбора: «За чем следить» и «Что исключать».
 * Читают их src/components/name-rules.tsx и чистые функции в src/lib/rules.ts
 * (те берут словарь необязательным доводом, русский по умолчанию).
 * Английский задаёт форму, русский её повторяет.
 */
export const rules = {
  follow: {
    label: "What to follow",
    description: "Companies, products, people. Mentions go first within their topic.",
    placeholder: "Figma, Framer, Webflow",
    limit: (max: number) => `You can follow up to ${max}`,
  },
  exclude: {
    label: "What to exclude",
    description: "Names, products, phrases. Mentions won't reach you.",
    /** Нажатием, с формами слова: правило ищет буквально. */
    examples: [["Elon Musk", "Musk"], ["Trump"], ["NFT", "NFTs"], ["memecoin", "memecoins"], ["spoiler", "spoilers"]] as string[][],
    placeholder: "Company name, person, phrase",
    limit: (max: number) => `Up to ${max} exclusions`,
  },
  optional: "optional",
  counter: (n: number, limit: number) => `${n} of ${limit}`,
  add: "Add",
  remove: "Remove",
  removeAria: (name: string) => `Remove ${name}`,
  chipAria: (name: string, others: string[]) =>
    others.length > 0 ? `${name}, ${others.length} more: ${others.join(", ")}` : name,
  more: (n: number) => `+${n}`,
  variantsAria: (name: string) => `Other spellings for “${name}”`,
  variantsPlaceholder: "Other spellings, comma-separated: NodeJS, nodejs.org",
  variantsHelp: (max: number) => `Each spelling is matched literally. Up to ${max} per name`,
  limitReached: (max: number) => `No more than ${max}. Remove one to add another`,
  tooLong: (name: string, max: number) => `“${name}…” is longer than ${max} characters`,
  exists: (name: string) => `“${name}” is already there`,
  existsElsewhere: (name: string) => `“${name}” is already in another rule`,
  tooManyVariants: (max: number) => `No more than ${max} spellings per name`,
  examplesLabel: "For example",
  addExample: (name: string) => `Add ${name}`,
  hitsTitle: (n: number, days: number) => `${n} ${n === 1 ? "mention" : "mentions"} in your sources over ${days} days`,
  misses: (names: string[], days: number) =>
    `${names.map((n) => `“${n}”`).join(", ")}: not found once in ${days} days. Matched as written — tap the name to add another spelling.`,
  badList: "The list didn't parse — reload the page and try again",
};
