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
  documentText, parseStoredReading, normalizeDocument, validateQuotes,
  formatPlanSchema, type ArticleAnalysis, type StoredReading, type SourceAvailability, type ReadingDocument, type EditorialFormat,
} from "../src/lib/reading-document";
import { READING_VERSION, SOURCE_RULES, EXTRACT_RULES, COMPOSE_RULES, VERIFY_RULES, FORMAT_PLAN_RULES } from "./reading-prompts";
import { acquireAnalysis, finishAnalysis, getDocument, saveDocument, reserveCall, settleCall, recentBaselines, ReadingBudgetError, ReadingBusyError, type Baseline } from "./reading-store";

export type ReadingOptions = { readerId: number; force?: boolean };
export type Ask = <T>(phase: string, rules: string, data: unknown, schema: z.ZodType<T>) => Promise<T>;
export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const emptyUsage = (): Usage => ({ input: 0, output: 0, cached: 0, reasoning: 0, requests: 0 });
const OUTPUT_TOKENS = 6000;
export const MAX_SOURCE_CHARS = 160_000;
type FormatPlan = z.infer<typeof formatPlanSchema>;

/**
 * Формы — не лотерея. Ограничиваем долю двух универсальных форм и списков,
 * но не заставляем редкие формы появляться без подтверждённой структуры
 * источника: фальшивая цитата или «решение» хуже однообразной прозы.
 */
function formatAllocator(total: number) {
  const maximum = new Map<EditorialFormat, number>([
    ["brief", Math.ceil(total * 0.35)],
    ["story", Math.ceil(total * 0.25)],
    ["bullets", Math.ceil(total * 0.25)],
  ]);
  const used = new Map<EditorialFormat, number>();
  return (plan: FormatPlan): FormatPlan => {
    const cap = maximum.get(plan.format);
    if (cap === undefined || (used.get(plan.format) ?? 0) < cap) {
      used.set(plan.format, (used.get(plan.format) ?? 0) + 1);
      return plan;
    }
    const fallbackCap = maximum.get(plan.fallback);
    if (plan.fallback !== plan.format && (fallbackCap === undefined || (used.get(plan.fallback) ?? 0) < fallbackCap)) {
      used.set(plan.fallback, (used.get(plan.fallback) ?? 0) + 1);
      return { ...plan, format: plan.fallback, reason: `${plan.reason} Основная форма уже достигла предела в этом выпуске.` };
    }
    // Если обе формы достигли предела, сохраняем смысловую форму вместо
    // подмены её декоративным блоком.
    used.set(plan.format, (used.get(plan.format) ?? 0) + 1);
    return plan;
  };
}

type DeferredFormatPlan = {
  task: (() => Promise<FormatPlan>) | null;
  resolve: (plan: FormatPlan | null) => void;
  reject: (error: unknown) => void;
};

/**
 * Анализ и запись карточек идут параллельно, но квота форм должна зависеть от
 * позиции в выпуске, а не от сетевой гонки. Иначе два одинаковых прогона могли
 * дать разные доли списков и прозы только из-за порядка ответов модели.
 */
export function orderedFormatPlanner(total: number) {
  const assign = formatAllocator(total);
  const pending = new Map<number, DeferredFormatPlan>();
  let next = 0;
  let draining = false;

  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      while (pending.has(next)) {
        const slot = pending.get(next);
        if (!slot) break;
        pending.delete(next);
        try {
          const plan = slot.task ? await slot.task() : null;
          slot.resolve(plan ? assign(plan) : null);
        } catch (error) {
          slot.reject(error);
        }
        next++;
      }
    } finally {
      draining = false;
      if (pending.has(next)) void drain();
    }
  };

  const schedule = (position: number, task: DeferredFormatPlan["task"]) =>
    new Promise<FormatPlan | null>((resolve, reject) => {
      if (position < next || pending.has(position)) {
        reject(new Error(`Editorial format slot ${position} was scheduled twice.`));
        return;
      }
      pending.set(position, { task, resolve, reject });
      void drain();
    });

  return {
    async plan(position: number, task: () => Promise<FormatPlan>): Promise<FormatPlan> {
      const plan = await schedule(position, task);
      if (!plan) throw new Error(`Editorial format slot ${position} was skipped.`);
      return plan;
    },
    skip(position: number) {
      // Cached, excluded and failed cards still consume their ordering slot so
      // a later card never waits forever for a plan that will not be written.
      if (position < next || pending.has(position)) return;
      void schedule(position, null).catch(() => {});
    },
  };
}

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
    // The live replay rejected valid text and ignored length with reasoning disabled.
    // Extraction is mechanical; editing and checking use bounded reasoning.
    const reasoningEffort = process.env.READING_REASONING_EFFORT?.trim() || (phase.startsWith("extract") ? "none" : "low");
    if (!apiKey) throw new Error("No model key");
    const outputTokens = phase === "format-plan"
      ? 1200
      : reasoningEffort && reasoningEffort !== "none" ? 32000 : OUTPUT_TOKENS;
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

export async function planFormat(ask: Ask, analysis: ArticleAnalysis, topic: string, baselines: Baseline[]): Promise<z.infer<typeof formatPlanSchema>> {
  const result = await ask("format-plan", FORMAT_PLAN_RULES, {
    topic,
    candidateBaselines: baselines.map(({ id, title, originalTitle, summary, day }) => ({ id, title, originalTitle, summary, day })),
    analysis: {
      ...analysis,
      sections: analysis.sections.map(({ claims, ...section }) => ({
        ...section,
        claims: claims.map(({ quote, ...claim }) => { void quote; return claim; }),
      })),
    },
  }, formatPlanSchema);
  const known = new Set(analysis.sections.flatMap((section) => section.claims.map((claim) => claim.id)));
  if (!result.claimIds.every((id) => known.has(id))) throw new Error("Format plan cites an unknown source claim");
  if (result.format === "continuation" && !baselines.length) return { ...result, format: "brief", fallback: "brief", reason: `${result.reason} Нет проверенного предыдущего материала, поэтому выбран краткий ответ.` };
  return result;
}

export async function composeDocument(ask: Ask, source: string, analysis: ArticleAnalysis, readerContext: string, voice: Voice, topic: string, baselines: Baseline[], formatPlan?: z.infer<typeof formatPlanSchema>): Promise<ReadingDocument> {
  const input = {
    language: voice.language, style: styleOf(voice.style).instruction,
    complexityPreference: voice.complexity,
    complexityMeaning: "1 = simple short phrases; 5 = concise technical writing WHERE knowledge is explicitly known. Unknown subtopics need brief explanations at any level.",
    readerContext, topic,
    quoteCandidates: analysis.sections.flatMap(section => section.claims)
      .filter(claim => claim.role === "interpretation" || claim.role === "recommendation")
      .flatMap(claim => claim.quote.split(/(?<=[.!?])\s+/u).filter(sentence => {
        const words = sentence.trim().split(/\s+/u).length;
        return words >= 4 && words <= 25;
      }).map(sentence => ({ text: sentence.trim(), claimIds: [claim.id] }))).slice(-8),
    analysis: { ...analysis, sections: analysis.sections.map(section => ({ ...section,
      claims: section.claims.map(({ quote, ...claim }) => { void quote; return claim; }) })) },
    candidateBaselines: baselines,
    formatPlan: formatPlan ?? (() => {
      const firstClaim = analysis.sections[0]?.claims[0];
      if (!firstClaim) throw new Error("Source analysis has no claims for format fallback");
      return { format: "brief" as EditorialFormat, reason: "Без отдельного плана формы: безопасный ответ.", claimIds: [firstClaim.id], fallback: "brief" as EditorialFormat };
    })(),
  };
  const check = async (doc: ReadingDocument) => {
    const errors = [...validateCoverage(doc, analysis, readerContext, baselines.map((b) => b.id)), ...validateQuotes(doc, source)];
    const answerWords = doc.answer?.text.trim().split(/\s+/u).filter(Boolean).length ?? 0;
    if (!doc.answer) errors.push("Missing mandatory 35–60 word answer layer.");
    else if (answerWords < 35 || answerWords > 60) errors.push(`Answer layer is ${answerWords} words; it must be 35–60 words.`);
    if (formatPlan && !doc.formatPlan) errors.push("Missing mandatory editorial format plan.");
    if (formatPlan && doc.formatPlan && ![formatPlan.format, formatPlan.fallback].includes(doc.formatPlan.format)) {
      errors.push(`Document format ${doc.formatPlan.format} does not match the approved plan ${formatPlan.format} or fallback ${formatPlan.fallback}.`);
    }
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
  const formats = orderedFormatPlanner(survivors.length);
  const { model } = resolve();
  const reasoningEffort = process.env.READING_REASONING_EFFORT?.trim() || "extract:none;edit+audit:low";
  const writeOne = async (item: Survivor, position: number): Promise<Written | null> => {
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
      const key = hash(JSON.stringify([READING_VERSION, model, reasoningEffort, item.id, sourceVersion, readerContext, voice, baselines]));
      const cached = options.force ? null : parseStoredReading(await getDocument(sql, options.readerId, key));
      if (cached?.document && cached.status === "verified") {
        return { id: item.id, title_ru: cached.document.title.text, summary: [cached.notice, documentText(cached.document)].filter(Boolean).join("\n\n"), reading: cached };
      }
      analysisKey = hash(JSON.stringify([READING_VERSION, model, reasoningEffort, item.id, sourceVersion]));
      const shared = await acquireAnalysis(sql, item.id, analysisKey, sourceVersion);
      lease = shared.token;
      const analysis = shared.analysis ?? await analyzeSource(ask, source.text, item.title, sourceVersion, availability);
      if (lease) { await finishAnalysis(sql, analysisKey, lease, analysis); lease = null; }
      const formatPlan = await formats.plan(position, () => planFormat(ask, analysis, item.topic_label, baselines));
      const document = await composeDocument(ask, source.text, analysis, readerContext, voice, item.topic_label, baselines, formatPlan);
      const notice = availabilityNotice(availability);
      const reading: StoredReading = { version: 2, sourceVersion, availability, status: "verified", document, notice,
        seconds: Math.ceil(minutesOf(cardChars(document.title.text, documentText(document) + (notice ?? "")), voice) * 60) };
      await saveDocument(sql, options.readerId, item.id, key, reading);
      return { id: item.id, title_ru: document.title.text, summary: [notice, documentText(document)].filter(Boolean).join("\n\n"), reading };
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
          summary: [retained.notice, documentText(retained.document)].filter(Boolean).join("\n\n"), reading: retained };
      }
      const budget = error instanceof ReadingBudgetError;
      console.warn(`reading ${item.id}: ${error instanceof Error ? error.message.slice(0,180) : 'failed'}`);
      const notice = budget ? "Выжимка пока недоступна: дневной лимит обработки исчерпан. Оригинал — по ссылке в заголовке."
        : "Проверенную выжимку подготовить не удалось. Оригинал — по ссылке в заголовке.";
      return { id: item.id, title_ru: item.title, summary: notice, reading: { version: 2, sourceVersion, availability, status: "unavailable", document: null, notice, seconds: 0 } };
    } finally {
      formats.skip(position);
    }
  };
  // Keep source order and settle every in-flight request before propagating a retryable failure.
  const outcomes = await pooled(survivors.map((item, position) => ({ item, position })), 2, async ({ item, position }) => {
    try { return { item: await writeOne(item, position) }; }
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
  return { intro, items, excludedIds, retainedIds, usage, model, reasoningEffort: reasoningEffort ?? null, accounted: true };
}
