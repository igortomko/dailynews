/**
 * На каком языке пишет автор — по его постам, без модели.
 *
 * Язык площадки раньше выбирался руками в карточке сети, и выбор жил
 * отдельно от того, как человек на самом деле пишет: «как в статье» стояло
 * у всех, кто не заметил список. Теперь язык определяется по его же постам
 * при подключении сети и при «Изучи мой стиль» и ложится в
 * `reader_channels.language`, откуда его читает промпт черновика.
 *
 * Определитель грубый намеренно: алфавит решает почти всё (кириллица,
 * кана, хангыль, иероглифы, арабица), а латиницу разводят частые служебные
 * слова и буквы с диакритикой. На корпусе постов одного автора этого
 * хватает с запасом; на одной фразе — нет, поэтому меньше двухсот букв
 * ответа не дают: промолчать честнее, чем угадать.
 *
 * Возвращает значение из `LANGUAGES` (`lib/voice.ts`) — ту же строку,
 * которая уходит в промпт.
 */
const MIN_LETTERS = 200;

const LATIN: { language: string; words: string[]; marks: RegExp }[] = [
  { language: "английском", words: ["the", "and", "is", "are", "of", "to", "that", "it", "for", "you", "with", "this", "not", "be", "was", "have", "what"], marks: /$^/ },
  { language: "португальском (бразильский)", words: ["não", "que", "com", "uma", "um", "para", "você", "os", "do", "da", "em", "mais", "isso", "como", "mas"], marks: /[ãõç]/g },
  { language: "испанском", words: ["el", "la", "que", "y", "los", "las", "es", "en", "por", "para", "una", "con", "no", "pero", "como", "lo"], marks: /[ñ¿¡]/g },
  { language: "немецком", words: ["der", "die", "das", "und", "ist", "nicht", "ein", "eine", "zu", "mit", "auf", "ich", "sie", "auch", "es"], marks: /[ßäöü]/g },
  { language: "французском", words: ["le", "la", "les", "et", "est", "pas", "un", "une", "des", "du", "que", "pour", "dans", "avec", "ce", "qui"], marks: /[éèêàùç]/g },
  { language: "итальянском", words: ["il", "che", "di", "è", "non", "per", "una", "gli", "della", "sono", "anche", "come", "questo"], marks: /[àèìòù]/g },
  { language: "нидерландском", words: ["de", "het", "een", "en", "niet", "van", "is", "dat", "op", "te", "zijn", "ik", "maar"], marks: /$^/ },
  { language: "польском", words: ["się", "nie", "jest", "że", "na", "do", "to", "jak", "ale", "co", "czy"], marks: /[ąęłśżźćń]/g },
  { language: "турецком", words: ["bir", "ve", "bu", "için", "ile", "çok", "ne", "da", "de", "ama", "gibi"], marks: /[şğı]/g },
];

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

export function detectLanguage(texts: string[]): string | null {
  const text = texts
    .join("\n")
    // Адреса, упоминания и теги — не язык автора: @handle латиницей
    // в русском посте склонял бы счёт к английскому.
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#][\p{L}\p{N}_]+/gu, " ")
    .toLowerCase();
  const letters = count(text, /\p{L}/gu);
  if (letters < MIN_LETTERS) return null;

  const scripts = {
    cyrillic: count(text, /\p{Script=Cyrillic}/gu),
    kana: count(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu),
    hangul: count(text, /\p{Script=Hangul}/gu),
    han: count(text, /\p{Script=Han}/gu),
    arabic: count(text, /\p{Script=Arabic}/gu),
    latin: count(text, /\p{Script=Latin}/gu),
  };
  const [script, n] = Object.entries(scripts).sort((a, b) => b[1] - a[1])[0];
  if (n / letters < 0.5) return null;

  if (script === "cyrillic") {
    // Украинский отличают буквы, которых нет в русском, и наоборот.
    return count(text, /[іїєґ]/g) > count(text, /[ыэъё]/g) ? "украинском" : "русском";
  }
  // Японский пишется вперемешку с иероглифами, поэтому кана проверяется
  // раньше них: хоть заметная доля каны — это уже японский, а не китайский.
  if (script === "kana" || (script === "han" && scripts.kana > n * 0.1)) return "японском";
  if (script === "han") return "китайском";
  if (script === "hangul") return "корейском";
  if (script === "arabic") return "арабском";

  const words = text.match(/\p{L}+/gu) ?? [];
  const scored = LATIN.map(({ language, words: common, marks }) => {
    const set = new Set(common);
    return { language, score: words.filter((word) => set.has(word)).length + count(text, marks) };
  }).sort((a, b) => b.score - a.score);
  // Меньше пяти попаданий на двести букв — это не язык, а список имён
  // и терминов: угадывать по нему незачем.
  return scored[0].score >= 5 ? scored[0].language : null;
}

/**
 * Язык каждой сети автора — по его постам.
 *
 * Сеть, чьи посты читаются (Telegram, X, блог), получает язык своих постов:
 * один и тот же человек пишет в X по-английски, а в канал по-русски.
 * LinkedIn и Threads наружу не отдают ничего — им достаётся язык автора
 * в целом, по всем постам и вставленным руками образцам. Не набралось
 * текста — язык не пишется вовсе: черновик тогда пишется «как в статье»,
 * а не на угаданном языке.
 */
export function languagesFor(networks: string[], posts: { text: string; where: string }[]): Record<string, string | null> {
  const overall = detectLanguage(posts.map((post) => post.text));
  return Object.fromEntries(
    networks.map((network) => [
      network,
      detectLanguage(posts.filter((post) => post.where === network).map((post) => post.text)) ?? overall,
    ]),
  );
}

