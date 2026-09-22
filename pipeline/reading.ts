import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Sql } from "postgres";
import { resolve, type Survivor, type Usage, type Written, type DigestResult } from "./digest";
import { llmCost } from "./cost";
import { fetchArticle } from "./article";
import { articleHtml, videoIdOf } from "./youtube";
import { pooled, stripHtml } from "./fetch";
import { minutesOf, cardChars } from "../src/lib/reading-time";
import { styleOf, type Voice } from "../src/lib/voice";
import { asNames, compile, mentionText } from "../src/lib/rules";
import {
  documentSchema, sectionSchema, claimSchema, auditSchema, auditDefects, validateCoverage, validateSection,
  documentText, readingText, parseStoredReading, normalizeDocument, validateQuotes,
  type ArticleAnalysis, type StoredReading, type SourceAvailability, type ReadingDocument,
} from "../src/lib/reading-document";
import { READING_VERSION, SOURCE_RULES, EXTRACT_RULES, COMPOSE_RULES, VERIFY_RULES } from "./reading-prompts";
import { acquireAnalysis, finishAnalysis, getDocument, saveDocument, reserveCall, settleCall, recentBaselines, ReadingBudgetError, ReadingBusyError, type Baseline } from "./reading-store";

export type ReadingOptions = { readerId: number; force?: boolean };
export type Ask = <T>(phase: string, rules: string, data: unknown, schema: z.ZodType<T>) => Promise<T>;
export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const emptyUsage = (): Usage => ({ input: 0, output: 0, cached: 0, reasoning: 0, requests: 0 });
const OUTPUT_TOKENS = 12_000;
const DEFAULT_REASONING_PROFILE = "extract:none;edit+audit:low";

const phaseBase = (phase: string) => phase.replace(/-(?:format-)?repair$/u, "");
const phaseSettings = () => new Map(
  (process.env.READING_REASONING_PHASES ?? "").split(";")
    .map((part) => part.trim().split(":", 2))
    .filter(([phase, effort]) => phase && effort)
    .map(([phase, effort]) => [phase, effort]),
);

/** Exact phase settings make a cost experiment reproducible without changing production defaults. */
export function reasoningEffortFor(phase: string): string {
  const configured = phaseSettings();
  const base = phaseBase(phase);
  const mapped = configured.get(phase) ?? configured.get(base)
    ?? (base === "compose" ? configured.get("compose") : undefined)
    ?? (base === "extract" ? configured.get("extract") : undefined)
    ?? (base === "source-audit" || base === "verify" ? configured.get("audit") : undefined);
  if (mapped) return mapped;
  const override = process.env.READING_REASONING_EFFORT?.trim();
  if (override) return override;
  return base === "extract" ? "none" : "low";
}

export function readingReasoningProfile(): string {
  return process.env.READING_REASONING_PHASES?.trim()
    || process.env.READING_REASONING_EFFORT?.trim()
    || DEFAULT_REASONING_PROFILE;
}
export const MAX_SOURCE_CHARS = 160_000;

export function splitSource(text: string, limit = 12_000): { id: string; start: number; end: number; text: string }[] {
  if (text.length > MAX_SOURCE_CHARS) throw new Error("Source exceeds processing limit; no partial summary is published");
  const parts: ReturnType<typeof splitSource> = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(at + limit, text.length);
    if (end < text.length) {
      const breakAt = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(". ", end));
      if (breakAt > at + limit / 2) end = breakAt + 1;
      if (/[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
    }
    parts.push({ id: `s${parts.length + 1}`, start: at, end, text: text.slice(at, end) });
    at = end;
  }
  return parts;
}

function caller(sql: Sql, readerId: number, usage: Usage): Ask {
  const request = async <T>(phase: string, rules: string, data: unknown, schema: z.ZodType<T>): Promise<string> => {
    const { apiKey, baseUrl, model } = resolve();
    const reasoningEffort = reasoningEffortFor(phase);
    if (!apiKey) throw new Error("No model key");
    const outputTokens = reasoningEffort && reasoningEffort !== "none" ? 32000 : OUTPUT_TOKENS;
    const messages = [
      { role: "system", content: `${rules}\nJSON SCHEMA:\n${JSON.stringify(z.toJSONSchema(schema))}` },
      { role: "user", content: JSON.stringify(data) },
    ];
    // UTF-8 bytes conservatively bound input tokens, including non-Latin text.
    const reservation = llmCost({ ...emptyUsage(), input: Buffer.byteLength(JSON.stringify(messages), 'utf8') + 1024, output: outputTokens });
    const id = await reserveCall(sql, readerId, reservation, phase, model);
    const started = Date.now();
    let measured: Usage | null = null;
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: outputTokens, response_format: { type: "json_object" },
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}), messages }),
        signal: AbortSignal.timeout(150_000),
      });
      if (!response.ok) throw new Error(`Reading model HTTP ${response.status}`);
      const payload = await response.json();
      const u = payload.usage;
      if (u && Number.isFinite(u.prompt_tokens) && Number.isFinite(u.completion_tokens)) {
        measured = { input: u.prompt_tokens, output: u.completion_tokens,
          cached: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0,
          reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0, requests: 1 };
        for (const key of Object.keys(usage) as (keyof Usage)[]) usage[key] += measured[key];
      }
      if (payload.choices?.[0]?.finish_reason === "length") throw new Error("Reading response truncated");
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("Empty reading response");
      if (process.env.READING_TRACE_DIR) {
        mkdirSync(process.env.READING_TRACE_DIR, { recursive: true, mode: 0o700 });
        writeFileSync(`${process.env.READING_TRACE_DIR}/${Date.now()}-${phase}-${randomUUID()}.json`, JSON.stringify({ phase, data, content, usage: measured }), { mode: 0o600 });
      }
      return content;
    } finally {
      // A paid malformed response still counts; an uncertain transport failure retains the reserved cost.
      await settleCall(sql, readerId, id, measured, measured ? llmCost(measured) : null, Date.now() - started);
    }
  };
  return async <T>(phase: string, rules: string, data: unknown, schema: z.ZodType<T>): Promise<T> => {
    const parse = (content: string) => schema.parse(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()));
    const content = await request(phase, rules, data, schema);
    try { return parse(content); }
    catch (error) {
      if (!(error instanceof z.ZodError || error instanceof SyntaxError)) throw error;
      const repaired = await request(`${phase}-format-repair`, rules, { originalInput: data, invalidOutput: content,
        formatErrors: error instanceof z.ZodError ? error.issues : error.message,
        instruction: "Fix JSON/schema only. Preserve source meaning and supported facts. Return only valid JSON matching the schema." }, schema);
      return parse(repaired);
    }
  };
}

const extractionSchema = sectionSchema.extend({ claims: z.array(claimSchema.omit({ quote: true }).extend({ sourceSpan: z.number().int().positive() })).min(1).max(100) });

export async function analyzeSource(ask: Ask, source: string, title: string, sourceVersion: string, availability: SourceAvailability): Promise<ArticleAnalysis> {
  const sections: ArticleAnalysis['sections'] = [];
  for (const part of splitSource(source)) {
    const spans = splitSource(part.text, 1600).map((span, at) => ({ id: at + 1, text: span.text }));
    const input = { title, section: { id: part.id, start: part.start, end: part.end, spans }, availability };
    const materialize = (raw: z.infer<typeof extractionSchema>) => ({ ...raw, claims: raw.claims.map(({ sourceSpan, ...claim }) => ({ ...claim, quote: spans[sourceSpan - 1]?.text ?? "" })) });
    let raw = await ask("extract", EXTRACT_RULES, input, extractionSchema);
    let extracted = materialize(raw);
    const check = async () => {
      const errors = raw.claims.filter(c => !spans[c.sourceSpan - 1]).map(c => `Claim ${c.id} must reference an existing sourceSpan between 1 and ${spans.length}.`);
      errors.push(...validateSection(extracted, part.text));
      if (!errors.length) errors.push(...auditDefects(await ask("source-audit", VERIFY_RULES, { ...input, analysis: raw }, auditSchema)));
      return errors;
    };
    let errors = await check();
    if (errors.length) {
      raw = await ask("extract-repair", EXTRACT_RULES, { ...input, previous: raw, defects: errors }, extractionSchema);
      extracted = materialize(raw);
      errors = await check();
      if (errors.length) throw new Error(`Source analysis failed verification: ${errors[0]}`);
    }
    sections.push({ ...extracted, id: part.id, start: part.start, end: part.end,
      claims: extracted.claims.map((c) => ({ ...c, id: `${part.id}-${c.id}` })) });
  }
  if (!sections.length) throw new Error("Source has no content");
  return { sections, sourceVersion, availability };
}

/**
 * Карточки выпуска читают сверху: у первых форма (число с базой, сравнение,
 * цепочка, последовательность) решает, поймёт ли читатель новость взглядом.
 * Поэтому prominence уходит в промпт и в ключ кэша — иначе карточка,
 * поднявшаяся назавтра в начало выпуска, осталась бы написанной как рядовая.
 */
export type Prominence = "lead" | "regular";
export const LEAD_CARDS = 5;

/**
 * Сколько верхних карточек выпуска получают разбор. Остальные пишутся
 * обычным описанием.
 *
 * Ручка цены, поэтому переменной: карточка с разбором стоит в 55–70 раз
 * дороже обычной (замер 22 сентября 2026, `docs/economics.md`), и сколько
 * их себе позволить — это решение про тариф, а не про код. Ноль означал бы
 * «разбора нет вовсе», и такое выключение делается флагом читателя,
 * а не этим числом, — поэтому меньше единицы оно не опускается.
 */
export function readingCards(): number {
  const asked = Math.trunc(Number(process.env.READING_CARDS));
  // Ноль и минус читаются как «не задано», а не как «одна карточка»:
  // поставивший ноль хотел выключить разбор, а выключается он флагом
  // читателя. Молча оставить ему одну карточку с разбором значило бы
  // сделать не то, о чём просили, и не сказать об этом.
  return Number.isFinite(asked) && asked >= 1 ? asked : LEAD_CARDS;
}
export async function composeDocument(ask: Ask, source: string, analysis: ArticleAnalysis, readerContext: string, voice: Voice, topic: string, baselines: Baseline[], prominence: Prominence = "regular"): Promise<ReadingDocument> {
  const input = {
    language: voice.language, style: styleOf(voice.style).instruction,
    complexityPreference: voice.complexity,
    complexityMeaning: "1 = simple short phrases; 5 = concise technical writing WHERE knowledge is explicitly known. Unknown subtopics need brief explanations at any level.",
    readerContext, topic, prominence,
    quoteCandidates: analysis.sections.flatMap(section => section.claims)
      .filter(claim => claim.role === "interpretation" || claim.role === "recommendation")
      .flatMap(claim => claim.quote.split(/(?<=[.!?])\s+/u).filter(sentence => {
        const words = sentence.trim().split(/\s+/u).length;
        return words >= 4 && words <= 25;
      }).map(sentence => ({ text: sentence.trim(), claimIds: [claim.id] }))).slice(-8),
    analysis: { ...analysis, sections: analysis.sections.map(section => ({ ...section,
      claims: section.claims.map(({ quote, ...claim }) => { void quote; return claim; }) })) },
    candidateBaselines: baselines,
  };
  const check = async (doc: ReadingDocument) => {
    const errors = [...validateCoverage(doc, analysis, readerContext, baselines.map((b) => b.id)), ...validateQuotes(doc, source)];
    if (errors.length) return errors;
    for (const section of splitSource(source)) {
      const result = await ask("verify", VERIFY_RULES, { ...input, sourceSection: section, document: doc }, auditSchema);
      errors.push(...auditDefects(result));
    }
    return errors;
  };
  let doc = normalizeDocument(await ask("compose", COMPOSE_RULES, input, documentSchema));
  let errors = await check(doc);
  if (errors.length) {
    doc = normalizeDocument(await ask("compose-repair", `${COMPOSE_RULES}
REPAIR: rewrite from scratch to 120–160 visible words (up to 260 for narratives). Do not just append missing content. Merge related facts and keep minor details omitted. Fix only real defects; do not reintroduce every previously omitted major/detail claim.`, { ...input, previous: doc, defects: errors }, documentSchema));
    errors = await check(doc);
    if (errors.length && errors.every((error) => /^Summary is \d+ words/u.test(error))) {
      doc = normalizeDocument(await ask("compose-length-repair", `${COMPOSE_RULES}
LENGTH REPAIR: the previous document exceeded the hard word limit. Rewrite it once more under the limit, counting the title, lead, evidence, application and every block. Preserve the central answer, mechanism, direction, evidence limit and all critical claims; remove repetition and minor setup. Do not add facts.`, { ...input, previous: doc, defects: errors }, documentSchema));
      errors = await check(doc);
    }
    if (errors.length) {
      doc = normalizeDocument(await ask("compose-final-repair", `${COMPOSE_RULES}
FINAL REPAIR: the previous rewrite still has the listed material defects. Rewrite the whole document once. Keep it under the hard word limit, counting the title, lead, evidence, application and every block. Restore every missing critical conclusion, mechanism, scope or limit; remove secondary setup before removing an essential claim. Fix unsupported or contradictory claims instead of repeating them. Do not add facts.`, { ...input, previous: doc, defects: errors }, documentSchema));
      errors = await check(doc);
      if (errors.some((error) => /^Summary is \d+ words/u.test(error))) {
        doc = normalizeDocument(await ask("compose-compact-repair", `${COMPOSE_RULES}
COMPACT REPAIR: the document is still over the hard word limit. Keep the lead's answer and every critical conclusion, mechanism, direction, evidence limit and application that changes a decision. Remove secondary examples, setup and repeated wording until the title, lead and all blocks fit the limit. Do not add facts.`, { ...input, previous: doc, defects: errors }, documentSchema));
        errors = await check(doc);
      }
    }
    if (errors.length) throw new Error(`Summary failed verification: ${errors[0]}`);
  }
  return doc;
}

async function sourceFor(sql: Sql, item: Survivor): Promise<{ text: string; availability: SourceAvailability }> {
  const [stored] = await sql<{ body: string | null; transcribed_at: Date | null; source_content_kind: string | null }[]>`
    select body,transcribed_at,source_content_kind from dailynews.items where id=${item.id}`;
  let text = stripHtml(stored?.body ?? item.body ?? "");
  if (stored?.transcribed_at) return { text: text || item.excerpt, availability: "derived_summary" };
  if (text && stored?.source_content_kind === "article_text") return { text, availability: "article_text" };
  if (!videoIdOf(item.url)) {
    try {
      const article = await fetchArticle(item.url);
      const fetched = stripHtml(articleHtml(article.markdown));
      // A public preview must never replace the full RSS/email content already collected.
      if (text.length >= 600 && text.length > fetched.length) return { text, availability: "feed_text" };
      text = fetched;
      await sql`update dailynews.items set body=${articleHtml(article.markdown)}, enriched_at=now(), source_content_kind='article_text' where id=${item.id}`;
      return { text, availability: "article_text" };
    } catch (error) {
      console.warn(`reading source ${item.id}: ${error instanceof Error ? error.message.slice(0,100) : 'unavailable'}`);
    }
  }
  return { text: text || item.excerpt, availability: text.length >= 600 ? "feed_text" : "excerpt_only" };
}

const availabilityNotice = (availability: SourceAvailability): string | null =>
  availability === "excerpt_only" ? "Доступен только фрагмент: полный текст статьи не получен."
    : availability === "derived_summary" ? "Выжимка по доступному конспекту видео, не по полной расшифровке."
      : availability === "feed_text" ? "По тексту из ленты источника; полнота оригинала не подтверждена." : null;

export async function writeReadingDigest(sql: Sql, survivors: Survivor[], readerContext: string, voice: Voice, options: ReadingOptions): Promise<DigestResult> {
  const usage = emptyUsage();
  const ask = caller(sql, options.readerId, usage);
  const [reader] = await sql<{ exclude_rules: unknown }[]>`select exclude_rules from dailynews.readers where id=${options.readerId}`;
  if (!reader) throw new Error("Reader unavailable");
  const exclude = compile(asNames(reader.exclude_rules));
  const excludedIds: number[] = [];
  const retainedIds: number[] = [];
  const unavailableIds: number[] = [];
  // Порядок отбора и есть важность: первые карточки читают раньше прочих.
  const leading = new Set(survivors.slice(0, LEAD_CARDS).map((item) => item.id));
  const { model } = resolve();
  const reasoningEffort = readingReasoningProfile();
  const writeOne = async (item: Survivor): Promise<Written | null> => {
    let sourceVersion = "";
    let availability: SourceAvailability = "excerpt_only";
    let analysisKey: string | null = null;
    let lease: string | null = null;
    try {
      const source = await sourceFor(sql, item);
      if (exclude.test(mentionText(item.title, item.excerpt, source.text))) {
        excludedIds.push(item.id);
        return null;
      }
      availability = source.availability;
      sourceVersion = hash(`${source.text}\n${item.title}\n${item.url}\n${availability}`);
      if (!source.text.trim()) throw new Error("Source unavailable");
      splitSource(source.text);
      const baselines = await recentBaselines(sql, options.readerId, item.id, item.title);
      const prominence: Prominence = leading.has(item.id) ? "lead" : "regular";
      const key = hash(JSON.stringify([READING_VERSION, model, reasoningEffort, item.id, sourceVersion, readerContext, voice, baselines, prominence]));
      const cached = options.force ? null : parseStoredReading(await getDocument(sql, options.readerId, key));
      if (cached?.document && cached.status === "verified") {
        return { id: item.id, title_ru: cached.document.title.text, summary: readingText(cached), reading: cached };
      }
      analysisKey = hash(JSON.stringify([READING_VERSION, model, reasoningEffort, item.id, sourceVersion]));
      const shared = await acquireAnalysis(sql, item.id, analysisKey, sourceVersion);
      lease = shared.token;
      const analysis = shared.analysis ?? await analyzeSource(ask, source.text, item.title, sourceVersion, availability);
      if (lease) { await finishAnalysis(sql, analysisKey, lease, analysis); lease = null; }
      const document = await composeDocument(ask, source.text, analysis, readerContext, voice, item.topic_label, baselines, prominence);
      const notice = availabilityNotice(availability);
      const reading: StoredReading = { version: 2, sourceVersion, availability, status: "verified", document, notice,
        seconds: Math.ceil(minutesOf(cardChars(document.title.text, documentText(document) + (notice ?? "")), voice) * 60) };
      await saveDocument(sql, options.readerId, item.id, key, reading);
      return { id: item.id, title_ru: document.title.text, summary: readingText(reading), reading };
    } catch (error) {
      if (error instanceof ReadingBusyError) throw error;
      if (lease && analysisKey) await finishAnalysis(sql, analysisKey, lease, null);
      const [previous] = await sql<{ result: unknown }[]>`
        select di.summary_document as result from dailynews.digest_items di
        join dailynews.digests d on d.id=di.digest_id
        where d.reader_id=${options.readerId} and di.item_id=${item.id}
          and di.summary_document->>'sourceVersion'=${sourceVersion}
        order by d.day desc limit 1`;
      const retained = parseStoredReading(previous?.result);
      if (retained?.status === "verified" && retained.document) {
        retainedIds.push(item.id);
        console.warn(`reading ${item.id}: retained verified summary of unchanged source`);
        return { id: item.id, title_ru: retained.document.title.text,
          summary: readingText(retained), reading: retained };
      }
      // Карточки не будет вовсе. Заглушка «выжимку подготовить не удалось»
      // занимала место новости в ленте, в сообщении, в книге и в подкасте:
      // читатель видел отказ там, где ждал новость, и открыть её мог только
      // по ссылке — то есть ровно то, от чего лента и избавляет. Материал
      // при этом не уходит из кандидатов: в выпуске его нет, и следующий
      // прогон попробует написать его снова.
      unavailableIds.push(item.id);
      console.warn(`reading ${item.id}: ${error instanceof ReadingBudgetError ? 'дневной лимит обработки исчерпан' : ''}${error instanceof Error ? error.message.slice(0,180) : 'failed'}`);
      return null;
    }
  };
  // Keep source order and settle every in-flight request before propagating a retryable failure.
  const outcomes = await pooled(survivors, 2, async item => {
    try { return { item: await writeOne(item) }; }
    catch (error) { return { error }; }
  });
  const failed = outcomes.find(outcome => "error" in outcome);
  if (failed) throw failed.error;
  const items = outcomes.flatMap(outcome => outcome.item ? [outcome.item] : []);
  // The introduction is written only after all final, verified cards exist.
  let intro = "";
  const complete = items.filter((i) => i.reading?.status === "verified");
  if (complete.length > 1) {
    try {
      const data = { language: voice.language, cards: complete.map((i) => ({ title: i.title_ru, summary: i.summary })) };
      const result = await ask("intro", `${SOURCE_RULES}\nWrite one short sentence introducing these cards. No new claims or invented connection. Return empty intro if no useful common context.`, data, z.object({ intro: z.string().max(500) }).strict());
      const checked = await ask("intro-verify", `${SOURCE_RULES}\nCheck the intro adds no unsupported fact, causal connection or exaggerated conclusion. Return defects.`, { ...data, intro: result.intro }, auditSchema);
      if (!checked.defects.length) intro = result.intro;
    } catch (error) { console.warn(`reading intro unavailable: ${error instanceof Error ? error.message.slice(0,100) : 'failed'}`); }
  }
  return { intro, items, excludedIds, retainedIds, unavailableIds, usage, model, reasoningEffort: reasoningEffort ?? null, accounted: true };
}
