/**
 * Прогон схемы и всех запросов на настоящем Postgres в процессе (PGlite),
 * выставленном по обычному протоколу — поэтому запросы берутся из
 * src/lib/queries.ts как есть, без копии текста SQL.
 *
 * Смысл: общая база brasil-products не место для проверки DDL. У ошибки
 * там нет радиуса «только мой проект».
 *
 *   npx tsx db/verify.ts
 *
 * Чего проверка НЕ покрывает: сами гранты. Роль и её настройки здесь
 * заводятся, но выданные права по инфра-документу положено читать из
 * каталога живого инстанса, а не из текста миграции.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = 55432;

async function main() {
  const db = await PGlite.create({ extensions: { pg_trgm } });

  // Схема extensions и роль products_reader на Supabase уже есть.
  // Без них 0001 спотыкается не на своей ошибке.
  await db.exec(`create schema if not exists extensions; create role products_reader;`);

  // Из каталога, а не списком: перечисленные вручную миграции рано или
  // поздно расходятся с тем, что лежит в папке, и новая проскакивает мимо.
  const migrations = readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).sort();
  const sqlText = migrations
    .map((file) => readFileSync(`db/migrations/${file}`, "utf8"))
    .join("\n");

  // Склейкой, а не по файлам: именно так они применяются в SQL Editor
  // одной вставкой, и проверять надо ровно то, что уходит в базу.
  await db.exec(sqlText);
  console.log(`  применено: ${migrations.join(", ")}`);

  // Повторный прогон не должен ни падать, ни задваивать каталог:
  // миграции написаны идемпотентными, и это единственное, что доказуемо.
  await db.exec(sqlText);
  const [{ count }] = (await db.query<{ count: number }>(
    "select count(*)::int as count from dailynews.sources",
  )).rows;
  assert.equal(count, 27, `после повторного прогона источников ${count}, ожидалось 27`);
  console.log("  повторный прогон не задваивает");

  const [role] = (await db.query<{ search_path: string; limit: number }>(
    `select rolconfig::text as search_path, rolconnlimit as "limit"
       from pg_roles where rolname = 'dailynews_bot'`,
  )).rows;
  assert.ok(role.search_path.includes("dailynews"), "search_path роли должен быть прибит к схеме");
  assert.equal(role.limit, 10, "лимит соединений роли должен быть 10");
  console.log(`  роль: search_path прибит, лимит ${role.limit}`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
  await server.start();
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`;
  process.env.DB_POOL_MAX = "1";

  // queries.ts помечен server-only, чтобы не уехать в клиентский бандл.
  // Здесь он исполняется на сервере, просто не внутри Next, — подменяем
  // заглушку из самого пакета вместо того, чтобы снимать защиту из кода.
  const { createRequire } = await import("node:module");
  const require_ = createRequire(import.meta.url);
  const Module = require_("node:module") as any;
  // Путь берём до установки патча: иначе resolve внутри патча зовёт сам себя.
  const emptyStub = require_.resolve("server-only").replace(/index\.js$/, "empty.js");
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...rest: unknown[]) {
    return request === "server-only" ? emptyStub : resolve.call(this, request, ...rest);
  };

  // Импорт после DATABASE_URL: модуль db.ts читает его на загрузке.
  const { sql } = await import("../src/lib/db");
  const queries = await import("../src/lib/queries");
  const { markDuplicates } = await import("../pipeline/dedup");
  const { normalizeTitle, canonUrl } = await import("../pipeline/normalize");

  try {
    // --- каталог из 0003 доехал ---------------------------------------------
    const topics = await queries.getTopics();
    const sources = await queries.getSources();
    assert.ok(topics.length >= 6, `тем ${topics.length}, ожидалось не меньше 6`);
    assert.ok(sources.length >= 20, `источников ${sources.length}`);
    assert.ok(sources.some((s) => s.kind === "x") === false, "источников X в seed быть не должно");
    console.log(`  темы: ${topics.length}, источники: ${sources.length}`);

    const profile = await queries.getProfile();
    assert.equal(profile.id, 1);
    assert.equal(profile.digest_size, 12);
    assert.ok(profile.weights.topic === 40, "веса должны прийти из jsonb-дефолта");
    assert.equal(profile.onboarded_at, null, "онбординг не пройден — так и должно быть");

    // --- вставка потока ------------------------------------------------------
    const [source] = sources;
    const rows = [
      ["https://a.example.com/gpt6?utm_source=hn", "OpenAI ships GPT-6 with 10x context"],
      ["https://b.example.com/gpt-6", "OpenAI Ships GPT-6 With 10x Context!"], // дубль по заголовку
      ["https://c.example.com/uranium", "Uranium spot price hits $140"],
      ["https://d.example.com/therapy", "New RCT on CBT for insomnia"],
    ];
    const ids: number[] = [];
    for (const [url, title] of rows) {
      const [row] = await sql<{ id: number }[]>`
        insert into dailynews.items (source_id, url, url_canon, title, title_norm, excerpt, points, comments, published_at)
        values (${source.id}, ${url}, ${canonUrl(url)}, ${title}, ${normalizeTitle(title)}, '', 10, 5, now())
        returning id
      `;
      ids.push(row.id);
    }
    assert.equal(ids.length, 4);

    // --- дедуп ---------------------------------------------------------------
    const marked = await markDuplicates(sql, ids);
    assert.equal(marked, 1, `дублей помечено ${marked}, ожидался ровно один`);
    const [dup] = await sql<{ dup_of: number | null }[]>`
      select dup_of from dailynews.items where id = ${ids[1]}
    `;
    assert.equal(dup.dup_of, ids[0], "второй заголовок должен указывать на первый");
    console.log("  дедуп: перепечатка поймана по pg_trgm");

    // --- оценки и дайджест ---------------------------------------------------
    const axes = (topic: string, kind: string, extra = {}) => ({
      topic: { choice: topic, confidence: 0.9, probabilities: { [topic]: 0.9 } },
      kind: { choice: kind, confidence: 0.8, probabilities: {} },
      horizon: { choice: "years", confidence: 0.7, probabilities: {} },
      novelty: { score: 2, max: 2, confidence: 0.8 },
      specifics: { score: 2, max: 2, confidence: 0.9 },
      depth: { score: 1, max: 2, confidence: 0.6 },
      actionable: { noul: 0.3 },
      clickbait: { noul: 0.1 },
      ...extra,
    });

    const scored = [
      [ids[0], "ai-infra", "fact", 120],
      [ids[2], "energy", "fact", 95],
      [ids[3], "mental-health", "opinion", 60],
    ] as const;
    for (const [itemId, slug, kind, total] of scored) {
      const topic = topics.find((t) => t.slug === slug)!;
      await sql`
        insert into dailynews.scores (item_id, topic_id, total, confidence, axes, model)
        values (
          ${itemId}, ${topic.id}, ${total}, 0.8,
          ${sql.json(axes(slug, kind) as unknown as Parameters<typeof sql.json>[0])}, 'jev-latest'
        )
      `;
      await sql`update dailynews.items set title_ru = 'RU', summary = 'S' where id = ${itemId}`;
    }
    await sql`
      insert into dailynews.digests (day, intro, item_ids, stats)
      values (current_date, 'интро', ${scored.map((s) => s[0])}, '{}'::jsonb)
    `;

    // --- лента ---------------------------------------------------------------
    const feed = await queries.getFeed();
    assert.equal(feed.length, 3, `в ленте ${feed.length}, ожидалось 3`);
    assert.equal(feed[0].total, 120, "лента должна идти по убыванию скора");
    assert.ok(feed[0].topic_slug === "ai-infra");
    assert.equal(typeof feed[0].axes, "object", "axes должны прийти объектом, а не строкой");
    // Двойное кодирование не видно на чтении, но ломает извлечение осей в SQL.
    const [stored] = await sql<{ kind: string | null; shape: string }[]>`
      select axes->'kind'->>'choice' as kind, jsonb_typeof(axes) as shape
        from dailynews.scores limit 1
    `;
    assert.equal(stored.shape, "object", "axes должны лежать объектом, а не jsonb-строкой");
    assert.ok(stored.kind, "axes->'kind'->>'choice' не должен быть null");
    assert.equal(feed[0].axes.kind.choice, "fact", "axes должны разобраться из jsonb");
    assert.equal(feed[0].read_count, 0);
    assert.ok(!feed.some((item) => item.id === ids[1]), "дубль не должен попасть в ленту");
    console.log(`  лента: ${feed.length} материала, порядок по скору`);

    // --- чтения и калибровка -------------------------------------------------
    await sql`
      insert into dailynews.reads (item_id, event, score_snap, conf_snap)
      values (${ids[0]}, 'opened', 120, 0.8), (${ids[0]}, 'outbound', 120, 0.8)
    `;
    const afterRead = await queries.getFeed();
    assert.equal(afterRead[0].read_count, 2, "счётчик чтений должен вырасти");

    const calibration = await queries.getCalibration();
    assert.equal(calibration.totals.shown, 3);
    assert.equal(calibration.totals.opened, 1);
    assert.equal(calibration.totals.days, 1);
    assert.ok(calibration.byScore.length > 0, "разбивка по скору не должна быть пустой");
    assert.ok(calibration.byConfidence.length > 0, "разбивка по уверенности не должна быть пустой");
    const opened = calibration.byScore.find((row) => row.opened > 0);
    assert.ok(opened, "открытый материал должен попасть в корзину");
    console.log(`  калибровка: ${calibration.totals.opened}/${calibration.totals.shown}, корзин ${calibration.byScore.length}`);

    // Повторный отбор не должен предлагать уже отправленное.
    const again = await sql<{ id: number }[]>`
      select i.id from dailynews.scores sc
        join dailynews.items i on i.id = sc.item_id
       where i.dup_of is null
         and not exists (select 1 from dailynews.digests d where i.id = any(d.item_ids))
    `;
    assert.equal(again.length, 0, "материалы из вчерашнего дайджеста не должны отбираться снова");
    console.log("  отбор: отправленное не повторяется");

    console.log("\nСхема и запросы проверены на настоящем Postgres.");
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
