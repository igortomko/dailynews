import { z } from "zod";

const text = z.string().trim().min(1).max(2400);
const ids = z.array(z.string().min(1).max(64)).min(1).max(80);
export const supported = z.object({ text, claimIds: ids }).strict();
const block = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("paragraph"), content: supported }).strict(),
  z.object({ kind: z.literal("list"), numbering: z.enum(["facts", "bullets"]), items: z.array(supported).min(2).max(6) }).strict(),
  z.object({ kind: z.literal("quote"), attribution: text.max(160), content: supported.extend({ text: text.max(500) }) }).strict(),
  z.object({ kind: z.literal("qa"), items: z.array(z.object({ question: supported, answer: supported }).strict()).min(1).max(3) }).strict(),
  z.object({ kind: z.literal("flow"), nodes: z.array(z.object({ value: text, label: text, claimIds: ids }).strict()).min(2).max(4), relations: z.array(z.enum(["earns", "equivalent", "leads_to", "follows"])).min(1).max(3) }).strict(),
  z.object({ kind: z.literal("comparison"), commonBasis: supported, emphasis: z.enum(["label", "content"]), items: z.array(z.object({ label: text, content: supported }).strict()).min(2).max(4) }).strict(),
  z.object({ kind: z.literal("metric"), value: text, label: text, context: supported }).strict(),
  // Ряд чисел — не тот же блок, что metric: одно число это герой карточки,
  // два-четыре — таблица результатов, и крупным кеглем они спорят друг
  // с другом. Замер на выпусках 21–22 сентября: у десяти карточек из
  // тридцати пяти было три и больше измеримых чисел, а показать их рядом
  // было нечем — они уходили в прозу поодиночке.
  z.object({ kind: z.literal("figures"), items: z.array(z.object({ value: text, label: text, claimIds: ids }).strict()).min(2).max(4), context: supported.nullable() }).strict(),
  // Разоблачение — обычный сюжет технической ленты: «обещали X, на деле Y».
  // Сравнением его не выразить: у сторон разный статус, а не общий базис.
  z.object({ kind: z.literal("correction"), claim: text, reality: supported }).strict(),
  // Матрица: несколько объектов, сравниваемых по нескольким числам.
  // Ни comparison (варианты по одному базису), ни figures (числа одного
  // результата) этого не выражают, и сравнение четырёх моделей по двум
  // бенчмаркам уходило в абзац, где числа читаются подряд и не сравниваются.
  z.object({ kind: z.literal("table"),
    columns: z.array(text.max(40)).min(2).max(4),
    rows: z.array(z.object({ label: text.max(60), cells: z.array(text.max(60)).min(2).max(4), claimIds: ids }).strict()).min(2).max(6),
    context: supported.nullable(),
  }).strict(),
  z.object({ kind: z.literal("steps"), sequence: z.enum(["procedure", "timeline"]), items: z.array(z.object({ label: text, content: supported, state: z.enum(["done", "current", "planned", "unspecified"]) }).strict()).min(2).max(6) }).strict(),
  z.object({ kind: z.literal("takeaway"), attribution: text, content: supported }).strict(),
]);
/**
 * Редакционная форма карточки. Она называется до письма, а не выводится
 * после: пока форма была необязательной опцией в конце промпта, её получали
 * семь карточек из тридцати пяти — при том что у десяти в тексте лежало
 * по три измеримых числа. Решение, принятое заранее и подкреплённое
 * утверждениями источника, проверяется кодом: документ, не совпавший
 * со своим планом, отправляется на переделку.
 */
export const editorialFormat = z.enum([
  "brief", "story", "bullets", "steps", "timeline", "data", "figures",
  "quote", "comparison", "mechanism", "qa", "correction", "table",
]);
export type EditorialFormat = z.infer<typeof editorialFormat>;
export const formatPlanSchema = z.object({
  format: editorialFormat,
  reason: z.string().trim().min(1).max(420),
  claimIds: ids,
  fallback: editorialFormat,
}).strict();
export const documentSchema = z.object({
  schemaVersion: z.literal(2),
  genre: z.enum(["news", "explanation", "research", "narrative", "argument", "investigation"]),
  title: supported.extend({ text: text.max(180) }),
  /**
   * Ответ на главный вопрос — первый слой карточки: его видно свёрнутым,
   * остальное раскрывается. Поле необязательное, потому что выпуски,
   * написанные до двухслойного чтения, лежат в базе и должны читаться:
   * у них первым слоем остаётся лид.
   */
  answer: supported.extend({ text: text.max(600) }).nullable().optional(),
  formatPlan: formatPlanSchema.optional(),
  lead: supported.nullable(),
  blocks: z.array(block).min(1).max(8),
  evidence: supported.nullable(),
  application: z.object({ text, condition: text, claimIds: ids, contextQuote: text }).strict().nullable(),
  omitted: z.array(z.object({ claimId: z.string(), reason: text }).strict()).max(160),
  baselineId: z.number().int().positive().nullable(),
}).strict();
export type ReadingDocument = z.infer<typeof documentSchema>;
export type ReadingBlock = ReadingDocument["blocks"][number];
/** Какой блок обязан появиться у формы, если она выбрана. */
export const formatBlock: Partial<Record<EditorialFormat, ReadingBlock["kind"]>> = {
  bullets: "list", steps: "steps", timeline: "steps", data: "metric", figures: "figures",
  quote: "quote", comparison: "comparison", mechanism: "flow", qa: "qa", correction: "correction",
  table: "table",
};
export type SourceAvailability = "article_text" | "feed_text" | "excerpt_only" | "derived_summary";
export type StoredReading = {
  version: 2;
  sourceVersion: string;
  availability: SourceAvailability;
  status: "verified" | "unavailable";
  document: ReadingDocument | null;
  notice: string | null;
  seconds: number;
};
export const claimSchema = z.object({
  id: z.string().min(1).max(64), text,
  importance: z.enum(["critical", "major", "detail"]),
  role: z.enum(["fact", "interpretation", "recommendation", "limitation"]),
  quote: text,
}).strict();
export const sectionSchema = z.object({
  subject: text,
  genre: documentSchema.shape.genre,
  claims: z.array(claimSchema).min(1).max(100),
  excluded: z.array(text).max(12),
}).strict();
export type AnalysisSection = z.infer<typeof sectionSchema> & { id: string; start: number; end: number };
export type ArticleAnalysis = { sections: AnalysisSection[]; sourceVersion: string; availability: SourceAvailability };
export const auditSchema = z.object({ defects: z.array(z.object({
  kind: z.enum(["contradiction", "unsupported", "missing_critical"]),
  issue: text,
  sourceEvidence: text,
  correction: text,
}).strict()).max(12) }).strict();
export const auditDefects = (result: z.infer<typeof auditSchema>) => result.defects.map(d => `${d.kind}: ${d.issue} Source: ${d.sourceEvidence} Required correction: ${d.correction}`);

export const isAccent = (b: ReadingBlock) => !["paragraph", "list", "qa"].includes(b.kind);
export const ACCENT_KINDS = ["flow", "comparison", "metric", "figures", "steps", "takeaway", "quote", "correction", "table"] as const;
export function supportedFields(doc: ReadingDocument): z.infer<typeof supported>[] {
  const values = [doc.title, ...(doc.answer ? [doc.answer] : []), ...(doc.lead ? [doc.lead] : [])];
  for (const b of doc.blocks) {
    switch (b.kind) {
      case "paragraph": case "takeaway": case "quote": values.push(b.content); break;
      case "list": values.push(...b.items); break;
      case "qa": values.push(...b.items.flatMap((q) => [q.question, q.answer])); break;
      case "flow": values.push(...b.nodes.map((n) => ({ text: `${n.value} ${n.label}`, claimIds: n.claimIds }))); break;
      case "comparison": values.push(b.commonBasis, ...b.items.map((i) => i.content)); break;
      case "metric": values.push(b.context); break;
      case "figures": values.push(...b.items.map((i) => ({ text: `${i.value} ${i.label}`, claimIds: i.claimIds })), ...(b.context ? [b.context] : [])); break;
      case "correction": values.push(b.reality); break;
      case "table": values.push(...b.rows.map((r) => ({ text: `${r.label} ${r.cells.join(" ")}`, claimIds: r.claimIds })), ...(b.context ? [b.context] : [])); break;
      case "steps": values.push(...b.items.map((i) => i.content)); break;
    }
  }
  if (doc.evidence) values.push(doc.evidence);
  if (doc.application) values.push(doc.application);
  return values;
}

export function normalizeDocument(doc: ReadingDocument): ReadingDocument {
  const visible = new Set(supportedFields(doc).flatMap(f => f.claimIds));
  return { ...doc, omitted: doc.omitted.filter(o => !visible.has(o.claimId)) };
}

/**
 * Обороты, которые ничего не сообщают и стоят строки.
 *
 * Запрет в промпте протекает — это уже проверено на словаре дайджеста
 * (`pipeline/lexicon.ts`), — поэтому самые частые ловятся счётчиком.
 * Список только русский и только из виденного в живых карточках: для
 * непроверенных языков перечня нет, там остаются принципы в промпте.
 * Общие слова вроде «в целом» сюда не идут: на них ложные срабатывания
 * дороже пользы.
 */
const EDGE = { before: "(?<![\\p{L}\\p{N}_])", after: "(?![\\p{L}\\p{N}_])" };
const FILLER = [
  "(?:стоит|следует|нельзя не|важно|необходимо)\\s+(?:отметить|понимать|заметить|подчеркнуть)",
  "как известно",
  "среди прочего",
  "в\\s+(?:статье|материале|публикации|тексте)\\s+(?:говорится|сказано|отмечается|рассказывается)",
  "автор\\s+(?:пишет|отмечает|рассказывает|утверждает),?\\s+(?:что|о)",
  "своего рода",
  // Граница слова здесь не `\b`: тот знает только латиницу, и «Стоит
  // отметить» не находился вовсе (урок `lexicon.ts` и `rules.ts`).
].map((body) => new RegExp(`${EDGE.before}${body}${EDGE.after}`, "giu"));
export const fillers = (text: string): string[] =>
  FILLER.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));

/**
 * Части карточки по порядку чтения. Одна сборка на проверку повторов
 * счётчиком и на вопрос к Jev: два списка разъехались бы, и дефект
 * указывал бы не на ту часть.
 */
export function layersOf(doc: ReadingDocument): { name: string; text: string; accent: boolean }[] {
  const opener = doc.answer ?? doc.lead;
  return [
    ...(opener ? [{ name: "answer", text: opener.text, accent: false }] : []),
    ...(doc.answer && doc.lead ? [{ name: "lead", text: doc.lead.text, accent: false }] : []),
    ...doc.blocks.map((b, at) => ({ name: `block ${at + 1} (${b.kind})`, text: blockText(b), accent: isAccent(b) })),
    ...(doc.evidence ? [{ name: "evidence", text: doc.evidence.text, accent: false }] : []),
  ];
}

export function validateCoverage(doc: ReadingDocument, analysis: ArticleAnalysis, context: string, baselineIds: number[]): string[] {
  const issues: string[] = [];
  const words = `${doc.title.text} ${documentText(doc)}`.split(/\s+/u).filter(Boolean).length;
  // Замер 22 сентября 2026 на тридцати карточках: при цели 80–140 и пределе
  // 220 медиана вышла 182 слова, треть карточек перевалила за 200. Модель
  // пишет по верхней границе, а не по цели, поэтому двигать надо границу.
  const limit = ["narrative", "argument", "investigation"].includes(doc.genre) ? 240 : 170;
  // Цель называется точной, а отказ наступает на десятую часть позже.
  // Лимит — редакционная мерка, а не обещание читателю: время выпуска
  // считается по написанному тексту. Сверенная карточка, выброшенная
  // за десять лишних слов, стоит читателю новости целиком — 21 сентября
  // так ушёл «AMD briefly joins the $1T club» (230 слов при 220).
  if (words > Math.round(limit * 1.1)) issues.push(`Summary is ${words} words; maximum ${limit}. Merge related facts, remove repeated claims and omit minor setup, biography, names and examples. Keep the main mechanism, result and evidence limits.`);
  // Первый слой карточки: у новых документов это answer, у написанных
  // до двухслойного чтения — лид. Требование к нему одно и то же, иначе
  // старые выпуски стали бы дефектными задним числом.
  const opener = doc.answer ?? doc.lead;
  if (!opener) {
    issues.push("Missing a 35–60 word answer that closes the article's central question before the details.");
  } else {
    const openerWords = opener.text.split(/\s+/u).filter(Boolean).length;
    if (openerWords < 35 || openerWords > 60) {
      issues.push(`The answer is ${openerWords} words; it must close the central question in 35–60 words before the details.`);
    }
  }
  if (doc.answer && doc.lead && normalize(doc.answer.text) === normalize(doc.lead.text)) {
    issues.push("The lead repeats the answer; it must add detail or be null.");
  }
  // Каждый слой добавляет своё. Проверяется кодом, потому что запрет
  // в промпте протекает: на карточке про Grok 4.7 лид обещал проверку работы
  // и цену, а абзацы ниже повторяли и то и другое.
  const layers = layersOf(doc);
  for (let i = 0; i < layers.length; i++) {
    for (let j = i + 1; j < layers.length; j++) {
      if (!restates(layers[i].text, layers[j].text)) continue;
      // Рецепт зависит от того, что с чем совпало. «Уберите повтор» модель
      // отрабатывала перестановкой слов, и карточка не собиралась вовсе:
      // на выпуске 22 сентября так и осталась прежней RoboHarm.
      const accent = layers[i].accent ? layers[i] : layers[j].accent ? layers[j] : null;
      const prose = accent === layers[i] ? layers[j] : layers[i];
      issues.push(accent
        ? `The ${accent.name} and the ${prose.name} carry the same figures. The form keeps the measured values; rewrite the ${prose.name} to state what changed and the condition that bounds it, naming no number the form already shows.`
        : `The ${layers[j].name} restates the ${layers[i].name}: same facts and numbers said twice. Keep one of them and spend the other on what the article says next, or drop it.`);
    }
  }
  const claims = analysis.sections.flatMap((s) => s.claims);
  const known = new Set(claims.map((c) => c.id));
  const visible = new Set(supportedFields(doc).flatMap((f) => f.claimIds));
  const omitted = new Set(doc.omitted.map((o) => o.claimId));
  if (doc.blocks.filter(isAccent).length > 1) issues.push("Use at most one visual accent; ordinary paragraphs are the default.");
  for (const id of [...visible, ...omitted]) if (!known.has(id)) issues.push(`Unknown claim ${id}`);
  for (const claim of claims) {
    if (claim.importance === "critical" && !visible.has(claim.id)) issues.push(`Missing critical claim ${claim.id}: ${claim.text}`);
    else if (!visible.has(claim.id) && !omitted.has(claim.id)) issues.push(`Account for claim ${claim.id} in text or omitted with a reason.`);
    if (visible.has(claim.id) && omitted.has(claim.id)) issues.push(`Claim ${claim.id} is both visible and omitted.`);
  }
  // План формы проверяется, а не принимается на слово: форма, названная
  // в плане и не собранная в документе, — это возврат к прозе под видом
  // решения. Запасная форма на то и запасная: не вышло — план называет её.
  if (doc.formatPlan) {
    for (const id of doc.formatPlan.claimIds) if (!known.has(id)) issues.push(`Unknown format-plan claim ${id}`);
    const required = formatBlock[doc.formatPlan.format];
    if (required && !doc.blocks.some((b) => b.kind === required)) {
      issues.push(`Format ${doc.formatPlan.format} requires a ${required} block. Build it from the cited claims, or set the plan to your fallback form and write that one.`);
    }
  }
  const padding = [...new Set(layers.flatMap((layer) => fillers(layer.text)))];
  if (padding.length) {
    issues.push(`Remove throat-clearing that carries no fact: ${padding.join(", ")}. Start the sentence at what happened.`);
  }
  if (doc.application && !normalize(context).includes(normalize(doc.application.contextQuote))) issues.push("Application must cite an exact relevant statement from the reader context, or be null.");
  if (doc.baselineId !== null && !baselineIds.includes(doc.baselineId)) issues.push("Unknown previous article.");
  for (const b of doc.blocks) if (b.kind === "flow" && b.relations.length !== b.nodes.length - 1) issues.push("One relation is required between adjacent flow nodes.");
  return issues;
}
export const normalize = (s: string) => s.replace(/\s+/gu, " ").trim();

/**
 * Говорят ли два куска одно и то же.
 *
 * Запрет «не повторяйся» в промпте протекает: на живой карточке про Grok 4.7
 * лид обещал «тщательнее себя проверяет» и «цена как у 4.6», а следующие
 * абзацы повторяли и проверку, и цену — 212 слов, из которых четверть
 * сказана дважды. Читатель видит это сразу, а модель — нет: каждое
 * предложение по отдельности верно и подкреплено источником.
 *
 * Мерка та же, что у пересказа заголовка (`repeatsHeadline`): доля общих
 * значимых слов, а повторённое число ужесточает порог. Число здесь весомее
 * слова — «46,3%» во второй раз не добавляет ничего и читается как сбой.
 */
export const RESTATE_MIN_WORDS = 6;
export function restates(first: string, second: string): boolean {
  // Слово режется до шести знаков: «разработчик» и «разработчика» — одно
  // и то же дважды, а морфологии здесь нет и не будет (урок `lexicon.ts`).
  const words = (text: string) => new Set(
    text.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/u)
      .filter((word) => word.length > 3).map((word) => word.slice(0, 6)));
  const numbers = (text: string) => new Set(
    (text.match(/\d[\d\s.,]*\d|\d/gu) ?? []).map((n) => n.replace(/\s/gu, "")).filter((n) => n.length > 1));
  const a = words(first), b = words(second);
  // На коротком куске мерка вырождается: у акцента из трёх слов любое
  // совпадение даёт единицу, и «46,3 балла» рядом с абзацем про баллы
  // объявлялось бы повтором. Такие куски судит промпт, а не счётчик.
  if (a.size < RESTATE_MIN_WORDS || b.size < RESTATE_MIN_WORDS) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  const overlap = shared / Math.min(a.size, b.size);
  const sharedNumber = [...numbers(first)].some((n) => numbers(second).has(n));
  return overlap > 0.5 || (sharedNumber && overlap > 0.3);
}
export function validateQuotes(doc: ReadingDocument, source: string): string[] {
  const issues: string[] = [];
  for (const b of doc.blocks) if (b.kind === "quote") {
    if (b.content.text.split(/\s+/u).length > 25) issues.push("A quotation must be at most 25 words.");
    if (!normalize(source).includes(normalize(b.content.text))) issues.push("A quotation must be an exact original-language excerpt from the source, not a translation or paraphrase.");
  }
  return issues;
}
/**
 * Сколько утверждений секции обязаны попасть в карточку. Замер на живом
 * выпуске 22 сентября 2026: при семи и меньше собрались все девятнадцать
 * карточек, при восьми и больше треть не собралась вовсе — «все critical
 * видимы» и «не длиннее 220 слов» несовместимы, когда обязательных
 * утверждений двадцать пять. Отказ выглядел как разовая осечка модели,
 * а был арифметикой.
 */
export const CRITICAL_PER_SECTION = 7;
/**
 * И сколько их может быть на всю статью. Потолок по секциям не спасает
 * многосекционную: две секции дают четырнадцать обязательных утверждений,
 * а карточке на сто семьдесят слов их не вместить — 22 сентября 2026 так
 * перестала собираться RoboHarm, хотя каждая секция потолок соблюдала.
 * «То, что читатель обязан помнить», не бывает четырнадцатью пунктами.
 */
export const CRITICAL_PER_DOCUMENT = 8;
export function validateSection(section: z.infer<typeof sectionSchema>, source: string): string[] {
  const errors: string[] = [];
  const critical = section.claims.filter((c) => c.importance === "critical").length;
  if (critical > CRITICAL_PER_SECTION) errors.push(`${critical} critical claims; at most ${CRITICAL_PER_SECTION} per section. Keep only what a reader MUST remember to retell the central finding or story; demote the rest to major or detail.`);
  if (new Set(section.claims.map((c) => c.id)).size !== section.claims.length) errors.push("Duplicate claim IDs");
  for (const c of section.claims) if (!normalize(source).includes(normalize(c.quote))) errors.push(`Quote for ${c.id} was not found: ${JSON.stringify(c.quote)}. Replace it with a SHORT exact substring (3-15 words) of the supplied source supporting this claim.`);
  return errors;
}

export const stepStateText = { planned: "предстоит", done: "завершён", current: "сейчас", unspecified: "" } as const;
export const relationText = { earns: "→", equivalent: "=", leads_to: "→", follows: "→" } as const;
export function blockText(b: ReadingBlock): string {
  switch (b.kind) {
    case "paragraph": return b.content.text;
    case "list": return b.items.map((i, at) => `${b.numbering === "facts" ? `${at + 1}.` : "•"} ${i.text}`).join("\n");
    case "qa": return b.items.map((i) => `${i.question.text}\n${i.answer.text}`).join("\n\n");
    case "flow": return b.nodes.map((n, i) => `${i ? `${relationText[b.relations[i - 1]]} ` : ""}${n.value} ${n.label}`).join(" ");
    case "comparison": return `${b.commonBasis.text}\n${b.items.map((i) => `${i.label}: ${i.content.text}`).join("\n")}`;
    case "metric": return `${b.value} ${b.label}\n${b.context.text}`;
    case "figures": return [b.items.map((i) => `${i.value} ${i.label}`).join(" · "), b.context?.text].filter(Boolean).join("\n");
    case "correction": return `${b.claim}\n${b.reality.text}`;
    case "table": return [b.columns.join(" · "), ...b.rows.map((r) => `${r.label}: ${r.cells.join(" · ")}`), b.context?.text].filter(Boolean).join("\n");
    case "steps": return b.items.map((i, at) => `${at + 1}. ${i.label}${stepStateText[i.state] ? ` (${stepStateText[i.state]})` : ""}: ${i.content.text}`).join("\n");
    case "takeaway": return `${b.content.text}\n${b.attribution}`;
    case "quote": return `“${b.content.text}”\n— ${b.attribution}`;
  }
}
export function documentText(doc: ReadingDocument): string {
  const details = doc.lead && doc.answer && normalize(doc.lead.text) === normalize(doc.answer.text) ? null : doc.lead?.text;
  return [doc.answer?.text, details, ...doc.blocks.map(blockText), doc.application && `${doc.application.condition} ${doc.application.text}`, doc.evidence?.text].filter(Boolean).join("\n\n");
}
/**
 * Документ чтения обычным текстом — ровно то же и в том же порядке, что
 * рисует карточка: оговорка, лид, блоки, вывод. Он ложится в
 * `digest_items.summary`, откуда его берут и письмо на читалку, и всё
 * остальное, чему нужен конспект строкой; три копии этой склейки
 * разошлись бы на первой правке любой из них.
 */
export const readingText = (reading: StoredReading): string =>
  [reading.notice, reading.document && documentText(reading.document)].filter(Boolean).join("\n\n");
/**
 * Абзац, которым конспект открывается, — описание материала одной мыслью.
 *
 * Не весь конспект: он написан на экран карточки, и десять конспектов
 * подряд не влезают даже в одно сообщение Telegram (4096 знаков), ради
 * которого обзор и собирают. Лида в документе может не быть — тогда
 * берётся первый обычный абзац, а если и его нет, первый блок: акцент
 * из одного числа хуже абзаца, но лучше пустого места.
 */
export const readingLead = (reading: StoredReading): string =>
  [reading.notice, reading.document && (reading.document.answer?.text ?? reading.document.lead?.text
    ?? blockText(reading.document.blocks.find((b) => b.kind === "paragraph") ?? reading.document.blocks[0]))]
    .filter(Boolean).join("\n\n");
export function parseStoredReading(value: unknown): StoredReading | null {
  const shape = z.object({
    version: z.literal(2), sourceVersion: z.string(),
    availability: z.enum(["article_text", "feed_text", "excerpt_only", "derived_summary"]),
    status: z.enum(["verified", "unavailable"]), document: documentSchema.nullable(),
    notice: z.string().nullable(), seconds: z.number().finite().nonnegative(),
  }).strict().safeParse(value);
  if (!shape.success || (shape.data.status === "verified" && !shape.data.document)) return null;
  return shape.data;
}
