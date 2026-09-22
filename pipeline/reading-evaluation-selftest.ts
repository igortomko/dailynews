import assert from "node:assert/strict";
import {
  selectEvaluationCards,
  summarizeEvaluation,
  type EvaluationSource,
  type EvaluationWorksheet,
} from "../src/lib/reading-evaluation";
import type { StoredReading } from "../src/lib/reading-document";

const reading = (genre: "news" | "narrative", kind: "paragraph" | "quote" | "list"): StoredReading => ({
  version: 2,
  sourceVersion: "test",
  availability: "article_text",
  status: "verified",
  notice: null,
  seconds: 20,
  document: {
    schemaVersion: 2,
    genre,
    title: { text: "Title", claimIds: ["c1"] },
    lead: null,
    blocks: kind === "quote"
      ? [{ kind: "quote", attribution: "Author", content: { text: "Exact words", claimIds: ["c1"] } }]
      : kind === "list"
        ? [{ kind: "list", numbering: "bullets", items: [{ text: "One", claimIds: ["c1"] }, { text: "Two", claimIds: ["c1"] }] }]
        : [{ kind: "paragraph", content: { text: "Plain answer", claimIds: ["c1"] } }],
    evidence: null,
    application: null,
    omitted: [],
    baselineId: null,
  },
});
const source = (itemId: number, position: number, card: StoredReading): EvaluationSource => ({
  itemId, position, title: `Card ${itemId}`, source: "Source", topic: "Topic", url: `https://example.test/${itemId}`, summary: "Summary", reading: card,
});

const cards = selectEvaluationCards([
  source(1, 1, reading("news", "paragraph")),
  source(2, 2, reading("news", "quote")),
  source(3, 3, reading("news", "list")),
  source(4, 4, reading("narrative", "paragraph")),
], 4);
assert.deepEqual(cards.map((card) => card.card.form), ["brief", "quote", "bullets", "story"]);

const worksheet: EvaluationWorksheet = {
  version: 1,
  createdAt: "2026-09-22T00:00:00.000Z",
  readerId: 1,
  editionDay: "2026-09-22",
  protocol: { answerLimitSeconds: 60, instructions: [] },
  cards,
};
for (const [index, card] of worksheet.cards.entries()) {
  card.sourceReview.sourceDecision = index === 3 ? "either" : "read";
  card.readerReview.mainQuestionCorrect = index !== 1;
  card.readerReview.essentialLimitNamed = index !== 2;
  card.readerReview.sourceDecision = "read";
  card.readerReview.seconds = 20 + index * 10;
  card.readerReview.confidence = 4;
  card.readerReview.formatHelped = index !== 0;
}
const summary = summarizeEvaluation(worksheet);
assert.equal(summary.complete, 4);
assert.equal(summary.mainQuestionCorrect, 0.75);
assert.equal(summary.essentialLimitNamed, 0.75);
assert.equal(summary.sourceDecisionAppropriate, 1);
assert.equal(summary.medianSeconds, 35);
assert.equal(summary.byForm.find((row) => row.form === "quote")?.formatHelped, 1);
console.log("  reading evaluation: deterministic form coverage and human review aggregation passed");
