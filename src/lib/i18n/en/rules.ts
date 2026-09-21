/**
 * Строки личных правил отбора: «За чем следить» и «Что исключать».
 * Читают их src/components/name-rules.tsx и чистые функции в src/lib/rules.ts
 * (те берут словарь необязательным доводом, русский по умолчанию).
 * Английский задаёт форму, русский её повторяет.
 */
export const rules = {
  follow: {
    label: "What to follow",
    description:
      "Companies, products, people. Mentions go first within their topic — inside the digest, not on top of it. Matched as written: “Node.js” won't find “NodeJS”, add both.",
    placeholder: "Figma, Framer, Webflow",
    limit: (max: number) => `You can follow up to ${max}`,
  },
  exclude: {
    label: "What to exclude",
    description:
      "Names, products, phrases. Mentions won't make the digest and are hidden from the one already written. Also as written, no translation.",
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
  badList: "The list didn't parse — reload the page and try again",
};
