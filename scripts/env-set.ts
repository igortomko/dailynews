/**
 * Вписывает одно значение в .env, не открывая файл редактором.
 *
 *   npx tsx scripts/env-set.ts REDDIT_CLIENT_ID
 *
 * Редактор держит копию файла и при сохранении возвращает её целиком —
 * один раз так уже потерялась строка подключения. Здесь правится ровно
 * одна строка, остальное читается и пишется обратно как есть.
 * Значение не печатается ни при вводе, ни после.
 */
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";

const KEY = process.argv[2];
if (!KEY || !/^[A-Z][A-Z0-9_]*$/.test(KEY)) {
  console.error("Укажи имя переменной, например: npx tsx scripts/env-set.ts REDDIT_CLIENT_ID");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

// Ввод не отображается: значение не должно остаться в истории терминала.
const output = process.stdout as NodeJS.WriteStream & { _writeToOutput?: (s: string) => void };
(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = function (s: string) {
  output.write(s.includes(KEY) ? s : "*".repeat(Math.max(0, s.length)));
};

rl.question(`${KEY} (ввод скрыт, Enter для отмены): `, (value) => {
  rl.close();
  process.stdout.write("\n");

  const trimmed = value.trim();
  if (!trimmed) {
    console.log("Отменено, файл не тронут.");
    process.exit(0);
  }

  const path = ".env";
  const text = readFileSync(path, "utf8");
  const line = `${KEY}=${trimmed}`;
  const pattern = new RegExp(`^${KEY}=.*$`, "m");

  writeFileSync(path, pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\n*$/, "\n")}${line}\n`);
  console.log(`${KEY}: записано (${trimmed.length} символов)`);
});
