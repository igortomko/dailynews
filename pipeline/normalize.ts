/** Параметры, которые меняются от источника к источнику, но не меняют страницу. */
const TRACKING = /^(utm_|ga_|mc_|pk_|hsa_|_hs|fbclid$|gclid$|gbraid$|wbraid$|yclid$|igshid$|mkt_tok$|ref$|ref_src$|source$|at_medium$|at_campaign$|spm$|cmpid$)/i;

/**
 * Канонический адрес: одна и та же новость, пришедшая с HN, из Reddit и по RSS,
 * должна свернуться в одну строку. Это первый и самый дешёвый слой дедупа.
 */
export function canonUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.trim().toLowerCase();
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.protocol = "https:";
  url.port = "";

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();

  // AMP-зеркала ведут на ту же статью.
  url.pathname = url.pathname.replace(/\/amp\/?$/, "/").replace(/\.amp$/, "");
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");

  return url.toString();
}

/** Стоп-слова, которые в заголовках несут ноль смысла и только мешают сравнению. */
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are",
  "how", "why", "what", "new", "your", "you", "it", "its", "as", "at", "by", "from",
  "и", "в", "на", "с", "по", "для", "как", "что", "это", "о", "от", "за", "не",
]);

/**
 * Нормализованный заголовок для нечёткого сравнения: без регистра, без пунктуации,
 * без стоп-слов, слова отсортированы. Перестановка слов перестаёт быть отличием,
 * а pg_trgm поверх этого ловит перепечатки с переписанным заголовком.
 */
export function normalizeTitle(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    // Точка внутри номера версии убирается до общей чистки пунктуации,
    // иначе «1.0a40» рассыпается на «1» и «0a40», а «0.65.5» — на «0», «65»
    // и «5», и два разных релиза сходятся к одному голому названию.
    .replace(/(\d)\.(?=\d)/g, "$1")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    // Односимвольные токены выбрасываются как мусор, но только буквенные:
    // в «GPT 5» и «GPT 6» вся разница именно в отброшенной цифре.
    .filter((word) => (word.length > 1 || /\d/.test(word)) && !STOP.has(word));

  return [...new Set(words)].sort().join(" ");
}
