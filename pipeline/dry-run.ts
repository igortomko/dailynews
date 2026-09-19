/**
 * Сухой прогон: настоящие источники, настоящий дедуп, база в процессе.
 * Не тратит ключ Jev, не пишет в общую базу, ничего не шлёт в Telegram.
 *
 *   npx tsx pipeline/dry-run.ts
 *
 * Отвечает на вопрос, который нельзя проверить локальными тестами:
 * живы ли источники из каталога и сколько они дают на самом деле.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { Source } from "../src/lib/types";

const PORT = 55434;

async function main() {
  process.env.DAILYNEWS_DRY_RUN = "1";

  const db = await PGlite.create({ extensions: { pg_trgm } });
  // Схема extensions и роль products_reader на Supabase уже есть.
  await db.exec(`create schema if not exists extensions; create role products_reader;`);
  // Из каталога, а не списком: перечисленные вручную миграции расходятся
  // с папкой, и новые источники молча не доезжают до прогона.
  for (const file of readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(`db/migrations/${file}`, "utf8"));
  }

  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
  await server.start();
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`;
  process.env.DB_POOL_MAX = "1";

  const require_ = createRequire(import.meta.url);
  const Module = require_("node:module") as any;
  const emptyStub = require_.resolve("server-only").replace(/index\.js$/, "empty.js");
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...rest: unknown[]) {
    return request === "server-only" ? emptyStub : resolve.call(this, request, ...rest);
  };

  const { sql } = await import("../src/lib/db");
  const { collect } = await import("./run");
  const { markDuplicates } = await import("./dedup");

  try {
    const sources = await sql<Source[]>`select * from dailynews.sources where deleted_at is null order by kind, label`;
    console.log(`Источников включено: ${sources.length}\n`);

    const started = Date.now();
    const ids = await collect(sources);
    const duplicates = await markDuplicates(sql, ids);

    console.log(`\nСобрано: ${ids.length}, из них дублей: ${duplicates}`);
    console.log(`Время: ${Math.round((Date.now() - started) / 1000)} с\n`);

    const broken = await sql<{ label: string; last_error: string }[]>`
      select label, last_error from dailynews.sources
       where last_error is not null order by label
    `;
    if (broken.length > 0) {
      console.log("Не ответили:");
      for (const row of broken) console.log(`  ${row.label}: ${row.last_error}`);
      console.log("");
    }

    const silent = await sql<{ label: string }[]>`
      select label from dailynews.sources
       where last_error is null and last_count = 0 order by label
    `;
    if (silent.length > 0) {
      console.log(`Ответили, но без свежего: ${silent.map((r) => r.label).join(", ")}\n`);
    }

    const dupes = await sql<{ original: string; copy: string }[]>`
      select o.title as original, d.title as copy
        from dailynews.items d join dailynews.items o on o.id = d.dup_of
       limit 10
    `;
    if (dupes.length > 0) {
      console.log("Поймано дублей (показано до десяти):");
      for (const row of dupes) {
        console.log(`  ${row.original.slice(0, 60)}`);
        console.log(`  = ${row.copy.slice(0, 60)}\n`);
      }
    }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
    await server.stop();
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
