/**
 * Создать редакторскую выборку для проверки понимания, не меняя выпуск и не
 * вызывая модель. Ответы заполняются после теста, отдельно от эталона.
 *
 * npm run reading:evaluate -- --reader 1
 * npm run reading:evaluate -- --reader 1 --limit 12 --out /tmp/reading-evaluation.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { sql } from "../src/lib/db";
import { allReaders, getReader } from "../src/lib/readers";
import { parseStoredReading } from "../src/lib/reading-document";
import {
  evaluationCompleteness,
  evaluationFileSchema,
  evaluationReport,
  selectEvaluationSample,
  type EvaluationCase,
} from "../pipeline/reading-evaluation";

const flag = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

const requestedLimit = () => {
  const value = Number(flag("limit") ?? 12);
  if (!Number.isInteger(value) || value < 10 || value > 15) {
    throw new Error("--limit must be an integer from 10 to 15.");
  }
  return value;
};

type StoredCard = {
  item_id: number;
  position: number;
  title: string;
  summary_document: unknown;
};

function markdown(file: ReturnType<typeof evaluationFileSchema.parse>) {
  const rows = file.cases.map((item) => [
    `## ${item.position}. ${item.title}`,
    "",
    item.answer ? `Карточка: ${item.answer}` : "Карточка: выжимка старого формата",
    `Форма: ${item.format ?? "legacy"}`,
    "",
    "Эталон редактора — заполнить **до** теста:",
    "- Главный вопрос: ",
    "- Короткий ожидаемый ответ: ",
    "- Существенное ограничение: ",
    "- Открывать первоисточник: open / optional / skip",
    "- Почему: ",
    "",
    "Ответ читателя через минуту:",
    "- О чём статья и что произошло: ",
    "- Названо ограничение: да / нет",
    "- Открыть первоисточник: open / optional / skip",
    "- Почему: ",
    "- Что было неточным или вводящим в заблуждение: ",
    "- Персонализация изменила решение: да / нет / нет персонализации",
    "",
  ].join("\n")).join("\n");
  return [
    `# Проверка понимания — выпуск ${file.day}`,
    "",
    "1. Редактор сначала заполняет эталон по статье, не подстраивая его под ответ читателя.",
    "2. Читатель видит карточку до минуты и не открывает детали или источник.",
    "3. Он отвечает своими словами на главный вопрос, называет ограничение и решает, открывать ли первоисточник.",
    "4. Редактор переносит ответы в JSON и запускает `npm run reading:evaluate -- --report <file>`.",
    "5. Это проверяет понимание, а не самооценку модели; результат не считать доказательством ускорения, пока нет нескольких читателей.",
    "",
    rows,
  ].join("\n");
}

async function main() {
  const reportPath = flag("report");
  if (reportPath) {
    const file = evaluationFileSchema.parse(JSON.parse(readFileSync(resolve(reportPath), "utf8")));
    const issues = evaluationCompleteness(file);
    const report = evaluationReport(file);
    console.log(JSON.stringify({ ...report, complete: issues.length === 0, issues }, null, 2));
    return;
  }

  const explicitReader = Number(flag("reader"));
  const reader = Number.isInteger(explicitReader) && explicitReader > 0
    ? await getReader(explicitReader)
    : (await allReaders()).find((entry) => entry.owner);
  if (!reader) throw new Error("Reader not found. Pass --reader <id>.");

  const [edition] = await sql<{ id: number; day: string }[]>`
    select id, day::text from dailynews.digests
    where reader_id=${reader.id}
    order by day desc limit 1`;
  if (!edition) throw new Error("No digest exists for this reader.");

  const cards = await sql<StoredCard[]>`
    select item_id, position, title, summary_document
    from dailynews.digest_items
    where digest_id=${edition.id}
    order by position asc`;
  const cases = selectEvaluationSample(cards.map((card): EvaluationCase => {
    const reading = parseStoredReading(card.summary_document);
    return {
      itemId: card.item_id,
      position: card.position,
      title: card.title,
      format: reading?.document?.formatPlan?.format ?? null,
      answer: reading?.document?.answer?.text ?? reading?.document?.lead?.text ?? null,
      mainQuestion: null,
      expectedAnswer: null,
      essentialLimitation: null,
      expectedSourceDecision: null,
      sourceDecisionReason: null,
    };
  }), requestedLimit());
  if (cases.length < 10) throw new Error(`The latest digest has ${cases.length} cards; need at least 10 for an evaluation.`);

  const file = evaluationFileSchema.parse({
    version: 1,
    createdAt: new Date().toISOString(),
    readerId: reader.id,
    day: edition.day,
    instructions: [
      "Fill the answer key before a reader sees the card.",
      "Give the reader no more than one minute and keep details closed.",
      "Ask for the main answer, the essential limitation, and the source decision.",
      "Mark unsupported or misleading wording even when the main answer is right.",
      "Only count personalization when it changes a risk, opportunity, or next question.",
    ],
    cases,
    responses: [],
  });
  const output = resolve(flag("out") ?? `/tmp/dailynews-reading-evaluation-${reader.id}-${edition.day}.json`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  const markdownOutput = output.replace(/\.json$/u, ".md");
  writeFileSync(markdownOutput, `${markdown(file)}\n`, { mode: 0o600 });
  console.log(`Created ${file.cases.length}-card evaluation:\n${output}\n${markdownOutput}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
