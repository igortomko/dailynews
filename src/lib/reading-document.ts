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
  z.object({ kind: z.literal("comparison"), commonBasis: supported, emphasis: z.enum(["label", "content"]), items: z.array(z.object({ label: text, content: supported }).strict()).length(2) }).strict(),
  z.object({ kind: z.literal("metric"), value: text, label: text, context: supported }).strict(),
  z.object({ kind: z.literal("steps"), sequence: z.enum(["procedure", "timeline"]), items: z.array(z.object({ label: text, content: supported, state: z.enum(["done", "current", "planned", "unspecified"]) }).strict()).min(2).max(6) }).strict(),
  z.object({ kind: z.literal("takeaway"), attribution: text, content: supported }).strict(),
]);
export const documentSchema = z.object({
  schemaVersion: z.literal(2),
  genre: z.enum(["news", "explanation", "research", "narrative", "argument", "investigation"]),
  title: supported.extend({ text: text.max(180) }),
  lead: supported.nullable(),
  blocks: z.array(block).min(1).max(8),
  evidence: supported.nullable(),
  application: z.object({ text, condition: text, claimIds: ids, contextQuote: text }).strict().nullable(),
  omitted: z.array(z.object({ claimId: z.string(), reason: text }).strict()).max(160),
  baselineId: z.number().int().positive().nullable(),
}).strict();
export type ReadingDocument = z.infer<typeof documentSchema>;
export type ReadingBlock = ReadingDocument["blocks"][number];
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
export function supportedFields(doc: ReadingDocument): z.infer<typeof supported>[] {
  const values = [doc.title, ...(doc.lead ? [doc.lead] : [])];
  for (const b of doc.blocks) {
    switch (b.kind) {
      case "paragraph": case "takeaway": case "quote": values.push(b.content); break;
      case "list": values.push(...b.items); break;
      case "qa": values.push(...b.items.flatMap((q) => [q.question, q.answer])); break;
      case "flow": values.push(...b.nodes.map((n) => ({ text: `${n.value} ${n.label}`, claimIds: n.claimIds }))); break;
      case "comparison": values.push(b.commonBasis, ...b.items.map((i) => i.content)); break;
      case "metric": values.push(b.context); break;
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

export function validateCoverage(doc: ReadingDocument, analysis: ArticleAnalysis, context: string, baselineIds: number[]): string[] {
  const issues: string[] = [];
  const words = `${doc.title.text} ${documentText(doc)}`.split(/\s+/u).filter(Boolean).length;
  const limit = ["narrative", "argument", "investigation"].includes(doc.genre) ? 320 : 220;
  if (words > limit) issues.push(`Summary is ${words} words; maximum ${limit}. Merge related facts, remove repeated claims and omit minor setup, biography, names and examples. Keep the main mechanism, result and evidence limits.`);
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
  if (doc.application && !normalize(context).includes(normalize(doc.application.contextQuote))) issues.push("Application must cite an exact relevant statement from the reader context, or be null.");
  if (doc.baselineId !== null && !baselineIds.includes(doc.baselineId)) issues.push("Unknown previous article.");
  for (const b of doc.blocks) if (b.kind === "flow" && b.relations.length !== b.nodes.length - 1) issues.push("One relation is required between adjacent flow nodes.");
  return issues;
}
export const normalize = (s: string) => s.replace(/\s+/gu, " ").trim();
export function validateQuotes(doc: ReadingDocument, source: string): string[] {
  const issues: string[] = [];
  for (const b of doc.blocks) if (b.kind === "quote") {
    if (b.content.text.split(/\s+/u).length > 25) issues.push("A quotation must be at most 25 words.");
    if (!normalize(source).includes(normalize(b.content.text))) issues.push("A quotation must be an exact original-language excerpt from the source, not a translation or paraphrase.");
  }
  return issues;
}
export function validateSection(section: z.infer<typeof sectionSchema>, source: string): string[] {
  const errors: string[] = [];
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
    case "steps": return b.items.map((i, at) => `${at + 1}. ${i.label}${stepStateText[i.state] ? ` (${stepStateText[i.state]})` : ""}: ${i.content.text}`).join("\n");
    case "takeaway": return `${b.content.text}\n${b.attribution}`;
    case "quote": return `“${b.content.text}”\n— ${b.attribution}`;
  }
}
export function documentText(doc: ReadingDocument): string {
  return [doc.lead?.text, ...doc.blocks.map(blockText), doc.application && `${doc.application.condition} ${doc.application.text}`, doc.evidence?.text].filter(Boolean).join("\n\n");
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
  [reading.notice, reading.document && (reading.document.lead?.text
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
