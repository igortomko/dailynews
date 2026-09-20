/**
 * Переписать вчерашний дайджест новым промптом и сравнить числа со старым.
 *
 *   npx tsx --env-file=.env pipeline/prompt-replay.ts
 *   npx tsx --env-file=.env pipeline/prompt-replay.ts --complexity 2 --style телеграфный
 *
 * Зачем отдельный прогон. Правка промпта либо двигает ряд оценок, либо нет,
 * и на глаз это не видно: двенадцать описаний в день читаются нормально
 * при любой формулировке. Ждать сутки до следующего прогона, чтобы увидеть
 * одно число, — значит править промпт вслепую и по впечатлению.
 *
 * Сравнение честное: те же материалы, те же шесть вопросов, а старые оценки
 * уже лежат в базе рядом со старым текстом. Меняется только формулировка.
 *
 * Ничего не пишет: ни в digest_items, ни в digests, ни в Telegram. Стоит
 * около цента — один вызов дайджеста и по вопросу на описание.
 *
 * Читатель по умолчанию — владелец; другого берёт --reader <id>. Без явного
 * читателя переписывать было бы нечего: язык, сложность и манера персональны.
 */
import { sql } from "../src/lib/db";
import { getReader, allReaders } from "../src/lib/readers";
import type { Reader } from "../src/lib/types";
import { writeDigest, type Survivor } from "./digest";
import { effectiveVoice } from "../src/lib/lemon";
import { scoreSummaries, type SummaryQuality } from "./summary-quality";
import { readability } from "./lexicon";
import { DEFAULT_COMPLEXITY, DEFAULT_STYLE } from "../src/lib/voice";

type Stored = { id: number; title_ru: string; summary: string };

const flag = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
};

/** С командной строки приходит что угодно: «NaN из 5» в отчёте врал бы о том, что ушло в промпт. */
const asked = (value: string | number | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(1, Math.round(parsed))) : DEFAULT_COMPLEXITY;
};

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function report(label: string, scored: { total: number; axes: SummaryQuality["axes"] }[]) {
  const axis = (pick: (a: SummaryQuality["axes"]) => number) => mean(scored.map((row) => pick(row.axes)));
  console.log(
    `${label.padEnd(9)} ${mean(scored.map((r) => r.total)).toFixed(1).padStart(5)} из 85  ` +
    `самодост ${axis((a) => a.self_sufficient.score).toFixed(2)}  ` +
    `конкрет ${axis((a) => a.specifics.score).toFixed(2)}  ` +
    `связь ${axis((a) => a.reader_relevance.noul).toFixed(2)}  ` +
    `направл ${axis((a) => a.direction_clear.noul).toFixed(2)}  ` +
    `пересказ ${axis((a) => a.repeats_headline.noul).toFixed(2)}  ` +
    `оценки ${axis((a) => a.evaluative.noul).toFixed(2)}`,
  );
}

async function main() {
  const askedReader = Number(flag("reader"));
  const profile: Reader | undefined = Number.isInteger(askedReader) && askedReader > 0
    ? await getReader(askedReader)
    : (await allReaders()).find((reader) => reader.owner);
  if (!profile) {
    console.log("Читатель не найден — укажи --reader <id>.");
    await sql.end();
    return;
  }

  // Берём последний выпуск этого читателя: у его материалов уже есть
  // и текст, и оценки — это и есть база для сравнения.
  const survivors = await sql<(Survivor & { day: string })[]>`
    with last_day as (
      select id, day from dailynews.digests
       where reader_id = ${profile.id} order by day desc limit 1
    )
    select i.id, i.title, i.excerpt, i.url, s.label as source_label,
           coalesce(t.label, 'Прочее') as topic_label, di.total, sc.axes,
           last_day.day::text as day
      from last_day
      join dailynews.digest_items di on di.digest_id = last_day.id
      join dailynews.items i on i.id = di.item_id
      join dailynews.sources s on s.id = i.source_id
      join dailynews.scores sc on sc.item_id = i.id
 left join dailynews.topics t on t.id = sc.topic_id
  `;
  if (survivors.length === 0) {
    console.log("Ни одного дайджеста — сравнивать не с чем.");
    await sql.end();
    return;
  }

  // Старый текст лежит в выпуске читателя, а не в items: он написан
  // его языком, сложностью и манерой.
  const stored = await sql<Stored[]>`
    select di.item_id as id, di.title as title_ru, di.summary
      from dailynews.digests d
      join dailynews.digest_items di on di.digest_id = d.id
     where d.reader_id = ${profile.id}
       and d.day = ${survivors[0].day}::date
       and di.summary is not null and di.summary <> ''
  `;

  // Язык — по тарифу, как в самом прогоне: иначе повтор сравнивал бы
  // не тот текст, который читатель получил бы на самом деле.
  const voice = {
    ...effectiveVoice(profile),
    complexity: asked(flag("complexity") ?? profile.complexity),
    style: flag("style") ?? profile.style ?? DEFAULT_STYLE,
  };
  console.log(
    `День ${survivors[0].day}, материалов ${survivors.length}. ` +
    `Сложность ${voice.complexity} из 5, манера «${voice.style}».\n`,
  );

  const started = Date.now();
  const digest = await writeDigest(survivors, profile.reader_context, voice);
  const seconds = Math.round((Date.now() - started) / 1000);
  const fresh = await scoreSummaries(
    digest.items.map((item) => ({
      id: Number(item.id),
      title: item.title_ru,
      summary: item.summary,
    })),
    profile.reader_context,
  );

  // Старый текст переоцениваем сейчас, а не берём сохранённые числа:
  // формулировка вопроса могла с тех пор измениться, и тогда разница
  // между «было» и «стало» означала бы разницу вопросов, а не текста.
  const old = await scoreSummaries(
    stored.map((row) => ({ id: row.id, title: row.title_ru, summary: row.summary })),
    profile.reader_context,
  );

  console.log("");
  report("было", old.scored);
  report("стало", fresh.scored);
  // Качество без цены — половина сравнения: модель, выигравшая балл
  // за вчетверо больший счёт, проигрывает.
  console.log(
    `\nмодель ${digest.model}, рассуждение ${digest.reasoningEffort ?? "по умолчанию"}: ` +
    `${digest.usage.input} вх (${digest.usage.cached} из кэша), ` +
    `${digest.usage.output} вых (${digest.usage.reasoning} рассуждение), ` +
    `${digest.usage.requests} запроса, ${seconds} с`,
  );

  const before = stored.map((row) => readability(row.summary));
  const after = digest.items.map((item) => readability(item.summary));
  console.log(
    `\nсложность текста: было ${mean(before.map((r) => r.perSentence)).toFixed(1)} слов в предложении, ` +
    `${(mean(before.map((r) => r.longShare)) * 100).toFixed(0)}% длинных → ` +
    `стало ${mean(after.map((r) => r.perSentence)).toFixed(1)} и ` +
    `${(mean(after.map((r) => r.longShare)) * 100).toFixed(0)}%`,
  );

  // Худшие описания печатаем целиком: число говорит, что стало хуже,
  // но не говорит чем.
  const byScore = [...fresh.scored].sort((a, b) => a.total - b.total).slice(0, 3);
  const written = new Map(digest.items.map((item) => [Number(item.id), item]));
  console.log("\nТри худших из новых:");
  for (const row of byScore) {
    const item = written.get(row.item_id);
    if (!item) continue;
    console.log(`\n[${row.total.toFixed(0)}] ${item.title_ru}\n${item.summary}`);
  }

  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
