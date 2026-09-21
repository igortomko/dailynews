import { z } from "zod";
import { editorialFormat } from "../src/lib/reading-document";

/**
 * Редакторский тест не оценивает «красивость» текста. Он фиксирует, понял ли
 * человек главное за минуту, удержал ли ограничение и может ли решить, нужен
 * ли ему первоисточник. Эталон заполняется до ответа читателя, иначе оценка
 * задним числом подстраивается под удачную формулировку карточки.
 */
export const sourceDecisionSchema = z.enum(["open", "optional", "skip"]);
export const evaluationCaseSchema = z.object({
  itemId: z.number().int().positive(),
  position: z.number().int().positive(),
  title: z.string().trim().min(1),
  format: editorialFormat.nullable(),
  answer: z.string().trim().min(1).nullable(),
  mainQuestion: z.string().trim().min(1).nullable(),
  expectedAnswer: z.string().trim().min(1).nullable(),
  essentialLimitation: z.string().trim().min(1).nullable(),
  expectedSourceDecision: sourceDecisionSchema.nullable(),
  sourceDecisionReason: z.string().trim().min(1).nullable(),
}).strict();
export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;

export const evaluationResponseSchema = z.object({
  itemId: z.number().int().positive(),
  readerAnswer: z.string().trim().min(1).nullable(),
  limitationNamed: z.boolean().nullable(),
  sourceDecision: sourceDecisionSchema.nullable(),
  sourceDecisionReason: z.string().trim().min(1).nullable(),
  unsupportedOrMisleading: z.string().trim().min(1).nullable(),
  personalizationChangedDecision: z.boolean().nullable(),
  reviewerNotes: z.string().trim().min(1).nullable(),
}).strict();
export type EvaluationResponse = z.infer<typeof evaluationResponseSchema>;

export const evaluationFileSchema = z.object({
  version: z.literal(1),
  createdAt: z.string().datetime(),
  readerId: z.number().int().positive(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  instructions: z.array(z.string().trim().min(1)).length(5),
  cases: z.array(evaluationCaseSchema).min(10).max(15),
  responses: z.array(evaluationResponseSchema),
}).strict();
export type EvaluationFile = z.infer<typeof evaluationFileSchema>;

type Candidate = Pick<EvaluationCase, "itemId" | "position" | "format">;

/**
 * Сначала берём по одному материалу каждой найденной формы. Так выборка
 * ловит поломку, спрятанную за хорошими prose-карточками. Остальные места
 * заполняет порядок выпуска — это не «лучшие примеры», а обычная лента.
 */
export function selectEvaluationSample<T extends Candidate>(candidates: T[], requested = 12): T[] {
  const limit = Math.min(15, Math.max(10, requested));
  const ordered = [...candidates].sort((a, b) => a.position - b.position);
  const selected: T[] = [];
  const seenFormats = new Set<string>();

  for (const candidate of ordered) {
    const format = candidate.format ?? "legacy";
    if (seenFormats.has(format)) continue;
    seenFormats.add(format);
    selected.push(candidate);
    if (selected.length === limit) return selected;
  }
  for (const candidate of ordered) {
    if (selected.some((entry) => entry.itemId === candidate.itemId)) continue;
    selected.push(candidate);
    if (selected.length === limit) break;
  }
  return selected;
}

export function evaluationCompleteness(file: EvaluationFile): string[] {
  const issues: string[] = [];
  if (file.cases.length < 10 || file.cases.length > 15) {
    issues.push("Evaluation must contain 10–15 materials.");
  }
  const responses = new Map(file.responses.map((response) => [response.itemId, response]));
  for (const item of file.cases) {
    if (!item.mainQuestion || !item.expectedAnswer || !item.essentialLimitation || !item.expectedSourceDecision || !item.sourceDecisionReason) {
      issues.push(`Item ${item.itemId}: fill the editorial answer key before testing.`);
    }
    const response = responses.get(item.itemId);
    if (!response) {
      issues.push(`Item ${item.itemId}: no reader response.`);
      continue;
    }
    if (!response.readerAnswer || response.limitationNamed === null || !response.sourceDecision || !response.sourceDecisionReason) {
      issues.push(`Item ${item.itemId}: reader response is incomplete.`);
    }
  }
  return issues;
}

export function evaluationReport(file: EvaluationFile) {
  const responses = new Map(file.responses.map((response) => [response.itemId, response]));
  const complete = file.cases.flatMap((item) => {
    const response = responses.get(item.itemId);
    return response && response.readerAnswer && response.limitationNamed !== null && response.sourceDecision
      ? [{ item, response }]
      : [];
  });
  const decisionCorrect = complete.filter(({ item, response }) => response.sourceDecision === item.expectedSourceDecision).length;
  return {
    total: file.cases.length,
    complete: complete.length,
    limitationsNamed: complete.filter(({ response }) => response.limitationNamed).length,
    sourceDecisionsCorrect: decisionCorrect,
    personalizationChangedDecision: complete.filter(({ response }) => response.personalizationChangedDecision).length,
    misleadingFlags: complete.filter(({ response }) => Boolean(response.unsupportedOrMisleading)).length,
  };
}
