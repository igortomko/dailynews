import { documentText, type StoredReading } from "./reading-document";

export type EvaluationSource = {
  itemId: number;
  position: number;
  title: string;
  source: string;
  topic: string | null;
  url: string;
  summary: string;
  reading: StoredReading;
};

export type EvaluationCard = {
  card: EvaluationSource & { form: string; visibleText: string };
  sourceReview: {
    mainQuestion: string;
    expectedAnswer: string;
    essentialLimit: string;
    sourceDecision: "read" | "skip" | "either" | null;
  };
  readerReview: {
    answer: string;
    seconds: number | null;
    confidence: number | null;
    mainQuestionCorrect: boolean | null;
    essentialLimitNamed: boolean | null;
    sourceDecision: "read" | "skip" | null;
    formatHelped: boolean | null;
    misleadingClaims: string[];
    notes: string;
  };
};

export type EvaluationWorksheet = {
  version: 1;
  createdAt: string;
  readerId: number;
  editionDay: string;
  protocol: {
    answerLimitSeconds: number;
    instructions: string[];
  };
  cards: EvaluationCard[];
};

export type EvaluationSummary = {
  reviewed: number;
  complete: number;
  mainQuestionCorrect: number | null;
  essentialLimitNamed: number | null;
  sourceDecisionAppropriate: number | null;
  medianSeconds: number | null;
  meanConfidence: number | null;
  misleadingCards: number;
  byForm: Array<{
    form: string;
    complete: number;
    mainQuestionCorrect: number | null;
    essentialLimitNamed: number | null;
    formatHelped: number | null;
  }>;
};

export const formOf = (reading: StoredReading) => {
  const document = reading.document;
  if (!document) return "legacy";
  // План формы называет её сам. Вывод по блокам остаётся для выпусков,
  // написанных до того, как форма стала решением, а не следствием.
  if (document.formatPlan) return document.formatPlan.format;
  if (["narrative", "argument", "investigation"].includes(document.genre)) return "story";
  const firstStructured = document.blocks.find((block) => block.kind !== "paragraph");
  if (!firstStructured) return "brief";
  if (firstStructured.kind === "list") return firstStructured.numbering === "facts" ? "numbered-list" : "bullets";
  if (firstStructured.kind === "steps") return firstStructured.sequence === "timeline" ? "timeline" : "steps";
  if (firstStructured.kind === "flow") return "mechanism";
  if (firstStructured.kind === "metric") return "data";
  return firstStructured.kind;
};

const visibleText = (source: EvaluationSource) => source.reading.document ? documentText(source.reading.document) : source.summary;

/**
 * One edition is usually short. Pick different existing forms first so an
 * editor does not accidentally judge twelve prose cards and call it coverage.
 * This does not manufacture a comparison: forms with fewer than four completed
 * reviews remain descriptive evidence only.
 */
export function selectEvaluationCards(sources: EvaluationSource[], limit: number): EvaluationCard[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Evaluation limit must be a positive integer");
  const ordered = [...sources].sort((a, b) => a.position - b.position || a.itemId - b.itemId);
  const selected: EvaluationSource[] = [];
  const seenForms = new Set<string>();

  for (const source of ordered) {
    const form = formOf(source.reading);
    if (!seenForms.has(form) && selected.length < limit) {
      selected.push(source);
      seenForms.add(form);
    }
  }
  for (const source of ordered) {
    if (selected.length >= limit) break;
    if (!selected.some((picked) => picked.itemId === source.itemId)) selected.push(source);
  }

  return selected.map((source) => ({
    card: { ...source, form: formOf(source.reading), visibleText: visibleText(source) },
    sourceReview: {
      mainQuestion: "",
      expectedAnswer: "",
      essentialLimit: "",
      sourceDecision: null,
    },
    readerReview: {
      answer: "",
      seconds: null,
      confidence: null,
      mainQuestionCorrect: null,
      essentialLimitNamed: null,
      sourceDecision: null,
      formatHelped: null,
      misleadingClaims: [],
      notes: "",
    },
  }));
}

const rate = (values: boolean[]) => values.length ? values.filter(Boolean).length / values.length : null;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

const complete = (card: EvaluationCard) =>
  typeof card.readerReview.mainQuestionCorrect === "boolean"
  && typeof card.readerReview.essentialLimitNamed === "boolean"
  && typeof card.readerReview.seconds === "number"
  && typeof card.sourceReview.sourceDecision === "string"
  && typeof card.readerReview.sourceDecision === "string";

export function summarizeEvaluation(worksheet: EvaluationWorksheet): EvaluationSummary {
  const reviewed = worksheet.cards.filter(complete);
  const decisionAppropriate = reviewed
    .filter((card) => card.sourceReview.sourceDecision !== "either")
    .map((card) => card.sourceReview.sourceDecision === card.readerReview.sourceDecision);
  const byForm = [...new Set(worksheet.cards.map((card) => card.card.form))].map((form) => {
    const cards = worksheet.cards.filter((card) => card.card.form === form && complete(card));
    return {
      form,
      complete: cards.length,
      mainQuestionCorrect: rate(cards.map((card) => card.readerReview.mainQuestionCorrect === true)),
      essentialLimitNamed: rate(cards.map((card) => card.readerReview.essentialLimitNamed === true)),
      formatHelped: rate(cards.filter((card) => typeof card.readerReview.formatHelped === "boolean").map((card) => card.readerReview.formatHelped === true)),
    };
  });

  return {
    reviewed: worksheet.cards.length,
    complete: reviewed.length,
    mainQuestionCorrect: rate(reviewed.map((card) => card.readerReview.mainQuestionCorrect === true)),
    essentialLimitNamed: rate(reviewed.map((card) => card.readerReview.essentialLimitNamed === true)),
    sourceDecisionAppropriate: rate(decisionAppropriate),
    medianSeconds: median(reviewed.map((card) => card.readerReview.seconds).filter((value): value is number => typeof value === "number")),
    meanConfidence: mean(reviewed.map((card) => card.readerReview.confidence).filter((value): value is number => typeof value === "number")),
    misleadingCards: worksheet.cards.filter((card) => card.readerReview.misleadingClaims.length > 0).length,
    byForm,
  };
}
