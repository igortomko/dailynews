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
 * Главное, что здесь доказывается после перехода на многих читателей:
 * отбор, лента и калибровка одного не видят ничего чужого. Эта поломка
 * не падает — она показывает соседскую ленту вовремя и без ошибок.
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
  // Считаем не фиксированное число, а что повтор не задвоил: количество
  // источников растёт с каждой миграцией, и зашитое число устареет молча.
  const [{ count }] = (await db.query<{ count: number }>(
    "select count(*)::int as count from dailynews.sources",
  )).rows;
  const seeded = (sqlText.match(/^\s*\('(rss|reddit|hackernews|x|telegram)'/gm) ?? []).length;
  assert.equal(count, seeded, `источников ${count}, в миграциях ${seeded} — повтор задвоил`);
  const [{ owners }] = (await db.query<{ owners: number }>(
    "select count(*)::int as owners from dailynews.readers",
  )).rows;
  assert.equal(owners, 1, `читателей после двух прогонов ${owners} — перенос задвоил`);
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
  const readers = await import("../src/lib/readers");
  const { markDuplicates } = await import("../pipeline/dedup");
  const { candidates, selectSurvivors, targetsOf } = await import("../pipeline/select");
  const { normalizeTitle, canonUrl } = await import("../pipeline/normalize");
  const { DEFAULT_WEIGHTS } = await import("../src/lib/types");

  try {
    // --- каталог из 0003 доехал ---------------------------------------------
    const topics = await readers.catalogTopics();
    const sources = await queries.getSources();
    assert.ok(topics.length >= 6, `тем ${topics.length}, ожидалось не меньше 6`);
    assert.ok(sources.length >= 20, `источников ${sources.length}`);
    // Reddit заведён, но выключен: заявку на Data API можно подать позже,
    // а на источники ссылаются уже собранные материалы.
    const reddit = sources.filter((s) => s.kind === "reddit");
    assert.ok(reddit.length > 0, "источники Reddit должны остаться в каталоге");
    assert.ok(reddit.every((s) => !s.active), "источники Reddit должны быть выключены");
    assert.ok(sources.some((s) => s.kind === "x" && s.active), "источники X должны быть включены");
    console.log(`  темы: ${topics.length}, источники: ${sources.length}`);

    // --- перенос читателя из profile ------------------------------------------
    // Строка profile была живой: контекст, веса, пройденный онбординг.
    // Миграция обязана её перенести, а не обнулить.
    const all = await readers.allReaders();
    assert.equal(all.length, 1, "после миграции должен быть ровно один читатель — владелец");
    const owner = all[0];
    assert.ok(owner.owner, "перенесённый читатель должен быть владельцем");
    assert.equal(owner.digest_size, 12);
    assert.equal(owner.complexity, 3, "сложность по умолчанию — середина шкалы");
    assert.equal(owner.style, "нейтральный", "манера по умолчанию");
    assert.ok(owner.reader_context.length > 0, "контекст читателя должен переехать, а не обнулиться");
    assert.equal(owner.onboarded_at, null, "онбординг не пройден — так и должно быть");
    assert.equal(owner.telegram_id, null, "владелец забирает строку сам, написав боту /start");
    assert.deepEqual(
      { ...owner.weights },
      DEFAULT_WEIGHTS,
      "веса по умолчанию в коде и в jsonb-дефолте колонки обязаны совпадать",
    );

    // Тариф заводит 0019_plan и ставит владельцу pro; 0020 увозит колонку
    // в readers. Перенос обязан довезти значение, а не выдать умолчание —
    // и обязан пережить базу, где колонки profile.plan нет вовсе.
    assert.equal(owner.plan, "pro", "тариф владельца должен переехать как есть");
    await assert.rejects(
      sql`update dailynews.readers set plan = 'platinum' where id = ${owner.id}`,
      /plan/,
      "ограничение тарифа должно переехать вместе с колонкой",
    );

    const ownerTopics = await readers.getReaderTopics(owner.id);
    assert.equal(ownerTopics.length, 6, `у владельца ${ownerTopics.length} тем, ожидалось 6`);
    assert.ok(ownerTopics.every((t) => t.weight > 0), "цель темы не может быть нулевой");
    // profile уехала целиком: таблица, которая ничего не делает, читается
    // следующим как работающая.
    const [{ gone }] = await sql<{ gone: number }[]>`
      select count(*)::int as gone from information_schema.tables
       where table_schema = 'dailynews' and table_name = 'profile'
    `;
    assert.equal(gone, 0, "profile должна исчезнуть, а не остаться пустой");
    console.log(`  перенос: владелец с ${ownerTopics.length} темами, profile убрана`);

    // --- второй читатель -------------------------------------------------------
    // telegram_id заведомо больше 2^31: драйвер отдаёт bigint строкой,
    // и сравнение в JS не совпало бы ни разу — вход отказывал бы молча.
    const BIG_TELEGRAM_ID = 7_446_123_987;
    const second = await readers.ensureReader(BIG_TELEGRAM_ID, "vera");
    assert.ok(!second.owner, "второй читатель не владелец");
    assert.equal(second.telegram_id, String(BIG_TELEGRAM_ID), "telegram_id должен пережить bigint");
    // Новый читатель начинает с бесплатного: платный источник не достаётся
    // тому, за кого ещё никто не платил.
    assert.equal(second.plan, "free", "новый читатель заводится на бесплатном тарифе");
    const again = await readers.ensureReader(BIG_TELEGRAM_ID, "vera-new");
    assert.equal(again.id, second.id, "повторный /start не должен заводить второго читателя");
    assert.equal(again.username, "vera-new", "username обновляется: его меняют в Telegram");
    assert.equal(
      again.kindle_sender, second.kindle_sender,
      "обратный адрес заморожен: его смена означает повторное одобрение в Amazon",
    );
    assert.equal(second.kindle_sender, "vera", "локальная часть берётся из username");
    // Занятое имя не должно доставаться второму: счётчик Amazon считается
    // по отправителю, и общий адрес отвалился бы разом у обоих.
    const clash = await readers.ensureReader(BIG_TELEGRAM_ID + 1, "vera");
    assert.equal(clash.kindle_sender, `vera-${clash.id}`, "занятый адрес получает номер читателя");
    await sql`delete from dailynews.readers where id = ${clash.id}`;
    // Адрес отправителя выдаётся и тому, кто вписал читалку раньше, чем
    // написал боту: иначе выпуск не уходит при сохранённом адресе и без
    // единой ошибки — отказ, неотличимый от «Amazon пока не доставил».
    await sql`update dailynews.readers set kindle_sender = null where owner`;
    await readers.freezeKindleSender(owner.id, null);
    const [withSender] = await sql<{ kindle_sender: string | null }[]>`
      select kindle_sender from dailynews.readers where owner
    `;
    assert.ok(withSender.kindle_sender, "обратный адрес должен выдаваться и без username");
    console.log(`  читатели: владелец и @${again.username}, адреса Kindle не сталкиваются`);

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

    // --- оценки и выпуски ------------------------------------------------------
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

    const topicBy = (slug: string) => {
      const topic = topics.find((t) => t.slug === slug);
      assert.ok(topic, `тема ${slug} не найдена в каталоге`);
      return topic;
    };

    const scored = [
      [ids[0], "ai-infra", "fact", 120],
      [ids[2], "energy", "fact", 95],
      [ids[3], "mental-health", "opinion", 60],
    ] as const;
    for (const [itemId, slug, kind, total] of scored) {
      await sql`
        insert into dailynews.scores (item_id, topic_id, total, confidence, axes, model)
        values (
          ${itemId}, ${topicBy(slug).id}, ${total}, 0.8,
          ${sql.json(axes(slug, kind) as unknown as Parameters<typeof sql.json>[0])}, 'jev-latest'
        )
      `;
    }

    /** Выпуск читателя: состав, скор и текст — всё его собственное. */
    const makeDigest = async (
      readerId: number,
      day: string,
      items: { id: number; total: number; title: string }[],
    ) => {
      const [digest] = await sql<{ id: number }[]>`
        insert into dailynews.digests (reader_id, day, intro, stats)
        values (${readerId}, ${day}, 'интро', '{}'::jsonb)
        on conflict (reader_id, day) do update set intro = excluded.intro
        returning id::int as id
      `;
      for (const [index, item] of items.entries()) {
        await sql`
          insert into dailynews.digest_items (digest_id, item_id, total, position, title, summary)
          values (${digest.id}, ${item.id}, ${item.total}, ${index + 1}, ${item.title}, 'S')
          on conflict (digest_id, item_id) do nothing
        `;
      }
      return digest.id;
    };

    const today = new Date().toISOString().slice(0, 10);
    // Владельцу — два материала, второму читателю — один, и подписи разные:
    // текст персонален, потому что язык и манера персональны.
    await makeDigest(owner.id, today, [
      { id: ids[0], total: 120, title: "Владелец: GPT-6" },
      { id: ids[2], total: 95, title: "Владелец: уран" },
    ]);
    await makeDigest(second.id, today, [{ id: ids[3], total: 60, title: "Vera: CBT" }]);

    // --- лента: каждому своя ----------------------------------------------------
    const ownerFeed = await queries.getFeed(owner.id, today);
    const secondFeed = await queries.getFeed(second.id, today);
    assert.equal(ownerFeed.length, 2, `в ленте владельца ${ownerFeed.length}, ожидалось 2`);
    assert.equal(secondFeed.length, 1, `в ленте второго ${secondFeed.length}, ожидался 1`);
    assert.equal(ownerFeed[0].total, 120, "лента должна идти по убыванию скора");
    assert.equal(ownerFeed[0].title_ru, "Владелец: GPT-6", "заголовок берётся из выпуска читателя");
    assert.equal(secondFeed[0].title_ru, "Vera: CBT");
    assert.ok(
      !ownerFeed.some((item) => String(item.id) === String(ids[3])),
      "материал из чужого выпуска не должен попасть в ленту",
    );
    assert.ok(
      !secondFeed.some((item) => String(item.id) === String(ids[0])),
      "второй читатель не должен видеть выпуск владельца",
    );
    assert.equal(typeof ownerFeed[0].axes, "object", "axes должны прийти объектом, а не строкой");
    // Двойное кодирование не видно на чтении, но ломает извлечение осей в SQL.
    const [stored] = await sql<{ kind: string | null; shape: string }[]>`
      select axes->'kind'->>'choice' as kind, jsonb_typeof(axes) as shape
        from dailynews.scores limit 1
    `;
    assert.equal(stored.shape, "object", "axes должны лежать объектом, а не jsonb-строкой");
    assert.ok(stored.kind, "axes->'kind'->>'choice' не должен быть null");
    assert.equal(ownerFeed[0].axes.kind.choice, "fact", "axes должны разобраться из jsonb");
    assert.equal(ownerFeed[0].read_count, 0);
    assert.ok(
      !ownerFeed.some((item) => String(item.id) === String(ids[1])),
      "дубль не должен попасть в ленту",
    );
    console.log(`  лента: ${ownerFeed.length} у владельца, ${secondFeed.length} у второго, тексты разные`);

    // --- чтения и калибровка: не складываются с чужими ---------------------------
    await sql`
      insert into dailynews.reads (reader_id, item_id, event, score_snap, conf_snap)
      values (${owner.id}, ${ids[0]}, 'opened', 120, 0.8),
             (${owner.id}, ${ids[0]}, 'outbound', 120, 0.8),
             (${second.id}, ${ids[3]}, 'opened', 60, 0.8)
    `;
    const afterRead = await queries.getFeed(owner.id, today);
    assert.equal(afterRead[0].read_count, 2, "счётчик чтений должен вырасти");

    const ownerCalibration = await queries.getCalibration(owner.id);
    const secondCalibration = await queries.getCalibration(second.id);
    assert.equal(ownerCalibration.totals.shown, 2);
    assert.equal(ownerCalibration.totals.opened, 1);
    assert.equal(ownerCalibration.totals.days, 1);
    assert.equal(secondCalibration.totals.shown, 1, "у второго свой знаменатель");
    assert.equal(secondCalibration.totals.opened, 1);
    assert.ok(ownerCalibration.byScore.length > 0, "разбивка по скору не должна быть пустой");
    assert.ok(ownerCalibration.byConfidence.length > 0, "разбивка по уверенности не должна быть пустой");
    console.log(
      `  калибровка: ${ownerCalibration.totals.opened}/${ownerCalibration.totals.shown} у владельца, ` +
      `${secondCalibration.totals.opened}/${secondCalibration.totals.shown} у второго`,
    );

    // --- отбор: своё не повторяется, чужое не исчезает ---------------------------
    // Самая дорогая ошибка многопользовательского отбора: первый прогнавшийся
    // читатель вычерпывает поток, а остальные получают остатки. Выпуск при
    // этом приходит вовремя и выглядит осмысленным.
    // Все источники каталога: здесь проверяется разделение читателей,
    // а предел тарифа по источникам — в npm test, на чистых функциях.
    const everySource = sources.map((entry) => entry.id);
    const ownerCandidates = await candidates(sql, owner.id, everySource);
    const secondCandidates = await candidates(sql, second.id, everySource);
    const idsOf = (list: { id: number }[]) => new Set(list.map((row) => String(row.id)));

    assert.ok(
      !idsOf(ownerCandidates).has(String(ids[0])),
      "материалы из собственного выпуска не должны отбираться снова",
    );
    assert.ok(
      idsOf(ownerCandidates).has(String(ids[3])),
      "материал, ушедший другому читателю, обязан остаться кандидатом",
    );
    assert.ok(
      idsOf(secondCandidates).has(String(ids[0])),
      "второй читатель не должен доедать остатки за первым",
    );
    assert.ok(
      !idsOf(secondCandidates).has(String(ids[3])),
      "свой вчерашний выпуск второму читателю повторять нельзя",
    );
    assert.ok(
      !idsOf(ownerCandidates).has(String(ids[1])),
      "дубль не должен попадать в кандидаты",
    );
    console.log("  отбор: своё не повторяется, чужое остаётся доступным");

    // --- здоровье источников --------------------------------------------------
    // Источник, отвечающий 200 и отдающий ноль, — самая незаметная поломка
    // в ленте. Отдача считается из items, scores и digests, и считать её надо
    // ровно здесь: один неверный join — и полезный источник выглядит пустым.
    const health = await queries.getSourceHealth();
    assert.equal(health.length, sources.length, "в отдаче должны быть все источники, включая пустые");
    const used = health.find((row) => row.id === source.id)!;
    assert.equal(used.items, 4, `материалов ${used.items}, вставлено 4`);
    assert.equal(used.duplicates, 1, "перепечатка должна попасть в долю дублей");
    assert.equal(used.in_digest, 3, `в дайджест дошло ${used.in_digest}, ожидалось 3`);
    assert.equal(used.mean_score, 91.7, `средний скор ${used.mean_score}, ожидалось 91.7`);
    const empty = health.find((row) => row.id !== source.id)!;
    assert.equal(empty.items, 0, "источник без материалов показывает ноль, а не выпадает из списка");
    assert.equal(empty.silent_days, null, "без отметки тишины дней тишины нет");

    // Тишина отмечается временем: прогон могут запустить дважды за сутки,
    // и счётчик посчитал бы два дня за один.
    await sql`update dailynews.sources set silent_since = now() - interval '4 days' where id = ${empty.id}`;
    const afterSilence = await queries.getSourceHealth();
    assert.equal(
      afterSilence.find((row) => row.id === empty.id)!.silent_days,
      4,
      "дни тишины считаются от отметки",
    );
    console.log(`  отдача источника: ${used.items} → ${used.in_digest} в дайджесте, скор ${used.mean_score}`);

    // --- новые виды источников ------------------------------------------------
    // Ограничение переименовано намеренно: переопределение под прежним именем
    // проверка формы схемы не видит, и 0018 уже проскочил так молча.
    await sql`
      insert into dailynews.sources (kind, label, url)
      values ('telegram', 'канал', 'durov')
    `;
    await assert.rejects(
      sql`insert into dailynews.sources (kind, label, url) values ('carrier-pigeon', 'x', 'y')`,
      /sources_kind_known/,
      "неизвестный вид источника должен отвергаться ограничением с новым именем",
    );
    await sql`
      insert into dailynews.sources (kind, label, url)
      values ('email', 'рассылка', 'letters@example-letter.test')
    `;
    console.log("  виды источников: telegram и email приняты, выдуманный отвергнут");

    // --- сверка формы схемы видит переопределение ------------------------------
    // Ограничение, переопределённое под тем же именем, по имени неотличимо
    // от применённого: 0018 так и проскочил. Теперь сверяется и содержимое.
    const { schemaGaps } = await import("./schema-gap");
    assert.deepEqual(await schemaGaps(sql), [], "на полной схеме расхождений быть не должно");

    // Откатываем ограничение к версии 0021 — как если бы 0022 не применили.
    await sql`delete from dailynews.sources where kind = 'email'`;
    await sql`alter table dailynews.sources drop constraint sources_kind_known`;
    await sql`
      alter table dailynews.sources add constraint sources_kind_known
        check (kind in ('rss', 'hackernews', 'reddit', 'x', 'telegram'))
    `;
    const stale = await schemaGaps(sql);
    assert.ok(
      stale.some((gap) => gap.name === "sources_kind_known"),
      "неприменённое переопределение должно называться расхождением, а не проходить молча",
    );
    await sql`alter table dailynews.sources drop constraint sources_kind_known`;
    await sql`
      alter table dailynews.sources add constraint sources_kind_known
        check (kind in ('rss', 'hackernews', 'reddit', 'x', 'telegram', 'email'))
    `;
    console.log("  сверка схемы: переопределённое ограничение больше не проходит молча");

    // --- бюджет тем -----------------------------------------------------------
    // Круг по темам раздавал места строго поровну: у живого дайджеста на
    // двадцать материалов выходило 3-3-3-3-3-3, и тема в фокусе получала
    // столько же, сколько тема, которую читатель просил пореже. Отказ был
    // неотличим от работы — дайджест приходил полный и осмысленный, просто
    // не о том. Поэтому проверяется настоящий отбор, а не пересказ.
    //
    // Цели нарочно не круглые: на 11-6-3 ошибка в порядке сортировки могла
    // бы остаться незаметной.
    const budget = [
      { topic: topicBy("ai-infra"), target: 11 },
      { topic: topicBy("design"), target: 6 },
      { topic: topicBy("blockchain"), target: 3 },
    ];
    // Интересы задаём целиком: остаточная тема из каталога забрала бы место
    // по своей прежней цели, и проверка говорила бы не о том, что проверяет.
    await sql`delete from dailynews.reader_topics where reader_id = ${owner.id}`;
    for (const { topic, target } of budget) {
      await sql`
        insert into dailynews.reader_topics (reader_id, topic_id, weight, position)
        values (${owner.id}, ${topic.id}, ${target}, ${topic.position})
      `;
    }
    // Материалов должно быть заметно больше, чем мест: при дефиците проходят
    // все, и любые цели дают одинаковую картину — проверка прошла бы и на
    // сломанном отборе.
    for (const { topic } of budget) {
      for (let n = 0; n < 20; n++) {
        const url = `https://${topic.slug}.example.com/${n}`;
        const [row] = await sql<{ id: number }[]>`
          insert into dailynews.items (source_id, url, url_canon, title, title_norm, excerpt)
          values (
            ${source.id}, ${url}, ${url}, ${`${topic.label} материал ${n}`},
            ${`${topic.slug}-${n}`}, ''
          )
          returning id
        `;
        // Оси разные, а не одинаковые: скор считается из них весами
        // читателя, и на одинаковых осях порядок внутри темы держался бы
        // на случайности, а проверка прошла бы и на сломанном отборе.
        await sql`
          insert into dailynews.scores (item_id, topic_id, total, confidence, axes, model)
          values (
            ${row.id}, ${topic.id}, ${100 - n}, 0.8,
            ${sql.json(
              axes(topic.slug, "fact", { clickbait: { noul: n / 40 } }) as unknown as Parameters<typeof sql.json>[0],
            )},
            'jev-latest'
          )
        `;
      }
    }

    const budgetTargets = targetsOf(await readers.getReaderTopics(owner.id));
    const survivors = await selectSurvivors(
      sql, owner.id, owner.weights, budgetTargets, 20, everySource,
    );
    assert.equal(survivors.length, 20, "отбор должен отдать ровно digest_size");
    for (const { topic, target } of budget) {
      const got = survivors.filter((s) => s.topic_label === topic.label).length;
      assert.equal(got, target, `${topic.label}: просили ${target}, отбор дал ${got}`);
    }
    // Внутри темы порядок по скору остаётся: бюджет решает «сколько»,
    // а не «какие».
    const best = survivors.filter((s) => s.topic_label === budget[0].topic.label);
    assert.ok(
      best[0].total > best[1].total,
      "внутри темы первым должен идти лучший по скору",
    );
    console.log(`  бюджет тем: ${budget.map((b) => b.target).join("-")} — выполнен точно`);

    // Убранная тема не должна уносить свой прежний бюджет: оценки,
    // сделанные до этого, живут ещё двое суток, и всё это время
    // убранная из ленты тема забирала бы одиннадцать мест из двадцати.
    await sql`
      delete from dailynews.reader_topics
       where reader_id = ${owner.id} and topic_id = ${budget[0].topic.id}
    `;
    const afterOff = await selectSurvivors(
      sql, owner.id, owner.weights, targetsOf(await readers.getReaderTopics(owner.id)), 20,
      everySource,
    );
    const offCount = afterOff.filter((s) => s.topic_label === budget[0].topic.label).length;
    assert.ok(
      offCount <= 2,
      `убранная тема взяла ${offCount} мест — бюджет должен гаснуть вместе с темой`,
    );
    assert.ok(offCount > 0, "материалы убранной темы не выбрасываются совсем");
    console.log(`  убранная тема: ${offCount} мест вместо ${budget[0].target}`);

    // Веса персональны: у второго читателя те же материалы и другой порядок.
    await sql`
      insert into dailynews.reader_topics (reader_id, topic_id, weight, position)
      values (${second.id}, ${budget[1].topic.id}, 20, 1)
      on conflict (reader_id, topic_id) do update set weight = excluded.weight
    `;
    const secondSurvivors = await selectSurvivors(
      sql, second.id, second.weights, targetsOf(await readers.getReaderTopics(second.id)), 20,
      everySource,
    );
    const secondShare = secondSurvivors.filter((s) => s.topic_label === budget[1].topic.label).length;
    assert.ok(
      secondShare > survivors.filter((s) => s.topic_label === budget[1].topic.label).length,
      "цели второго читателя должны решать его выпуск, а не цели первого",
    );
    console.log(`  цели персональны: ${budget[1].topic.label} — ${secondShare} мест у второго`);

    // --- потолок расходов -------------------------------------------------------
    assert.equal(await readers.spentToday(second.id), 0, "новый читатель ничего не потратил");
    await readers.recordCall({
      readerId: second.id, stage: "digest", model: "gemini", tokensIn: 1000, costUsd: 0.01,
    });
    await readers.recordCall({
      readerId: null, stage: "score", model: "jev", tokensIn: 5000, costUsd: 0.2,
    });
    const spent = await readers.spentToday(second.id);
    assert.ok(Math.abs(spent - 0.01) < 1e-6, `потрачено ${spent}, ожидалось 0.01`);
    assert.equal(
      await readers.spentToday(owner.id), 0,
      "общий этап не должен ложиться на счёт отдельного читателя",
    );
    console.log(`  потолок: свой счёт у каждого, общий этап не на читателе`);

    // Список в форме предлагает до ста. Разъедется с ограничением колонки —
    // и выбор «100» вернёт ошибку там, где читатель ничего не нарушал.
    const { MAX_DIGEST } = await import("../src/lib/topic-budget");
    await sql`update dailynews.readers set digest_size = ${MAX_DIGEST} where id = ${owner.id}`;
    await assert.rejects(
      sql`update dailynews.readers set digest_size = ${MAX_DIGEST + 1} where id = ${owner.id}`,
      /digest_size/,
      "за потолком список предлагать не должен, а база — принимать",
    );
    await sql`update dailynews.readers set digest_size = 12 where id = ${owner.id}`;
    console.log(`  размер дайджеста: ${MAX_DIGEST} проходит, ${MAX_DIGEST + 1} отвергается`);

    // Ноль в цели уронил бы отбор делением на ноль, а не спрятал тему.
    await assert.rejects(
      sql`update dailynews.reader_topics set weight = 0 where reader_id = ${owner.id}`,
      /weight/,
      "нулевая цель должна отвергаться базой",
    );
    console.log("  цель темы: ноль запрещён ограничением");

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
