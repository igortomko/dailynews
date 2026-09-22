/**
 * Creates a private worksheet for a human reading check, or summarizes a
 * completed worksheet. It never changes an edition, sends a message or calls a
 * model.
 *
 * npm run reading:evaluate -- --reader 1
 * npm run reading:evaluate -- --report /tmp/dailynews-reading-evaluation.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { sql } from "../src/lib/db";
import {
  selectEvaluationCards,
  summarizeEvaluation,
  type EvaluationSource,
  type EvaluationWorksheet,
} from "../src/lib/reading-evaluation";
import { parseStoredReading } from "../src/lib/reading-document";

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const markdownRate = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;
const markdownNumber = (value: number | null, suffix = "") => value === null ? "—" : `${Number(value.toFixed(1))}${suffix}`;

function markdown(worksheet: EvaluationWorksheet) {
  const lines = [
    `# Проверка чтения · выпуск ${worksheet.editionDay}`,
    "",
    "Заполняет редактор до проверки: главный вопрос, правильный ответ, существенное ограничение и решение об открытии первоисточника. Затем читатель видит только карточку и за 60 секунд пересказывает смысл.",
    "",
    "Критерии: главный вопрос закрыт; ограничение названо; решение об источнике осознанно; форма действительно помогла. Это ручная проверка, не A/B-тест и не доказательство ускорения чтения.",
  ];
  for (const [index, card] of worksheet.cards.entries()) {
    lines.push(
      "",
      `## ${index + 1}. ${card.card.title}`,
      "",
      `Источник: ${card.card.source} · Тема: ${card.card.topic ?? "прочее"} · Форма: ${card.card.form}`,
      "",
      "### Карточка для читателя",
      "",
      card.card.visibleText,
      "",
      "### Заполняет редактор до чтения",
      "",
      "- Главный вопрос: ",
      "- Ожидаемый ответ: ",
      "- Существенное ограничение: ",
      "- Первоисточник: read / skip / either",
      "",
      "### После чтения",
      "",
      "- Ответ читателя: ",
      "- Время (сек.): ",
      "- Уверенность (1–5): ",
      "- Главный вопрос закрыт: yes / no",
      "- Ограничение названо: yes / no",
      "- Решение о первоисточнике: read / skip",
      "- Форма помогла: yes / no",
      "- Неточные или вводящие в заблуждение утверждения: ",
      "- Заметки: ",
    );
  }
  return `${lines.join("\n")}\n`;
}

function report(worksheet: EvaluationWorksheet) {
  const summary = summarizeEvaluation(worksheet);
  const lines = [
    `# Результат проверки чтения · выпуск ${worksheet.editionDay}`,
    "",
    `Завершено: ${summary.complete} из ${summary.reviewed}`,
    "",
    "| Мерка | Результат |",
    "| --- | ---: |",
    `| Главный вопрос закрыт | ${markdownRate(summary.mainQuestionCorrect)} |`,
    `| Существенное ограничение названо | ${markdownRate(summary.essentialLimitNamed)} |`,
    `| Решение об источнике уместно | ${markdownRate(summary.sourceDecisionAppropriate)} |`,
    `| Медиана времени | ${markdownNumber(summary.medianSeconds, " с")} |`,
    `| Средняя уверенность | ${markdownNumber(summary.meanConfidence, " / 5")} |`,
    `| Карточки с вводящими в заблуждение утверждениями | ${summary.misleadingCards} |`,
    "",
    "## По формам",
    "",
    "| Форма | Проверок | Главный вопрос | Ограничение | Форма помогла |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...summary.byForm.map((row) => `| ${row.form} | ${row.complete} | ${markdownRate(row.mainQuestionCorrect)} | ${markdownRate(row.essentialLimitNamed)} | ${markdownRate(row.formatHelped)} |`),
    "",
    "Вывод по форме допустим только после как минимум четырёх завершённых проверок этой формы и без вводящих в заблуждение карточек. Пока читателей меньше десяти, это качественный gate, не A/B-результат.",
  ];
  return `${lines.join("\n")}\n`;
}

async function buildWorksheet(readerId: number, limit: number, output: string) {
  const [digest] = await sql<{ id: number; day: string }[]>`
    select id::int, day::text from dailynews.digests
     where reader_id=${readerId} order by day desc limit 1`;
  if (!digest) throw new Error("No edition for this reader");

  const rows = await sql<{
    itemId: number;
    position: number;
    title: string;
    source: string;
    topic: string | null;
    url: string;
    summary: string;
    summaryDocument: unknown;
  }[]>`
    select di.item_id::int as "itemId", di.position::int, di.title,
           s.label as source, t.label as topic, i.url,
           coalesce(di.summary, '') as summary,
           di.summary_document as "summaryDocument"
      from dailynews.digest_items di
      join dailynews.items i on i.id=di.item_id
      join dailynews.sources s on s.id=i.source_id
 left join dailynews.scores sc on sc.item_id=coalesce(i.dup_of, i.id)
 left join dailynews.topics t on t.id=sc.topic_id
     where di.digest_id=${digest.id}
     order by di.position, di.item_id`;
  const cards = rows.flatMap((row): EvaluationSource[] => {
    const reading = parseStoredReading(row.summaryDocument);
    return reading?.status === "verified" ? [{
      itemId: row.itemId,
      position: row.position,
      title: row.title,
      source: row.source,
      topic: row.topic,
      url: row.url,
      summary: row.summary,
      reading,
    }] : [];
  });
  if (!cards.length) throw new Error("Latest edition has no verified generative cards");

  const worksheet: EvaluationWorksheet = {
    version: 1,
    createdAt: new Date().toISOString(),
    readerId,
    editionDay: digest.day,
    protocol: {
      answerLimitSeconds: 60,
      instructions: [
        "Fill sourceReview before the reader sees the card.",
        "Show one card without the original article, then ask for an answer after 60 seconds.",
        "Record the answer verbatim before marking any boolean outcome.",
        "Do not compare forms until at least four completed reviews exist for a form.",
      ],
    },
    cards: selectEvaluationCards(cards, Math.min(limit, cards.length)),
  };
  writeFileSync(output, JSON.stringify(worksheet, null, 2), { mode: 0o600 });
  const markdownOutput = output.replace(/\.json$/u, ".md");
  writeFileSync(markdownOutput, markdown(worksheet), { mode: 0o600 });
  console.log(JSON.stringify({ readerId, day: digest.day, cards: worksheet.cards.length, output, markdown: markdownOutput }));
}

async function main() {
  const reportFile = argument("--report");
  if (reportFile) {
    const worksheet = JSON.parse(readFileSync(resolvePath(reportFile), "utf8")) as EvaluationWorksheet;
    if (worksheet.version !== 1 || !Array.isArray(worksheet.cards)) throw new Error("Not a reading evaluation worksheet");
    const output = argument("--out") ?? resolvePath(reportFile).replace(/\.json$/u, "-report.md");
    writeFileSync(output, report(worksheet), { mode: 0o600 });
    console.log(JSON.stringify({ report: output, ...summarizeEvaluation(worksheet) }));
    return;
  }

  const readerId = Number(argument("--reader"));
  const limit = Number(argument("--limit") ?? 12);
  if (!Number.isSafeInteger(readerId) || readerId <= 0) throw new Error("Usage: reading-evaluate.ts --reader <id> [--limit 10..15] [--out /tmp/file.json]");
  if (!Number.isSafeInteger(limit) || limit < 10 || limit > 15) throw new Error("Evaluation limit must be between 10 and 15");
  const output = argument("--out") ?? `/tmp/dailynews-reading-evaluation-${readerId}-${Date.now()}.json`;
  await buildWorksheet(readerId, limit, resolvePath(output));
}

main()
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => sql.end());
