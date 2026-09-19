/**
 * Накатывает миграции, которых в базе ещё нет.
 *
 *   npx tsx --env-file=.env db/migrate.ts
 *
 * Отдельная строка подключения, а не рабочая: роль приложения намеренно
 * не владелец таблиц, и `alter table` отвечает ей `must be owner`. Класть
 * владельца в `DATABASE_URL` нельзя — им ходит и прогон, и веб, а он достаёт
 * соседние продукты общей базы. Поэтому `SUPABASE_DB_URL` живёт только
 * в локальном `.env` и в CI не уезжает.
 *
 * Что применять, решает журнал `dailynews.migrations`, прочитанный
 * владельческой строкой. Роль приложения его не видит — на журнале RLS,
 * и она получает пустой список вместо отказа, — но владелец RLS обходит,
 * и это единственный, кому журнал вообще нужен.
 *
 * Раньше здесь гнались все файлы подряд: «они идемпотентны, повтор безопасен».
 * На живой базе это оказалось неправдой. 0008 ставит на reads check без
 * событий `up` и `down`, которые заводит 0010, — и повторное применение 0008
 * падает на собственных данных: «check constraint is violated by some row».
 * Идемпотентен каждый файл по отдельности, а не их последовательность поверх
 * данных, которые накопились между ними.
 *
 * Форма схемы (`db/schema-gap.ts`) осталась, но второй меркой: ею сверяется
 * результат рабочей ролью. «Команда прошла» и «база изменилась» — разные
 * утверждения, и журнал отвечает только на первое.
 */
import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { promised, schemaGaps } from "./schema-gap";
import { sql } from "../src/lib/db";

const OWNER = process.env.SUPABASE_DB_URL;

async function main() {
  const gaps = await schemaGaps(sql);
  if (gaps.length === 0) {
    console.log("База знает всё, что обещают миграции. Накатывать нечего.");
    await sql.end();
    return;
  }

  console.log(`Базе не хватает ${gaps.length}:`);
  for (const gap of gaps) console.log(`  ${gap.kind} ${gap.name} — из ${gap.from}`);

  await sql.end();

  if (!OWNER) {
    console.error(
      "\n! SUPABASE_DB_URL не задан — под ролью приложения DDL запрещён.\n" +
      "  Положить владельческую строку: npx tsx scripts/env-set.ts SUPABASE_DB_URL\n" +
      "  Supabase → Settings → Database → Connection string → Session pooler, роль postgres.",
    );
    process.exit(1);
  }

  const owner = postgres(OWNER, { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 });
  const all = readdirSync("db/migrations").filter((file) => file.endsWith(".sql")).sort();
  let needed: string[] = [];
  try {
    // Журнал читаем владельцем: роль приложения его не видит из-за RLS.
    const applied = new Set(
      (await owner<{ name: string }[]>`select name from dailynews.migrations`).map((row) => row.name),
    );
    // Имя в журнале — имя файла без расширения: его пишет сама миграция
    // последней строкой. Разойдутся — файл будет накатываться каждый раз.
    needed = all.filter((file) => !applied.has(file.replace(/\.sql$/, "")));

    const foreign = [...applied].filter((name) => !all.includes(`${name}.sql`));
    if (foreign.length > 0) {
      // Запись без файла — миграция из чужой ветки, уже стоящая в базе.
      // Молчать о ней нельзя: её изменений нет ни в одной проверке.
      console.log(`\nВ журнале есть записи без файлов: ${foreign.join(", ")}`);
    }
    if (needed.length === 0) {
      console.log("\nВ журнале отмечены все файлы — накатывать нечего.");
    }

    for (const file of needed) {
      console.log(`\n→ ${file}`);
      await owner.unsafe(readFileSync(`db/migrations/${file}`, "utf8"));
      console.log("  применена");
    }
  } finally {
    await owner.end({ timeout: 10 }).catch(() => {});
  }

  // Проверяем результат той же меркой, что и до накатывания: «команда прошла»
  // и «база изменилась» — разные утверждения.
  const after = postgres(process.env.DATABASE_URL!, {
    prepare: false, ssl: { rejectUnauthorized: false }, max: 1,
  });
  const left = await schemaGaps(after as unknown as typeof sql);
  await after.end({ timeout: 10 }).catch(() => {});

  if (left.length > 0) {
    console.error(`\n! после накатывания не хватает ${left.length}:`);
    for (const gap of left) console.error(`  ${gap.kind} ${gap.name} — из ${gap.from}`);
    process.exit(1);
  }
  console.log(`\n✓ применено файлов: ${needed.length}, разрывов не осталось`);
}

// Разбор файлов нужен и без сети: так видно, что вообще обещано.
if (process.argv.includes("--list")) {
  const { tables, columns, constraints } = promised();
  console.log(
    `таблиц обещано: ${tables.length}, колонок: ${columns.length}, ` +
    `ограничений: ${constraints.length}`,
  );
  console.log(`файлов в папке: ${readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).length}`);
} else {
  main().catch(async (error) => {
    console.error(error.message ?? error);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
}
