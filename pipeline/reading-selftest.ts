import assert from "node:assert/strict";
import { documentSchema, validateCoverage, validateSection, validateQuotes, documentText, parseStoredReading, blockText, normalizeDocument, type ArticleAnalysis, type ReadingDocument } from "../src/lib/reading-document";
import { splitSource, composeDocument, analyzeSource, orderedFormatPlanner, type Ask } from "./reading";
import { typography, summaryTime } from "../src/lib/typography";
import { digestHtml } from "./kindle";
import { DEFAULT_VOICE } from "../src/lib/voice";
import { evaluationCompleteness, evaluationFileSchema, evaluationReport, selectEvaluationSample } from "./reading-evaluation";

const evidence = (text: string, ...claimIds: string[]) => ({ text, claimIds });
const analysis: ArticleAnalysis = { sourceVersion: "v", availability: "article_text", sections: [{
  id: "s1", start: 0, end: 120, subject: "Test", genre: "research", excluded: [],
  claims: [
    { id: "s1-a", text: "Speed improved", quote: "Speed improved", importance: "critical", role: "fact" },
    { id: "s1-b", text: "No effect on accuracy", quote: "No effect on accuracy", importance: "critical", role: "limitation" },
    { id: "s1-c", text: "24 participants", quote: "24 participants", importance: "major", role: "fact" },
  ],
}] };
const valid: ReadingDocument = {
  schemaVersion: 2, genre: "research", title: evidence("Speed improved in 24 participants", "s1-a", "s1-c"),
  answer: evidence("The 24-person test found that speed improved, but accuracy did not change. It therefore shows a narrower performance gain, not a general cognitive benefit: the study measured only those two outcomes, so it cannot tell whether the effect persists outside this small group.", "s1-a", "s1-b", "s1-c"),
  formatPlan: { format: "brief", fallback: "brief", reason: "One result and one essential limit are faster as a short answer.", claimIds: ["s1-a", "s1-b"] },
  lead: null, blocks: [{ kind: "paragraph", content: evidence("No effect on accuracy.", "s1-b") }], evidence: null, application: null,
  omitted: [], baselineId: null,
};
assert.deepEqual(validateCoverage(valid, analysis, "", []), []);
const missing = structuredClone(valid); missing.blocks = [{ kind: "paragraph", content: evidence("Speed improved", "s1-a") }];
missing.answer = null;
assert.ok(validateCoverage(missing, analysis, "", []).some((e) => e.includes("s1-b")));
assert.ok(!documentSchema.safeParse({ ...valid, blocks: [{ kind: "html", html: "<script>alert(1)</script>" }] }).success);
const extra = structuredClone(valid); extra.blocks.push({ kind: "takeaway", attribution: "Author", content: evidence("Takeaway", "s1-a") }, { kind: "metric", value: "24", label: "participants", context: evidence("Population", "s1-c") });
assert.ok(validateCoverage(extra, analysis, "", []).some((e) => e.includes("one visual")));
const madeUp = structuredClone(valid); madeUp.title.claimIds = ["invented"];
assert.ok(validateCoverage(madeUp, analysis, "", []).some((e) => e.includes("Unknown")));
const application = { ...valid, application: { kind: "opportunity" as const, text: "Do a thing", condition: "If relevant", claimIds: ["s1-a"], contextQuote: "I am an expert in training" } };
assert.ok(validateCoverage(application, analysis, "I follow AI products", []).some((e) => e.includes("context")));
assert.ok(validateCoverage({ ...valid, baselineId: 88 }, analysis, "", [12]).some((e) => e.includes("previous")));
assert.ok(validateSection({ ...analysis.sections[0], claims: [{ ...analysis.sections[0].claims[0], quote: "invented quote" }] }, "Speed improved").length > 0);
assert.equal(parseStoredReading({ version: 2, status: "verified", document: null }), null);
const long = 'Beginning. '.repeat(1800) + 'The result was reversed in the final section.';
const parts = splitSource(long);
assert.equal(parts.map((p) => p.text).join(""), long);
assert.ok(parts.at(-1)?.text.endsWith('final section.'));
assert.ok(parts.every((p,i) => p.start === (i ? parts[i-1].end : 0)));
assert.throws(() => splitSource('a'.repeat(160001)), /limit/);
assert.equal(summaryTime(61), '1\u00a0мин 10\u00a0с');
assert.equal(typography('на 5 км'), 'на\u00a05\u00a0км');
assert.equal(typography('и в статье'), 'и\u00a0в\u00a0статье');
assert.equal(typography('6 сентября'), '6\u00a0сентября');
assert.equal(typography('Шаг 1'), 'Шаг\u00a01');
assert.equal(typography('Qwen2.5-32B и 2026-09-21'), 'Qwen2.5-32B и\u00a02026-09-21');
assert.equal(typography('2023–2024 годы'), '2023\u2060–\u20602024 годы');
assert.ok(documentText(valid).includes('No effect on accuracy'));
const quotation: ReadingDocument = { ...valid, blocks: [{ kind: 'quote', attribution: 'Author', content: evidence('No effect on accuracy', 's1-b') }] };
assert.deepEqual(validateQuotes(quotation, 'The study found No effect on accuracy in participants.'), []);
assert.ok(validateQuotes(quotation, 'Accuracy improved.').length > 0, 'invented and translated quotations cannot pass');
assert.ok(documentText(quotation).includes('“No effect on accuracy”\n— Author'));
const sixSteps = { ...valid, blocks: [{ kind: 'list', numbering: 'facts', items: Array.from({length:6}, (_,i)=>evidence(`Step ${i+1}`, 's1-b')) }] };
assert.ok(documentSchema.safeParse(sixSteps).success, 'preserve all six steps rather than merging the source sequence');
const kindle = digestHtml('2026-09-21','',[{ title:'<unsafe>',summary:'First\n\nSecond',url:'https://example.com/?a="x"',source_label:'Source',topic_label:'Topic' }]);
assert.ok(kindle.includes('&lt;unsafe&gt;'));
assert.ok(kindle.includes('<p>First</p>') && kindle.includes('<p>Second</p>'));
assert.ok(kindle.includes('&quot;'));

assert.ok(blockText({ kind: 'steps', sequence: 'timeline', items: [{ label: 'Launch', content: evidence('Release', 's1-a'), state: 'planned' }, { label: 'Pilot', content: evidence('Trial', 's1-a'), state: 'current' }] }).includes('(предстоит)'));
assert.ok(validateCoverage({ ...valid, blocks: [{ kind: 'paragraph', content: evidence('word '.repeat(221), 's1-b') }] }, analysis, '', []).some(e => e.includes('maximum')));
assert.deepEqual(normalizeDocument({ ...valid, omitted: [{ claimId: 's1-a', reason: 'Accidental duplicate' }] }).omitted, []);
const tooShortAnswer = structuredClone(valid);
tooShortAnswer.answer = evidence("Speed improved, but accuracy did not.", "s1-a", "s1-b");
assert.ok(validateCoverage(tooShortAnswer, analysis, "", []).length === 0, "stored documents stay parseable even when a runtime-only answer constraint is not met");
const candidateSample = selectEvaluationSample([
  { itemId: 1, position: 1, format: "brief" as const },
  { itemId: 2, position: 2, format: "brief" as const },
  { itemId: 3, position: 3, format: "story" as const },
  { itemId: 4, position: 4, format: "data" as const },
  { itemId: 5, position: 5, format: "quote" as const },
  { itemId: 6, position: 6, format: "mechanism" as const },
  { itemId: 7, position: 7, format: "qa" as const },
  { itemId: 8, position: 8, format: "comparison" as const },
  { itemId: 9, position: 9, format: "steps" as const },
  { itemId: 10, position: 10, format: "case" as const },
  { itemId: 11, position: 11, format: "continuation" as const },
  { itemId: 12, position: 12, format: "decision" as const },
], 12);
assert.deepEqual(candidateSample.map((item) => item.itemId), [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 2]);
const evaluation = evaluationFileSchema.parse({
  version: 1, createdAt: "2026-09-21T00:00:00.000Z", readerId: 1, day: "2026-09-21",
  instructions: ["a", "b", "c", "d", "e"],
  cases: Array.from({ length: 10 }, (_, index) => ({
    itemId: index + 1, position: index + 1, title: `Item ${index + 1}`, format: "brief", answer: "Answer",
    mainQuestion: "What happened?", expectedAnswer: "The result", essentialLimitation: "Small sample",
    expectedSourceDecision: "optional", sourceDecisionReason: "The card contains the operational result.",
  })),
  responses: Array.from({ length: 10 }, (_, index) => ({
    itemId: index + 1, readerAnswer: "The reader's answer", limitationNamed: true,
    sourceDecision: "optional", sourceDecisionReason: "Enough to decide.", unsupportedOrMisleading: null,
    personalizationChangedDecision: index === 0, reviewerNotes: null,
  })),
});
assert.deepEqual(evaluationCompleteness(evaluation), []);
assert.deepEqual(evaluationReport(evaluation), {
  total: 10, complete: 10, limitationsNamed: 10, sourceDecisionsCorrect: 10,
  personalizationChangedDecision: 1, misleadingFlags: 0,
});

async function main() {
  const formatOrder: number[] = [];
  const planner = orderedFormatPlanner(4);
  const laterPlan = planner.plan(1, async () => {
    formatOrder.push(1);
    return { format: "brief", reason: "later", claimIds: ["s1-a"], fallback: "brief" };
  });
  const firstPlan = planner.plan(0, async () => {
    formatOrder.push(0);
    return { format: "brief", reason: "first", claimIds: ["s1-a"], fallback: "brief" };
  });
  await Promise.all([firstPlan, laterPlan]);
  assert.deepEqual(formatOrder, [0, 1], "format quotas are allocated in release order, not response order");
  const skipPlanner = orderedFormatPlanner(4);
  skipPlanner.skip(0);
  await skipPlanner.plan(1, async () => ({ format: "brief", reason: "after cache", claimIds: ["s1-a"], fallback: "brief" }));

  const visited: string[] = [];
  const extract: Ask = async (phase, _rules, data, schema) => {
    if (phase === 'source-audit') return schema.parse({ defects: [] });
    const spans = (data as { section: { spans: { id: number; text: string }[] } }).section.spans;
    visited.push(spans.map(s => s.text).join(''));
    return schema.parse({ subject: 'End of section', genre: 'narrative', claims: [{ id: 'c1', text: 'The ending matters', importance: 'critical', role: 'fact', sourceSpan: spans.at(-1)!.id }], excluded: [] });
  };
  const grounded = await analyzeSource(extract, long, 'Story', 'v', 'article_text');
  assert.equal(visited.join(''), long, 'the extractor sees every character, including the end');
  assert.ok(grounded.sections.at(-1)!.claims[0].quote.endsWith('final section.'), 'source evidence is attached from the original span, not copied by the model');
  const phases: string[] = [];
  const ask: Ask = async (phase, _rules, _data, schema) => {
    phases.push(phase);
    return schema.parse(phase.startsWith("compose") ? (phase === "compose" ? missing : valid) : { defects: [] });
  };
  const repaired = await composeDocument(ask, "Speed improved. No effect on accuracy. 24 participants.", analysis, "", DEFAULT_VOICE, "Research", []);
  assert.equal(repaired.blocks[0].kind, "paragraph");
  assert.deepEqual(phases, ["compose", "compose-repair", "verify"]);
  const rejecting: Ask = async (phase, _rules, _data, schema) => schema.parse(phase.startsWith("compose") ? valid : { defects: [{ kind: "contradiction", issue: "The limitation is misstated", sourceEvidence: "No effect on accuracy", correction: "Keep the null result" }] });
  await assert.rejects(() => composeDocument(rejecting, "Source", analysis, "", DEFAULT_VOICE, "Research", []), /failed verification/);
  console.log("  reading: full-source coverage, semantic repair/failure, unsafe block rejection, reader context, typography and text delivery passed");
}
main().catch((error: unknown) => { console.error(error); process.exitCode=1; });
