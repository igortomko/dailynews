/**
 * Сухой прогон: настоящие источники, настоящий дедуп, база в процессе.
 * Не тратит ключ Jev, не пишет в общую базу, ничего не шлёт в Telegram.
 *
 *   npx tsx pipeline/dry-run.ts
 *   npx tsx pipeline/dry-run.ts --channel https://www.youtube.com/@veritasium
 *
 * Отвечает на вопрос, который нельзя проверить локальными тестами:
 * живы ли источники из каталога и сколько они дают на самом деле.
 *
 * С `--channel` в базу процесса добавляется один канал и его свежие ролики
 * проходят весь путь: субтитры, конспект, запись в items. Это единственный
 * способ увидеть расшифровку целиком, не трогая ленту живого читателя, —
 * и единственная часть сухого прогона, которая тратит деньги (около цента
 * на ролик), поэтому она за флагом.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { assertOwn, startLocalPg } from "../db/free-port";
import type { Source } from "../src/lib/types";



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

  const local = await startLocalPg(db, (port) => new PGLiteSocketServer({ db, port, host: "127.0.0.1" }));
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${local.port}/postgres`;
  process.env.DB_POOL_MAX = "1";

  const require_ = createRequire(import.meta.url);
  const Module = require_("node:module") as {
    _resolveFilename(request: string, ...rest: unknown[]): string;
  };
  const emptyStub = require_.resolve("server-only").replace(/index\.js$/, "empty.js");
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...rest: unknown[]) {
    return request === "server-only" ? emptyStub : resolve.call(this, request, ...rest);
  };

  const { sql } = await import("../src/lib/db");
  // Своим же соединением: сокет PGlite обслуживает одно подключение,
  // и пробное рядом с рабочим оставляет сервер отдающим пустоту.
  await assertOwn(local, async (text) => (await sql.unsafe(text))[0] as { token?: string });
  const { collect, transcribeVideos } = await import("./run");
  const { markDuplicates } = await import("./dedup");
  const { discover } = await import("./discover");

  const channel = process.argv[process.argv.indexOf("--channel") + 1];
  if (process.argv.includes("--channel") && channel) {
    const discovered = await discover(channel);
    if (!discovered.ok) throw new Error(`фида по ${channel} не нашлось: ${discovered.error}`);
    const { found } = discovered;
    await sql`
      insert into dailynews.sources (kind, url, input_url, label)
      values (${found.kind}, ${found.url}, ${found.input_url}, ${found.label})
    `;
    console.log(`Канал добавлен в базу процесса: ${found.label} → ${found.url} (${found.fresh} свежих)\n`);
  }

  try {
    const sources = await sql<Source[]>`select * from dailynews.sources where deleted_at is null order by kind, label`;
    console.log(`Источников включено: ${sources.length}\n`);

    const started = Date.now();
    const ids = await collect(sources);
    const duplicates = await markDuplicates(sql, ids);

    if (process.argv.includes("--channel")) {
      const videos = await transcribeVideos();
      console.log(`\nРасшифровано роликов: ${videos.done}, потрачено $${videos.cost.toFixed(4)}`);
      const shown = await sql<{ title: string; excerpt: string; body: string | null }[]>`
        select title, excerpt, body from dailynews.items
         where url like '%youtu%' and excerpt <> '' order by id limit 3
      `;
      for (const row of shown) {
        console.log(`\n  ${row.title}`);
        console.log(`  конспект (${row.excerpt.length}): ${row.excerpt.slice(0, 220)}…`);
        console.log(`  пересказ: ${row.body ? `${row.body.length} знаков разметки` : "нет"}`);
      }
    }

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
    await local.stop();
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
