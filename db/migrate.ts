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
 * Что применять, решает форма схемы, а не журнал `dailynews.migrations`:
 * на журнале RLS, и роль приложения видит пустой список вместо отказа.
 * Миграции идемпотентны, поэтому лишний повтор безопасен — но гонять все
 * восемнадцать каждый раз незачем, и файлы с непустым разрывом видно сразу.
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

  // Накатываем все файлы подряд, а не только те, чьи разрывы видно.
  // Разрыв виден не у всякой миграции: 0018 снимает profile_digest_size_check
  // и ставит его же с новым потолком — по имени эти два неразличимы, и выбор
  // по разрывам пропустил бы её молча, оставив старое ограничение. Файлы
  // идемпотентны, это их прямое назначение.
  const needed = readdirSync("db/migrations").filter((file) => file.endsWith(".sql")).sort();
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
  try {
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
  const { columns, constraints } = promised();
  console.log(`колонок обещано: ${columns.length}, ограничений: ${constraints.length}`);
  console.log(`файлов в папке: ${readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).length}`);
} else {
  main().catch(async (error) => {
    console.error(error.message ?? error);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
}
