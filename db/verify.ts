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
import { TS_CONFIGS } from "../src/lib/search";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { assertOwn, startLocalPg } from "./free-port";
import { pendingArticles, SHORT_EXCERPT } from "../pipeline/enrich";
import { WINDOW_DAYS } from "../pipeline/select";
import { cardChars } from "../src/lib/reading-time";
import { otherSources, storyLines } from "../src/lib/story";
import { ru as RU_DICT } from "../src/lib/i18n/ru/index";
import { cleanupOf } from "../src/lib/source-health";
import { applyRules, rulesOf } from "../src/lib/rules";
import { toSlug } from "../src/lib/slug";
import { starterBySlug } from "../src/lib/starter-topics";



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
  // Пятнадцать с 0053: веб на сессионном пулере держит соединения тёплыми,
  // прогон берёт ещё пять через транзакционный, и десяти на двоих хватало
  // без запаса для скриптов.
  assert.equal(role.limit, 15, "лимит соединений роли должен быть 15");
  console.log(`  роль: search_path прибит, лимит ${role.limit}`);

  // Метка проверяется после подключения: свободный порт успевает занять
  // соседняя проверка из другого worktree, и клиент уходит к её базе.
  const local = await startLocalPg(db, (port) => new PGLiteSocketServer({ db, port, host: "127.0.0.1" }));
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${local.port}/postgres`;
  process.env.DB_POOL_MAX = "1";

  // queries.ts помечен server-only, чтобы не уехать в клиентский бандл.
  // Здесь он исполняется на сервере, просто не внутри Next, — подменяем
  // заглушку из самого пакета вместо того, чтобы снимать защиту из кода.
  const { createRequire } = await import("node:module");
  const require_ = createRequire(import.meta.url);
  const Module = require_("node:module") as {
    _resolveFilename(request: string, ...rest: unknown[]): string;
  };
  // Путь берём до установки патча: иначе resolve внутри патча зовёт сам себя.
  const emptyStub = require_.resolve("server-only").replace(/index\.js$/, "empty.js");
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...rest: unknown[]) {
    return request === "server-only" ? emptyStub : resolve.call(this, request, ...rest);
  };

  // Импорт после DATABASE_URL: модуль db.ts читает его на загрузке.
  const { sql } = await import("../src/lib/db");
  // Своим же соединением: сокет PGlite обслуживает одно подключение,
  // и пробное рядом с рабочим оставляет сервер отдающим пустоту.
  await assertOwn(local, async (text) => (await sql.unsafe(text))[0] as { token?: string });
  const queries = await import("../src/lib/queries");
  const readers = await import("../src/lib/readers");
  const { flattenDupChains, markDuplicates, shortlist } = await import("../pipeline/dedup");
  const { candidates, selectSurvivors, targetsOf } = await import("../pipeline/select");
  const { normalizeTitle, canonUrl } = await import("../pipeline/normalize");
  const { DEFAULT_WEIGHTS } = await import("../src/lib/types");

  try {
    /**
     * Намеренно отбитый запрос — и проверка, что поток после него цел.
     *
     * Сама поломка снята у истока (`dropStrayReady` в db/free-port.ts):
     * отбивая запрос, PGlite отвечал на `Parse`/`Execute` парой
     * `ErrorResponse` + `ReadyForQuery`, а второй `ReadyForQuery` присылал
     * на `Sync`. Лишний `Z` закрывал в postgres.js следующий запрос до того,
     * как пришли его строки, и дальше ответы ехали на один до конца прогона.
     *
     * Видно это было как мерцание: проверка падала в 16 прогонах из 60,
     * каждый раз в другом месте и каждый раз правдоподобно — «у владельца
     * 0 тем», «площадки читателя — только его», список несуществующих
     * расхождений схемы. Ни одно утверждение не было неверным, неверным был
     * ответ, который до него дошёл.
     *
     * Контрольный запрос остаётся сторожем: он стоит три микросекунды,
     * а без него возврат этой поломки — хоть из новой версии PGlite, хоть
     * из снятой правки — снова читался бы как «у владельца 0 тем» через
     * двести строк. Простой протокол (`sql.unsafe`, одно сообщение `Q`)
     * тоже остаётся: `ReadyForQuery` там полагается по спецификации,
     * то есть отказ идёт путём, который не зависит от правки вовсе.
     */
    const rejects = async (
      statement: string,
      /**
       * Регулярное выражение по тексту — или код SQLSTATE строкой.
       *
       * Код переживает и локаль кластера, и переписанное между версиями
       * сообщение; в самом тексте ошибки его нет, он лежит отдельным полем,
       * поэтому сверяется он не выражением, а проверкой.
       */
      pattern: RegExp | string,
      why: string,
      /** Значения для $1…$n: часть отказов бывает только у параметра. */
      params: Parameters<typeof sql.unsafe>[1] = [],
    ) => {
      await assert.rejects(
        sql.unsafe(statement, params),
        typeof pattern === "string"
          ? (error: unknown) => (error as { code?: string }).code === pattern
          : pattern,
        why,
      );
      const [alive] = await sql<{ v: string }[]>`select 'ok'::text as v`;
      assert.equal(
        alive?.v,
        "ok",
        `после отбитого запроса («${why}») обмен с базой разъехался: ` +
          "дальше проверять нечего, все ответы будут от соседних запросов",
      );
    };

    // --- каталог из 0003 доехал ---------------------------------------------
    const topics = await readers.catalogTopics();
    const sources = await queries.getSources();
    assert.ok(topics.length >= 6, `тем ${topics.length}, ожидалось не меньше 6`);
    assert.ok(sources.length > 0, `источников ${sources.length}`);
    // Состояний у источника два: заведён или убран. Reddit и X 0006 выключала,
    // 0031 убрала — включить их было нечем, прогон их не читал, а в списке
    // они выглядели живыми.
    assert.ok(
      !sources.some((s) => s.kind === "reddit" || s.kind === "x"),
      "выключенные виды убраны из каталога, а не лежат в нём третьим состоянием",
    );
    assert.ok(sources.every((s) => s.active), "у неубранных active всегда true — колонка больше ничего не значит");
    // Убраны, но не уничтожены: строки на месте, и материалы, которые на них
    // ссылаются, тоже.
    const [{ removed }] = await sql<{ removed: number }[]>`
      select count(*)::int as removed from dailynews.sources where deleted_at is not null`;
    assert.ok(removed > 0, "убранные источники остаются в базе вместе со своей историей");
    console.log(`  темы: ${topics.length}, источники: ${sources.length}, убрано ${removed}`);

    // --- перенос читателя из profile ------------------------------------------
    // Строка profile была живой: контекст, веса, пройденный онбординг.
    // Миграция обязана её перенести, а не обнулить.
    const all = await readers.allReaders();
    assert.equal(all.length, 1, "после миграции должен быть ровно один читатель — владелец");
    const owner = all[0];
    assert.ok(owner.owner, "перенесённый читатель должен быть владельцем");
    // 0040 перевела заказ в минуты: двенадцать карточек по полминуты —
    // это шесть минут чтения. Перенос обязан довезти прежний выбор, а не
    // выдать умолчание: читатель настраивал размер выпуска один раз.
    assert.equal(owner.digest_minutes, 6, "прежние 12 карточек — это шесть минут чтения");
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
    await rejects(
      `update dailynews.readers set plan = 'platinum' where id = ${owner.id}`,
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
    // Локальная часть — telegram_id, а не username: username читатель меняет
    // в Telegram когда захочет, а адрес после одобрения в Amazon заморожен
    // навсегда. Разъехавшись, они дали бы адрес, который ничего не значит.
    assert.equal(
      second.kindle_sender, String(BIG_TELEGRAM_ID),
      "локальная часть берётся из telegram_id",
    );
    // Двум читателям один адрес достаться не может: telegram_id уникален,
    // а счётчик Amazon считается по отправителю — общий адрес отвалился бы
    // разом у обоих.
    const other = await readers.ensureReader(BIG_TELEGRAM_ID + 1, "vera");
    assert.notEqual(other.kindle_sender, second.kindle_sender, "у соседа свой адрес");
    await sql`delete from dailynews.readers where id = ${other.id}`;
    // Адрес отправителя выдаётся и тому, кто вписал читалку раньше, чем
    // написал боту: иначе выпуск не уходит при сохранённом адресе и без
    // единой ошибки — отказ, неотличимый от «Amazon пока не доставил».
    await sql`update dailynews.readers set kindle_sender = null where owner`;
    await readers.freezeKindleSender(owner.id, null);
    const [withSender] = await sql<{ kindle_sender: string | null }[]>`
      select kindle_sender from dailynews.readers where owner
    `;
    assert.ok(withSender.kindle_sender, "обратный адрес должен выдаваться и без Telegram");

    // Одобренный адрес не меняется ничем: в Amazon записан именно он,
    // и смена означала бы, что письма исчезают без единой ошибки.
    await sql`update dailynews.readers set kindle_approved = true where owner`;
    const frozen = withSender.kindle_sender;
    await readers.freezeKindleSender(owner.id, BIG_TELEGRAM_ID + 500);
    const [after] = await sql<{ kindle_sender: string | null }[]>`
      select kindle_sender from dailynews.readers where owner
    `;
    assert.equal(after.kindle_sender, frozen, "после одобрения адрес заморожен");
    await sql`update dailynews.readers set kindle_approved = false where owner`;
    console.log(`  читатели: владелец и @${again.username}, адреса Kindle не сталкиваются`);

    // --- вставка потока ------------------------------------------------------
    const [source] = sources;
    const rows = [
      ["https://a.example.com/gpt6?utm_source=hn", "OpenAI ships GPT-6 with 10x context"],
      ["https://b.example.com/gpt-6", "OpenAI Ships GPT-6 With 10x Context!"], // дубль по заголовку
      ["https://c.example.com/uranium", "Uranium spot price hits $140"],
      ["https://d.example.com/therapy", "New RCT on CBT for insomnia"],
      // Серая зона: та же новость, но заголовок переписан целиком.
      // Триграммы такую пару не сводят — её разбирает вопрос к Jev.
      ["https://e.example.com/uranium", "Nuclear fuel costs climb as uranium tops $140 a pound"],
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
    assert.equal(ids.length, 5);

    // --- дедуп ---------------------------------------------------------------
    const marked = await markDuplicates(sql, ids);
    assert.equal(marked, 1, `дублей помечено ${marked}, ожидался ровно один`);
    const [dup] = await sql<{ dup_of: number | null }[]>`
      select dup_of from dailynews.items where id = ${ids[1]}
    `;
    assert.equal(dup.dup_of, ids[0], "второй заголовок должен указывать на первый");
    console.log("  дедуп: перепечатка поймана по pg_trgm");

    // Шортлист серой зоны — тот же запрос, что уходит в Jev, но без Jev.
    // Ломается он молча: нетипизированный массив уезжает в int мимо bigint,
    // а нестрогая верхняя граница погнала бы в вопрос уже помеченное.
    const grey = await shortlist(sql, ids);
    // Числами, а не строками: id приходит из bigint, и без каста в запросе
    // «#68 < #700» сравнивалось бы лексически и молча давало бы ложь.
    const num = ids.map(Number);
    assert.ok(
      grey.every((job) => typeof job.item.id === "number"),
      "id материала обязан приехать числом, а не строкой из bigint",
    );
    const uranium = grey.find((job) => job.item.id === num[4]);
    assert.ok(uranium, "переписанный заголовок должен попасть в серую зону");
    assert.ok(
      uranium.candidates.some((candidate) => candidate.id === num[2]),
      "в шортлисте должна быть исходная новость про уран",
    );
    assert.ok(
      uranium.candidates.every((candidate) => candidate.id < uranium.item.id),
      "оригиналом считается только более ранний материал",
    );
    assert.ok(
      !grey.some((job) => job.item.id === num[1]),
      "помеченный первым слоем второй раз не спрашивается",
    );
    assert.ok(
      grey.every((job) => job.candidates.every((c) => c.id !== num[1])),
      "дубль не предлагается оригиналом",
    );
    console.log(`  дедуп: серая зона — ${grey.length} вопрос(а) к Jev`);

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

    /**
     * Две формы запроса из сборки выпуска, которые не работали ни разу.
     *
     * `jsonb_build_object` принимает "any", и тип нетипизированного параметра
     * Postgres вывести не может — запрос падает на разборе, до единой строки.
     * У `digest_items` нет столбца `id`: ключ составной, и `returning id`
     * падал на каждой вставке. Обе видны были только как вежливое
     * «не получилось собрать первый выпуск»: у нового читателя первый выпуск
     * не собирался вовсе, а ночной прогон пишет выпуск своим кодом и потому
     * работал.
     */
    const shapes = async (digestId: number, itemId: number) => {
      await rejects(
        "select jsonb_build_object('reading_target', $1) as j",
        // Код, а не английский текст: сообщение переписывают между версиями,
        // а на локализованном кластере его не будет вовсе.
        "42P18", // тип параметра не определён
        "без каста параметр в jsonb_build_object не типизируется — это и было причиной",
        [1.5],
      );
      await sql`
        update dailynews.digests
           set stats = coalesce(stats, '{}'::jsonb)
                     || jsonb_build_object('reading_target', ${1.5}::real)
         where id = ${digestId}
      `;
      const [{ target }] = await sql<{ target: number }[]>`
        select (stats->>'reading_target')::float as target
          from dailynews.digests where id = ${digestId}`;
      assert.equal(target, 1.5, "заказ дня ложится в stats, а не теряется");

      const back = await sql<{ item_id: number }[]>`
        insert into dailynews.digest_items (digest_id, item_id, total, position, title, summary)
        values (${digestId}, ${itemId}, 1, 99, 'проба', 'S')
        on conflict (digest_id, item_id) do nothing
        returning item_id::int as item_id
      `;
      assert.equal(back.length, 0, "уже лежащий материал не вставляется второй раз");
      await rejects(
        `insert into dailynews.digest_items
           (digest_id, item_id, total, position, title, summary)
         values ($1, $2, 1, 98, 'проба', 'S')
         on conflict (digest_id, item_id) do nothing
         returning id::int as id`,
        "42703", // столбца нет
        "у digest_items нет собственного ключа — returning id падал на каждой вставке",
        [digestId, itemId],
      );
      // Убираем за собой: заказ дня — предмет отдельной проверки ниже,
      // и оставленное здесь значение сделало бы её бессмысленной.
      await sql`update dailynews.digests set stats = stats - 'reading_target' where id = ${digestId}`;
      console.log("  формы запросов сборки: каст и составной ключ на месте");
    };

    const today = new Date().toISOString().slice(0, 10);
    // Владельцу — два материала, второму читателю — один, и подписи разные:
    // текст персонален, потому что язык и манера персональны.
    const ownerDigest = await makeDigest(owner.id, today, [
      { id: ids[0], total: 120, title: "Владелец: GPT-6" },
      { id: ids[2], total: 95, title: "Владелец: уран" },
    ]);
    await shapes(ownerDigest, ids[0]);
    await makeDigest(second.id, today, [{ id: ids[3], total: 60, title: "Vera: CBT" }]);

    // Материал старше своего выпуска: без этого проверка ниже проходила бы
    // и на сломанном запросе — сегодняшний день и сегодняшняя публикация
    // неотличимы, а именно их лента и путала.
    await sql`
      update dailynews.items set published_at = now() - interval '3 days' where id = ${ids[0]}
    `;

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
    // --- недельная книга: те же выпуски, что пришли бы письмами ------------------
    // Запрос про содержимое, значит читатель первым аргументом: без него книга
    // приходит вовремя, целой и с чужими выпусками.
    const ownerWeek = await queries.weekIssues(owner.id, today);
    const secondWeek = await queries.weekIssues(second.id, today);
    assert.equal(ownerWeek.length, 1, "выпуск сегодняшнего дня — одна глава книги");
    assert.equal(
      ownerWeek[0].articles.length, ownerFeed.length,
      "в книге ровно то, что читатель видел в ленте",
    );
    assert.equal(ownerWeek[0].day, today, "глава подписана своим днём");
    assert.ok(
      !secondWeek.some((issue) => issue.articles.some((a) => a.title.startsWith("Владелец:"))),
      "второй читатель не должен получить книгой выпуск владельца",
    );
    // Окно считается вычитанием дней из даты, и без каста Postgres выбирает
    // date - date -> integer: запрос упал бы на разборе, а не отдал бы не то.
    assert.deepEqual(
      await queries.weekIssues(owner.id, "1999-01-01"), [],
      "за неделю без выпусков книга пустая, а не чужая",
    );
    // Палец вниз убирает материал и из книги: «убрать из ленты» не может
    // означать «убрать с одного экрана из двух». След не остаётся — проверка,
    // оставляющая его, однажды объяснит чужой провал.
    await sql`
      insert into dailynews.reads (reader_id, item_id, event, score_snap, conf_snap)
      values (${owner.id}, ${ids[0]}, 'down', 95, 0.8)
    `;
    const afterHide = await queries.weekIssues(owner.id, today);
    assert.equal(
      afterHide[0].articles.length, ownerWeek[0].articles.length - 1,
      "скрытое пальцем вниз в книгу не едет",
    );
    await sql`
      delete from dailynews.reads
       where reader_id = ${owner.id} and item_id = ${ids[0]} and event = 'down'
    `;

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

    // --- время выпуска: своё у каждого ------------------------------------------
    // Набранное вычитается из заказа этими двумя запросами. Сложи они чужие
    // карточки со своими — и выпуск обрывался бы на середине заказа: не ошибка
    // в логе, а просто «сегодня мало новостей» каждый день.
    const ownerProgress = await readers.digestProgress(owner.id, today);
    const secondProgress = await readers.digestProgress(second.id, today);
    assert.equal(ownerProgress.items, 2, "в набранном владельца только его карточки");
    assert.equal(secondProgress.items, 1, "второй читатель набрал своё");
    // Одна и та же сумма считается в SQL и в коде (cardChars). Две формулы
    // одного числа расходятся молча: заказ считался бы одним, а показанное
    // читателю время — другим.
    assert.equal(
      ownerProgress.chars,
      cardChars("Владелец: GPT-6", "S") + cardChars("Владелец: уран", "S"),
      "знаки карточки считаются в базе и в коде одинаково",
    );
    // Порог слабого материала на догрузке держится за это число: возьми оно
    // чужой выпуск — и у читателя с тихой лентой порог задрал бы сосед.
    assert.equal(ownerProgress.best, 120, "лучший скор — из своего выпуска");
    assert.equal(secondProgress.best, 60, "у второго читателя лучший свой");
    assert.equal(
      (await readers.digestProgress(owner.id, "2000-01-01")).items, 0,
      "день без выпуска — это ноль набранного, а не чужой выпуск",
    );
    // Мерка карточки — тоже личная: у англоязычного выпуска длина другая,
    // и общая мерка промахивалась бы у всех, кроме среднего читателя.
    assert.equal(
      await readers.cardCharsOf(second.id), cardChars("Vera: CBT", "S"),
      "мерка карточки считается по своим описаниям",
    );
    assert.equal(
      await readers.cardCharsOf(-1), 0,
      "у читателя без выпусков мерки нет — её заменяет общая, а не ноль в делителе",
    );
    assert.equal(
      (await readers.digestProgress(-1, null)).day, null,
      "у читателя без выпусков день пуст: это и значит «первого выпуска ещё не было»",
    );

    // --- сутки потока: штуки и знаки одним запросом ----------------------------
    // Из знаков считается, сколько заняло бы просмотреть весь поток, а из этого —
    // «лента сэкономила тебе час». Сумма обязана совпасть с `cardChars`: две
    // формулы одного числа расходятся молча, и экономия поехала бы вместе
    // с ними — числом, которое нечем проверить, в строке, которую читают первой.
    const [flowSource] = await sql<{ id: number }[]>`
      insert into dailynews.sources (kind, label, url)
      values ('rss', 'Поток', 'https://flow.example/feed')
      returning id::int as id
    `;
    for (const [url, title, excerpt, age] of [
      ["https://flow.example/1", "Реактор запущен", "Мощность вышла на проектную.", "1 hour"],
      ["https://flow.example/2", "Ставка снижена", "Второй раз за год.", "5 hours"],
      // Вчерашнее в сутки не входит: окно у картинки то же, что у подписи.
      ["https://flow.example/3", "Позавчерашнее", "Мимо окна.", "30 hours"],
    ] as const) {
      await sql`
        insert into dailynews.items (source_id, url, url_canon, title, title_norm, excerpt, collected_at)
        values (
          ${flowSource.id}, ${url}, ${url}, ${title}, ${title},
          ${excerpt}, now() - ${age}::interval
        )
      `;
    }
    const flow = await queries.getCollectedLast24h([flowSource.id]);
    assert.equal(flow.count, 2, "в сутки потока входит только свежее");
    assert.equal(
      flow.chars,
      cardChars("Реактор запущен", "Мощность вышла на проектную.")
        + cardChars("Ставка снижена", "Второй раз за год."),
      "знаки потока считаются в базе и в коде одинаково",
    );
    assert.deepEqual(
      await queries.getCollectedLast24h([]),
      { count: 0, chars: 0 },
      "читатель без источников не получает чужой поток вместо своего",
    );

    // Заказ дня лежит при самом выпуске. Лента листается на девяносто дней
    // назад, и старый выпуск, померенный сегодняшней настройкой, обвинялся
    // бы в недоборе, которого не было: «~5 из 45 — сегодня больше нечего»
    // на выпуске, который был полон.
    assert.equal(
      (await readers.digestProgress(owner.id, today)).target, null,
      "выпуск без сохранённого заказа не даёт повода считать недобор",
    );
    await sql`
      update dailynews.digests
         set stats = coalesce(stats, '{}'::jsonb) || '{"reading_target": 20}'::jsonb
       where reader_id = ${second.id} and day = ${today}::date
    `;
    assert.equal(
      (await readers.digestProgress(second.id, today)).target, 20,
      "заказ дня читается из своего выпуска",
    );
    assert.equal(
      (await readers.digestProgress(owner.id, today)).target, null,
      "заказ соседа в свой выпуск не приезжает",
    );
    // Время материала, а не день выпуска. Карточка показывала d.day, и все
    // материалы выпуска получали один возраст, отсчитанный от полудня того
    // дня: в ленте за сегодня везде стояло «1ч» независимо от материала.
    const age = Date.now() - new Date(ownerFeed[0].published_at).getTime();
    assert.ok(
      age > 2.5 * 86_400_000,
      `лента должна отдавать время материала, а не день выпуска (возраст ${Math.round(age / 3_600_000)}ч)`,
    );
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
    // Граница «досюда дочитал» держится на этом поле: материал, попадавшийся
    // на глаза, отмечен, остальные нет. Если запрос начнёт отдавать true всем
    // подряд, граница уедет в начало ленты и будет врать молча.
    const seenFlags = (await queries.getFeed(owner.id, today)).map((item) => item.seen);
    assert.deepEqual(seenFlags, [false, false], "до события seen ни один материал не отмечен");
    await sql`
      insert into dailynews.reads (reader_id, item_id, event, score_snap, conf_snap)
      values (${owner.id}, ${ids[0]}, 'seen', 120, 0.8)
    `;
    const withSeen = await queries.getFeed(owner.id, today);
    assert.equal(withSeen[0].seen, true, "показанный материал должен быть отмечен");
    assert.equal(withSeen[1].seen, false, "чужой строке события seen взяться неоткуда");

    // Отметка «уехало на читалку» переживает перезагрузку только если её
    // отдаёт лента: раньше она жила в карточке и стиралась обновлением
    // страницы — кнопка снова предлагала отправить, а повтор ловил отказ
    // от частичного индекса. Провалившаяся отправка отметкой не считается:
    // её и нужно повторить.
    assert.equal(withSeen[0].kindled, false, "до отправки материал не отмечен");
    await sql`
      insert into dailynews.kindle_sends (reader_id, item_id, status)
      values (${owner.id}, ${ids[0]}, 'sent'), (${owner.id}, ${ids[2]}, 'failed')
    `;
    const withKindle = await queries.getFeed(owner.id, today);
    assert.equal(withKindle[0].kindled, true, "отправленный материал должен быть отмечен");
    assert.equal(
      withKindle.find((item) => String(item.id) === String(ids[2]))?.kindled,
      false,
      "провалившаяся отправка не отмечается: её повторяют",
    );
    await sql`delete from dailynews.kindle_sends where reader_id = ${owner.id}`;

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

    // --- поиск по прошлым выпускам ----------------------------------------------
    // «Где я видел про uranium и дата-центры» — вопрос к своему архиву,
    // а не к интернету. Ошибка здесь той же породы, что и чужая лента:
    // выдача приходит быстро, выглядит осмысленной и собрана не из твоего.
    {
      const { HL_START } = await import("../src/lib/search");
      // Описание пишется читателю его языком — по нему и ищут первым делом.
      const [before] = await sql<{ summary: string | null }[]>`
        select summary from dailynews.digest_items where item_id = ${ids[2]}
      `;
      // Описание длиннее отрывка намеренно: у короткого обрезать нечего,
      // и обе проверки многоточия ниже прошли бы, ничего не измерив.
      await sql`
        update dailynews.digest_items
           set summary = 'Спотовая цена на уран обновила максимум, дата-центры разгоняют спрос '
                      || 'на энергию, а запуск новых блоков отстаёт от графика на годы; трейдеры '
                      || 'закладывают дефицит топлива до конца десятилетия, добытчики обещают '
                      || 'нарастить объёмы, но разрешения выдаются медленнее, чем строятся шахты'
         where item_id = ${ids[2]}
      `;

      // Словарь выпуска пишется при письме; у посеянных строк — общий
      // по умолчанию, и вектор описания считается им.
      const [dictionary] = await sql<{ ts_config: string; ready: boolean }[]>`
        select ts_config::text as ts_config, length(tsv) > 0 as ready
          from dailynews.digest_items where item_id = ${ids[2]} limit 1
      `;
      assert.equal(dictionary.ts_config, "russian", "словарь выпуска по умолчанию — общий");
      assert.ok(dictionary.ready, "вектор описания не пустой: текст разобран при записи");

      // Каждое имя из TS_CONFIGS обязано быть словарём этого Postgres: писатели
      // выпуска приводят его к regconfig, и незнакомое имя роняло бы вставку
      // уже оплаченного выпуска. PGlite несёт тот же набор, что сервер.
      const known = new Set(
        (await sql<{ cfgname: string }[]>`select cfgname from pg_ts_config`).map((row) => row.cfgname),
      );
      assert.deepEqual(
        Object.values(TS_CONFIGS).filter((name) => !known.has(name)),
        [],
        "словарь из TS_CONFIGS, которого нет у Postgres",
      );
      // А на случай чужого имени у писателей стоит откат на общий словарь.
      const [{ fallback }] = await sql<{ fallback: string }[]>`
        select coalesce(
                 (select oid from pg_ts_config where cfgname = ${"нет-такого"}),
                 ${"russian"}::regconfig::oid
               )::regconfig::text as fallback
      `;
      assert.equal(fallback, "russian", "неизвестное имя словаря уходит в общий, а не в ошибку");

      const archive = await queries.archiveSize(owner.id);
      assert.deepEqual(archive, { items: 2, days: 1 }, "архив считается по своим выпускам");
      assert.deepEqual(
        await queries.archiveSize(second.id),
        { items: 1, days: 1 },
        "в чужой архив соседние выпуски не попадают",
      );

      const byRussian = await queries.searchArchive(owner.id, "уран");
      assert.equal(byRussian.hits.length, 1, "слово из описания выпуска обязано находиться");
      assert.equal(String(byRussian.hits[0].item_id), String(ids[2]));
      assert.equal(byRussian.loose, false, "по одному слову ослаблять нечего");
      assert.ok(
        byRussian.hits[0].snippet.includes(HL_START),
        "найденное в отрывке обязано быть отмечено: иначе выдачу нечем читать",
      );
      // Многоточие означает «здесь отрезано», и проверяются обе стороны
      // сразу: отрывок начинается с первых слов описания — слева резать
      // нечего, — а конец в него не поместился, и справа резать пришлось.
      // Поставленное с обеих сторон всегда обещало бы текст, которого нет.
      assert.ok(
        !byRussian.hits[0].snippet.startsWith("…"),
        `отрывок с начала описания не помечается обрезанным: ${byRussian.hits[0].snippet}`,
      );
      assert.ok(
        byRussian.hits[0].snippet.endsWith("…"),
        `у обрезанного конца многоточие обязано быть: ${byRussian.hits[0].snippet}`,
      );

      // А короткий текст помещается в отрывок целиком, и тогда многоточия
      // нет ни с одной стороны. Проверка держит не красоту, а `btrim`:
      // пустая колонка оставляет в склейке висячий пробел, отрывок приходит
      // без него — и «дочитано до конца» становится ложным на каждом
      // отрывке, отчего многоточие перестаёт что-либо означать.
      const [beforeFirst] = await sql<{ summary: string | null }[]>`
        select summary from dailynews.digest_items where item_id = ${ids[0]}
      `;
      await sql`
        update dailynews.digest_items set summary = 'Модель умеет больше контекста'
         where item_id = ${ids[0]}
      `;
      const [shortHit] = (await queries.searchArchive(owner.id, "контекста")).hits;
      // Именно изменённое описание, а не первая попавшаяся находка: иначе
      // следующая строка фикстуры однажды превратит проверку в пустую.
      assert.equal(String(shortHit?.item_id), String(ids[0]), "мерим отрывок своего материала");
      const whole = shortHit?.snippet ?? "";
      assert.ok(
        whole.length > 0 && !whole.startsWith("…") && !whole.endsWith("…"),
        `у неурезанного отрывка многоточия быть не должно: ${whole}`,
      );
      await sql`
        update dailynews.digest_items set summary = ${beforeFirst?.summary ?? null}
         where item_id = ${ids[0]}
      `;
      assert.equal(byRussian.hits[0].title, "Владелец: уран", "заголовок берётся из выпуска");
      assert.equal(byRussian.hits[0].day, today, "у находки есть день выпуска, чтобы вернуться");

      // Ищут тем словом, которое запомнили: «уран» стоит в описании выпуска,
      // «uranium» — в заголовке источника. Одно без другого — половина поиска.
      const byEnglish = await queries.searchArchive(owner.id, "uranium");
      assert.equal(byEnglish.hits.length, 1, "исходный заголовок обязан искаться наравне");
      assert.equal(String(byEnglish.hits[0].item_id), String(ids[2]));

      // Словоформа, а не подстрока: «цены» и «цена» — одно слово.
      assert.equal(
        (await queries.searchArchive(owner.id, "цены")).hits.length,
        1,
        "поиск обязан сводить словоформы, иначе он работает только точным попаданием",
      );
      // Словарь один на оба текста, и это не компромисс: у русской
      // конфигурации Postgres латиница уходит в английский стеммер.
      // «цены» находит «цена» в описании выпуска, «prices» — «price»
      // в заголовке источника, и это один и тот же поиск.
      assert.equal(
        (await queries.searchArchive(owner.id, "prices")).hits.length,
        1,
        "словоформа английского заголовка обязана сводиться тем же словарём",
      );

      // Словарь выпуска — свой у каждой строки, и запрос к описанию
      // разбирается им же. Выпуск, помеченный английским словарём, теряет
      // русские склонения: «шахта» из описания «…строятся шахты» не сводится,
      // а точная форма «шахты» находится по-прежнему — своим вектором
      // и своим запросом. Заголовок источника при этом ищется общим словарём
      // независимо от словаря выпуска. Сравни вектор выпуска с общим запросом
      // (или наоборот) — и точная форма перестанет находиться.
      await sql`
        update dailynews.digest_items set ts_config = 'english'::regconfig where item_id = ${ids[2]}
      `;
      assert.equal(
        (await queries.searchArchive(owner.id, "шахта")).hits.length,
        0,
        "английский словарь выпуска русских склонений не сводит",
      );
      assert.equal(
        (await queries.searchArchive(owner.id, "шахты")).hits.length,
        1,
        "точная форма находится своим словарём выпуска",
      );
      assert.equal(
        (await queries.searchArchive(owner.id, "price")).hits.length,
        1,
        "заголовок источника ищется общим словарём при любом словаре выпуска",
      );
      await sql`
        update dailynews.digest_items set ts_config = 'russian'::regconfig where item_id = ${ids[2]}
      `;
      assert.equal(
        (await queries.searchArchive(owner.id, "шахта")).hits.length,
        1,
        "вектор пересчитывается вместе со словарём: склонение снова сводится",
      );

      // Самое дорогое здесь — чужой архив: он приходит вовремя и не твой.
      const stranger = await queries.searchArchive(second.id, "уран");
      assert.equal(stranger.hits.length, 0, "выпуск соседа в своём поиске не находится");
      assert.equal(
        (await queries.searchArchive(owner.id, "CBT")).hits.length,
        0,
        "и в обратную сторону тоже: владелец не ищет по выпуску второго",
      );

      // Ищут вопросом: все слова разом дают ноль, хотя ответ лежит в архиве.
      const asked = await queries.searchArchive(owner.id, "где я видел про uranium");
      assert.equal(asked.loose, true, "ослабление обязано называться вслух");
      assert.equal(String(asked.hits[0].item_id), String(ids[2]));
      assert.equal(
        (await queries.searchArchive(owner.id, "кварки бозоны")).loose,
        false,
        "ослабление, не нашедшее ничего, ослаблением не объявляется",
      );

      // Палец вниз убирает материал из ленты — и из поиска тоже: иначе
      // «убрать» означало бы «убрать с одной страницы из двух».
      await sql`
        insert into dailynews.reads (reader_id, item_id, event, score_snap, conf_snap)
        values (${owner.id}, ${ids[2]}, 'down', 95, 0.8)
      `;
      assert.equal(
        (await queries.searchArchive(owner.id, "уран")).hits.length,
        0,
        "скрытое пальцем вниз в поиске не всплывает",
      );
      // Убирается ровно вставленное, и описание возвращается на место:
      // проверка, оставляющая след, однажды объяснит чужой провал.
      await sql`
        delete from dailynews.reads
         where reader_id = ${owner.id} and item_id = ${ids[2]} and event = 'down'
      `;
      await sql`
        update dailynews.digest_items set summary = ${before?.summary ?? null}
         where item_id = ${ids[2]}
      `;
      console.log("  поиск: свой архив находится, чужой — нет");
    }

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
    const health = await queries.getSourceHealth(owner.id);
    assert.equal(health.length, sources.length, "в отдаче должны быть все источники, включая пустые");
    const used = health.find((row) => row.id === source.id)!;
    assert.equal(used.items, 5, `материалов ${used.items}, вставлено 5`);
    assert.equal(used.duplicates, 1, "перепечатка должна попасть в долю дублей");
    // Два, а не три: третий материал этого источника стоит в выпуске второго
    // читателя. Без условия по читателю «дошло до выпуска» означало бы
    // «дошло до чьего-то выпуска», и бесполезный источник выглядел бы тем
    // полезнее, чем больше у ленты соседей.
    assert.equal(
      used.in_my_digests, 2,
      `в свои выпуски дошло ${used.in_my_digests}, ожидалось 2 — чужой выпуск не считается`,
    );
    // Знаменатель «не читаю этот источник»: что дошло до экрана, а не что
    // лежало в выпуске. По выпускам источник выглядел бы непрочитанным
    // у всякого, кто просто неделю не заходил.
    assert.equal(used.shown, 1, `на глаза попалось ${used.shown}, ожидался 1`);
    // Один, а не два: у материала два события чтения (opened и outbound),
    // и через join они дали бы двойку — «открыто больше, чем показано».
    assert.equal(used.opened, 1, `открыто ${used.opened}, ожидался 1 материал`);
    assert.equal(used.mean_score, 91.7, `средний скор ${used.mean_score}, ожидалось 91.7`);
    assert.equal(
      cleanupOf(used), null,
      "источник, из которого читают, в кандидаты на удаление не попадает",
    );
    // Тот же источник с непрочитанным месяцем — уже кандидат, и числа
    // настоящие: строка, собранная не из тех колонок, выглядит убедительно
    // ровно до первой сверки.
    assert.equal(
      cleanupOf({ ...used, shown: 12, opened: 0 }),
      "5 новостей за месяц, 12 показано, 0 открыто",
      "числа кандидата берутся из той же строки отдачи",
    );
    const empty = health.find((row) => row.id !== source.id)!;
    assert.equal(empty.items, 0, "источник без материалов показывает ноль, а не выпадает из списка");
    assert.equal(empty.silent_days, null, "без отметки тишины дней тишины нет");

    // Тишина отмечается временем: прогон могут запустить дважды за сутки,
    // и счётчик посчитал бы два дня за один.
    await sql`update dailynews.sources set silent_since = now() - interval '4 days' where id = ${empty.id}`;
    const afterSilence = await queries.getSourceHealth(owner.id);
    assert.equal(
      afterSilence.find((row) => row.id === empty.id)!.silent_days,
      4,
      "дни тишины считаются от отметки",
    );
    console.log(
      `  отдача источника: ${used.items} → ${used.in_my_digests} в своих выпусках,`
      + ` показано ${used.shown}, открыто ${used.opened}, скор ${used.mean_score}`,
    );

    // --- порядок списка: сломанное сверху --------------------------------------
    // В каталоге из тридцати строк источник с ошибкой, лежащий в середине,
    // не будет найден никогда. Порядок задаёт запрос, поэтому проверяется он.
    const broken = health.find((row) => row.id !== source.id && row.id !== empty.id)!;
    await sql`update dailynews.sources set last_error = 'HTTP 500' where id = ${broken.id}`;
    // Отметку тишины снимаем: она стоит в порядке выше отдачи, и с ней
    // сравнение по числу материалов ничего не проверяет.
    await sql`update dailynews.sources set silent_since = null where id = ${empty.id}`;
    const ordered = await queries.getSourceHealth(owner.id);
    assert.equal(ordered[0].id, broken.id, "источник с ошибкой должен быть первым");
    assert.ok(
      ordered.findIndex((row) => row.id === source.id) <
        ordered.findIndex((row) => row.id === empty.id),
      "при прочих равных давший материалы стоит выше пустого",
    );
    // Убранный исчезает из списка совсем — ни хвостом, ни как-либо ещё:
    // третьего состояния у источника больше нет.
    await sql`update dailynews.sources set deleted_at = now() where id = ${broken.id}`;
    assert.ok(
      !(await queries.getSourceHealth(owner.id)).some((row) => row.id === broken.id),
      "убранный источник не остаётся в списке даже с ошибкой",
    );
    await sql`update dailynews.sources set last_error = null, deleted_at = null where id = ${broken.id}`;

    // --- «добавлен» против «уже был» -------------------------------------------
    // xmax = 0 у настоящей вставки и ненулевой у обновления по конфликту.
    // Приём неочевидный: сломается — интерфейс начнёт врать, что источник
    // добавлен, когда он лишь обновлён.
    const insertTwice = async () => {
      const [row] = await sql<{ created: boolean }[]>`
        insert into dailynews.sources (kind, label, url, input_url)
        values ('rss', 'проба', 'https://twice.example.com/feed', null)
        on conflict (kind, url) do update
          set active = true, label = excluded.label, input_url = excluded.input_url
        returning (xmax = 0) as created
      `;
      return row.created;
    };
    assert.equal(await insertTwice(), true, "первая вставка — новый источник");
    assert.equal(await insertTwice(), false, "вторая — обновление, а не добавление");
    await sql`delete from dailynews.sources where url = 'https://twice.example.com/feed'`;
    console.log("  список: сломанное сверху, убранное не показывается, повтор отличим от вставки");

    // --- убрать можно, потерять нельзя -----------------------------------------
    // Удаление перестало удалять: каскад уносил материалы, чтения и записи
    // в прошлых выпусках, и отменить это было нечем. Проверяется главное:
    // источник исчезает отовсюду, история остаётся, отмена возвращает как было.
    const before = (await queries.getSourceHealth(owner.id)).length;
    const itemsBefore = (await sql<{ n: number }[]>`
      select count(*)::int as n from dailynews.items where source_id = ${source.id}`)[0].n;
    assert.ok(itemsBefore > 0, "у источника должны быть материалы, иначе проверка ничего не значит");

    await sql`update dailynews.sources set deleted_at = now() where id = ${source.id}`;

    assert.equal(
      (await queries.getSourceHealth(owner.id)).length, before - 1,
      "убранный источник исчезает из списка",
    );
    assert.ok(
      !(await queries.getSources()).some((row) => row.id === source.id),
      "и из каталога, по которому считается предел тарифа",
    );
    const polled = await sql<{ id: number }[]>`
      select id from dailynews.sources where active and deleted_at is null`;
    assert.ok(!polled.some((row) => row.id === source.id), "и из того, что опрашивает прогон");
    assert.equal(
      (await sql<{ n: number }[]>`
        select count(*)::int as n from dailynews.items where source_id = ${source.id}`)[0].n,
      itemsBefore,
      "материалы остаются на месте: в этом весь смысл мягкого удаления",
    );

    await sql`update dailynews.sources set deleted_at = null where id = ${source.id}`;
    assert.equal(
      (await queries.getSourceHealth(owner.id)).length, before,
      "отмена возвращает источник в список",
    );
    console.log(`  убрать и вернуть: ${itemsBefore} материалов пережили удаление`);

    // --- источники персональны ------------------------------------------------
    // До reader_sources «источники тарифа» означали первые N строк общего
    // каталога: у всех читателей набор был один и тот же. На втором читателе
    // это ровно тот отказ, что выглядит как успех — выпуск приходит вовремя
    // и собран из чужих источников.
    const mine = await queries.getSourceHealth(owner.id);
    const theirs = await queries.getSourceHealth(second.id);
    assert.ok(mine.length > 0, "у владельца источники есть");
    assert.equal(theirs.length, 0, "у нового читателя своих источников нет, пока он их не выбрал");

    await readers.addReaderSource(second.id, source.id);
    assert.deepEqual(
      (await queries.getSourceHealth(second.id)).map((row) => row.id), [source.id],
      "взятый источник появляется только у взявшего",
    );
    // Отдача у того же источника своя у каждого: у владельца в выпусках два
    // материала и один открыт, у второго — один и ни одного. Общее число
    // здесь означало бы «кто-то это читает», а решение принимается своё.
    const sharedForSecond = (await queries.getSourceHealth(second.id))[0];
    assert.equal(
      sharedForSecond.in_my_digests, 1,
      `у второго читателя в выпусках ${sharedForSecond.in_my_digests}, ожидался 1`,
    );
    assert.equal(sharedForSecond.opened, 1, "своё открытие второй читатель видит");
    assert.equal(sharedForSecond.shown, 0, "а чужое событие seen ему не засчитывается");
    assert.equal(
      (await queries.getSourceHealth(owner.id)).length, mine.length,
      "и ничего не меняет у соседа",
    );

    // Убрать у себя — это удалить строку связки. Настоящее удаление уносило
    // бы каскадом материалы, оценки и чтения, и не только свои.
    await readers.removeReaderSource(second.id, source.id);
    assert.equal(
      (await queries.getSourceHealth(second.id)).length, 0, "убранный уходит из своего списка",
    );
    assert.equal(
      (await sql<{ n: number }[]>`
        select count(*)::int as n from dailynews.items where source_id = ${source.id}`)[0].n,
      itemsBefore,
      "а материалы источника остаются на месте",
    );
    console.log(`  источники: ${mine.length} у владельца, у нового — только выбранные им`);

    // --- ссылка, присланная боту -----------------------------------------------
    // Вебхук открыт всему интернету, а разбор ссылки ходит в сеть: платный
    // вид обязан отсекаться до единого запроса наружу — здесь это и видно,
    // потому что сети в проверке нет вовсе.
    const { addByLink } = await import("../src/lib/sources");
    // Владелец берётся из базы, а не заводится по telegram_id: у перенесённой
    // из profile строки его нет, и ensureReader завёл бы вместо неё нового
    // читателя — тогда проверка меряла бы не то, что думает.
    const [ownerNow] = await sql<(typeof owner)[]>`select * from dailynews.readers where owner`;
    assert.ok(ownerNow?.owner, "владелец должен найтись");
    // Платный вид отсекается до запроса наружу — и эта проверка однажды
    // перестала мерить то, что думает. Тариф владельца на время стал
    // правилом в коде: effectivePlan отдавал ему Pro независимо от колонки,
    // «владелец на бесплатном» становился состоянием, которого не бывает,
    // и разбор уходил в платную выдачу X, падая на незаданном ключе.
    // Правило вернули в колонку — владелец снова может посмотреть на продукт
    // глазами бесплатного читателя, и проверка снова про отсечку, а не про
    // него. Оставлена в прежнем виде намеренно: обходной путь через
    // kindDenial проверял бы правило, но не то, что addByLink его спросит.
    const { PLANS } = await import("../src/lib/plans");
    const paid = await addByLink({ ...ownerNow, plan: "free" }, "from:karpathy OR from:sama");
    assert.equal(paid.ok, false, "X на бесплатном тарифе не заводится");
    assert.match((paid as { error: string }).error, /Pro/, "отказ называет тариф, который его открывает");

    // Предел считается по своему набору, а не по каталогу: иначе пятый
    // источник, заведённый кем угодно, закрывал бы добавление всем
    // бесплатным читателям разом.
    const { denyForKind } = await import("../src/lib/sources");
    const fresh = (await readers.getReader(second.id))!;
    assert.equal(
      await denyForKind(fresh, "rss"), null,
      "у читателя без источников место есть, сколько бы их ни было в каталоге",
    );
    // А у того, кто набрал свой предел, места нет. Считается его набор:
    // до reader_sources предел мерили по каталогу, и пятый источник,
    // заведённый кем угодно, закрывал добавление всем бесплатным разом.
    for (const row of sources.slice(0, PLANS.free.maxSources)) {
      await readers.addReaderSource(second.id, row.id);
    }
    assert.ok(
      await denyForKind(fresh, "rss"),
      "набравший предел упирается в него",
    );
    await sql`delete from dailynews.reader_sources where reader_id = ${second.id}`;
    console.log("  предел тарифа считается по своему набору, а не по каталогу");

    // --- первый заход ----------------------------------------------------------
    // Шаг онбординга считается по данным, а не хранится колонкой: колонка
    // расходится с правдой при первом же отказе на середине — в базе стоит
    // «выбирает источники», интересов нет, и экран показывает пустой список
    // того, что подобрано под них.
    const { onboardingStep, suggestSources } = await import("../src/lib/onboarding");
    const newcomer = await readers.ensureReader(BIG_TELEGRAM_ID + 11, "novichok");
    assert.equal(await onboardingStep(newcomer.id), "interests", "без интересов — первый шаг");

    const energy = topicBy("energy");
    await sql`
      insert into dailynews.reader_topics (reader_id, topic_id, weight, position)
      values (${newcomer.id}, ${energy.id}, 1, 1)`;
    assert.equal(await onboardingStep(newcomer.id), "sources", "интересы есть, источников нет — второй");

    // Подборка под интересы: стартовый список отвечает за темы без истории,
    // каталог — за то, чтобы предложения взрослели сами.
    const offered = await suggestSources(newcomer.id, ["energy"], PLANS.free);
    assert.ok(offered.length > 0, "под выбранный интерес должно найтись, что предложить");
    assert.equal(
      new Set(offered.map((row) => row.key)).size, offered.length,
      "один источник не предлагается дважды",
    );

    await readers.addReaderSource(newcomer.id, source.id);
    assert.equal(await onboardingStep(newcomer.id), "ready", "интересы и источники есть — последний шаг");
    assert.ok(
      !(await suggestSources(newcomer.id, ["energy"], PLANS.free)).some((row) => row.url === source.url),
      "взятый источник исчезает из предложений: нажать на него нечем",
    );

    // Вид, которого тариф не даёт, не предлагается вовсе: показанный
    // источник X отказал бы уже после нажатия, и читатель убирал бы лишнее,
    // не понимая, почему это не помогает.
    const [paidSource] = await sql<{ id: number }[]>`
      insert into dailynews.sources (kind, label, url)
      values ('x', 'платный поиск', 'uranium OR SMR')
      returning id::int as id`;
    await sql`
      insert into dailynews.items (source_id, url, url_canon, title, title_norm, collected_at)
      values (${paidSource.id}, 'https://x.com/p/1', 'x.com/p/1', 'пост', 'post', now())`;
    await sql`
      insert into dailynews.scores (item_id, topic_id, total, confidence, axes, model)
      select i.id, ${energy.id}, 90, 0.9, '{}'::jsonb, 'jev'
        from dailynews.items i where i.source_id = ${paidSource.id}`;
    assert.ok(
      !(await suggestSources(newcomer.id, ["energy"], PLANS.free)).some((row) => row.kind === "x"),
      "бесплатному не предлагается платный вид источника",
    );
    assert.ok(
      (await suggestSources(newcomer.id, ["energy"], PLANS.pro)).some((row) => row.kind === "x"),
      "а на Pro он в подборке есть",
    );
    await sql`delete from dailynews.sources where id = ${paidSource.id}`;

    // Убранный из каталога не возвращает читателя на шаг назад и не считается
    // за источник: третьего состояния у источника нет.
    await sql`update dailynews.sources set deleted_at = now() where id = ${source.id}`;
    assert.equal(
      await onboardingStep(newcomer.id), "sources",
      "убранный источник перестаёт считаться сразу, а не выглядит живым",
    );
    await sql`update dailynews.sources set deleted_at = null where id = ${source.id}`;
    await sql`delete from dailynews.readers where id = ${newcomer.id}`;
    console.log(`  первый заход: шаг считается по данным, под интерес нашлось ${offered.length} источников`);

    // --- новые виды источников ------------------------------------------------
    // Ограничение переименовано намеренно: переопределение под прежним именем
    // проверка формы схемы не видит, и 0018 уже проскочил так молча.
    await sql`
      insert into dailynews.sources (kind, label, url)
      values ('telegram', 'канал', 'durov')
    `;
    await rejects(
      `insert into dailynews.sources (kind, label, url) values ('carrier-pigeon', 'x', 'y')`,
      /sources_kind_known/,
      "неизвестный вид источника должен отвергаться ограничением с новым именем",
    );
    await sql`
      insert into dailynews.sources (kind, label, url)
      values ('email', 'рассылка', 'letters@example-letter.test')
    `;
    console.log("  виды источников: telegram и email приняты, выдуманный отвергнут");

    // --- этапы расхода ---------------------------------------------------------
    // Этап, которого нет в ограничении, роняет запись о расходе целиком:
    // вызов оплачен, а в model_calls его нет, и дневной потолок считает
    // не те деньги. Так уже ломалось дважды — с переводом статьи и
    // с расшифровкой ролика, — и оба раза список закрывали тем, что знали
    // в своей ветке.
    // Список — объединение по всем веткам, а не по этой: ограничение общее,
    // и каждая ветка пересоздаёт его под тем же именем. Взявшая только свои
    // значения стирает чужие вместе с их строками.
    const stages = [
      "score", "digest", "summary", "translate", "translation-quality",
      "video", "voice", "post", "post-quality", "interests", "dedup",
    ];
    for (const stage of stages) {
      await readers.recordCall({
        readerId: owner.id, stage: stage as never, model: "проба", tokensIn: 1, costUsd: 0,
      });
    }
    // Не через recordCall: проверяется ограничение базы, а оно одно и то же,
    // каким бы кодом в таблицу ни писали. Зато простым протоколом — см. rejects.
    await rejects(
      `insert into dailynews.model_calls (reader_id, stage, model, tokens_in, cost_usd)
       values (${owner.id}, 'выдуманный', 'проба', 1, 0)`,
      /model_calls_stage_check/,
      "незнакомый этап отвергается ограничением, а не пишется молча",
    );
    await sql`delete from dailynews.model_calls where model = 'проба'`;
    console.log("  этапы расхода: все известные пишутся, выдуманный отвергнут");

    // --- сверка формы схемы видит переопределение ------------------------------
    // Ограничение, переопределённое под тем же именем, по имени неотличимо
    // от применённого: 0018 так и проскочил. Теперь сверяется и содержимое.
    const { schemaGaps } = await import("./schema-gap");
    const gaps = await schemaGaps(sql);
    if (gaps.length > 0) {
      // Расхождение «в базе нет ни одной таблицы» означает не сломанную
      // схему, а разговор не с той базой. Разница видна только отсюда,
      // поэтому она называется вслух, а не оставляется на догадки.
      const [seen] = await sql<{ n: number }[]>`
        select count(*)::int as n from information_schema.tables where table_schema = 'dailynews'
      `;
      const [mark] = await sql<{ token: string }[]>`select token from public.pg_owner_token`;
      console.error(
        `  таблиц видно ${seen.n}, метка базы ${mark?.token === local.token ? "своя" : `чужая (${mark?.token})`}`,
      );
    }
    assert.deepEqual(gaps, [], "на полной схеме расхождений быть не должно");

    // Откатываем ограничение к версии 0025 — как если бы 0026 не применили.
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
    assert.equal(survivors.length, 20, "отбор должен отдать ровно столько мест, сколько заказано");
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

    // --- личные правила: за чем следить и что исключать ------------------------
    // Правило личное: у владельца оно есть, у второго читателя нет, и один
    // и тот же поток должен разойтись по-разному. Ломается это молча —
    // выпуск приходит вовремя, просто с тем, что просили не показывать,
    // — поэтому проверяется настоящий отбор и настоящая лента.
    const [ruleSource] = await sql<{ id: number }[]>`
      insert into dailynews.sources (kind, label, url, config)
      values ('rss', 'Правила: издание', 'https://rules.example.com/feed', '{}'::jsonb)
      returning id::int as id
    `;
    const ruleItem = async (topic: typeof topics[number], title: string, total: number, extra = {}) => {
      const url = `https://rules.example.com/${toSlug(title)}`;
      const [row] = await sql<{ id: number }[]>`
        insert into dailynews.items (source_id, url, url_canon, title, title_norm, excerpt)
        values (${ruleSource.id}, ${url}, ${url}, ${title}, ${normalizeTitle(title)}, '')
        returning id::int as id
      `;
      await sql`
        insert into dailynews.scores (item_id, topic_id, total, confidence, axes, model)
        values (
          ${row.id}, ${topic.id}, ${total}, 0.8,
          ${sql.json(axes(topic.slug, "fact", extra) as unknown as Parameters<typeof sql.json>[0])},
          'jev-latest'
        )
      `;
      return row.id;
    };
    // Figma — середина очереди дизайна по скору: без правила в шесть мест
    // не попадает, с правилом обязана встать первой. Musk — лучший
    // материал потока: без правила берётся у любого читателя.
    const figmaItem = await ruleItem(budget[1].topic, "Figma raises a round", 60, { clickbait: { noul: 0.35 } });
    const muskItem = await ruleItem(budget[2].topic, "Musk buys the chain", 130, { depth: { score: 2, max: 2, confidence: 0.9 } });
    const ruleSources = [...everySource, ruleSource.id];

    const ownerRules = { follow: [["Figma", "Фигма"]], exclude: [["Musk"]] };
    await readers.saveRules(sql, owner.id, ownerRules);
    const ownerRuled = (await readers.getReader(owner.id))!;
    assert.deepEqual(ownerRuled.follow_rules, ownerRules.follow, "слежение приезжает массивом, а не строкой jsonb");
    assert.deepEqual(ownerRuled.exclude_rules, ownerRules.exclude, "исключения приезжают массивом");
    const secondRuled = (await readers.getReader(second.id))!;
    assert.deepEqual(secondRuled.exclude_rules, [], "у второго читателя правил нет: старые читатели получают пустую настройку");
    await rejects(
      `update dailynews.readers set follow_rules = '"Figma"'::jsonb where id = ${owner.id}`,
      /readers_follow_rules_array/,
      "строка вместо массива (урок 0005) отвергается самой базой",
    );

    const ownerTargets = targetsOf(await readers.getReaderTopics(owner.id));
    const unruledPick = await selectSurvivors(sql, owner.id, owner.weights, ownerTargets, 12, ruleSources);
    assert.ok(unruledPick.some((s) => Number(s.id) === muskItem), "без правил лучший материал берётся");
    assert.ok(!unruledPick.some((s) => Number(s.id) === figmaItem), "без правил середина очереди в шесть мест не попадает");

    const ruledPick = await selectSurvivors(
      sql, owner.id, owner.weights, ownerTargets, 12, ruleSources, 0, rulesOf(ownerRuled),
    );
    assert.ok(!ruledPick.some((s) => Number(s.id) === muskItem), "исключённое не попадает в выпуск владельца");
    const designPicked = ruledPick.filter((s) => s.topic_label === budget[1].topic.label);
    assert.equal(Number(designPicked[0]?.id), figmaItem, "упомянутое встаёт первым в своей теме");
    assert.equal(
      designPicked.length,
      unruledPick.filter((s) => s.topic_label === budget[1].topic.label).length,
      "доля темы от слежения не растёт: приоритет — порядок внутри очереди, а не лишние места",
    );

    // Сорок мест, а не двенадцать: у второго цель «Дизайн» — двадцать, и круг
    // отдаёт дизайну двадцать мест раньше, чем блокчейн получит первое.
    // Проверяется изоляция правил, а не бюджет тем.
    const secondPick = await selectSurvivors(
      sql, second.id, second.weights, targetsOf(await readers.getReaderTopics(second.id)), 40, ruleSources, 0,
      rulesOf(secondRuled),
    );
    assert.ok(secondPick.some((s) => Number(s.id) === muskItem), "исключение владельца не трогает выпуск соседа");
    console.log("  правила отбора: исключённое ушло, упомянутое первое, сосед не задет");

    // Готовый выпуск: исключение прячет карточку без пересборки, у соседа
    // та же карточка остаётся. Пометка слежения находится по написанию
    // из выпуска — «Фигма» ловится вторым написанием, называется первым.
    const rulesDay = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    const ruleCards = [
      { id: muskItem, total: 130, title: "Владелец: Маск покупает" },
      { id: figmaItem, total: 60, title: "Владелец: Фигма подняла раунд" },
    ];
    await makeDigest(owner.id, rulesDay, ruleCards);
    await makeDigest(second.id, rulesDay, ruleCards);
    const ownerShown = applyRules(await queries.getFeed(owner.id, rulesDay), rulesOf(ownerRuled));
    assert.deepEqual(ownerShown.visible.map((c) => Number(c.id)), [figmaItem], "исключённая карточка спрятана из готового выпуска");
    assert.equal(ownerShown.hidden, 1, "скрытое посчитано");
    assert.equal(ownerShown.visible[0].followed, "Figma", "пометка называет первое написание правила");
    const secondShown = applyRules(await queries.getFeed(second.id, rulesDay), rulesOf(secondRuled));
    assert.equal(secondShown.hidden, 0, "у соседа ничего не спрятано");
    assert.equal(secondShown.visible.length, 2, "у соседа обе карточки на месте");
    // Снятое правило возвращает карточку как была — без пересборки.
    await readers.saveRules(sql, owner.id, { follow: [], exclude: [] });
    const ownerFreed = applyRules(
      await queries.getFeed(owner.id, rulesDay), rulesOf((await readers.getReader(owner.id))!),
    );
    assert.equal(ownerFreed.visible.length, 2, "снятое исключение возвращает карточку");
    assert.equal(ownerFreed.visible[0].followed, null, "без слежения пометки нет");
    console.log("  правила в ленте: спрятано без пересборки, возвращается снятием правила");
    // Выпуск и источник этой проверки убираются: дальше мерка карточки
    // и архив считаются по выпускам владельца, а список источников —
    // по каталогу, и лишний день или лишняя активная строка сдвинули бы их.
    // Материалы и оценки уходят каскадом за источником.
    await sql`
      delete from dailynews.digests
       where day = ${rulesDay}::date and reader_id in (${owner.id}, ${second.id})
    `;
    await sql`delete from dailynews.sources where id = ${ruleSource.id}`;

    // Индекс из 0051 смотрится в pg_indexes, а не по ответу migrate:
    // миграцию из одного индекса сверка формы схемы не видит (урок 0041).
    const [{ topicIdx }] = await sql<{ topicIdx: number }[]>`
      select count(*)::int as "topicIdx" from pg_indexes
       where schemaname = 'dailynews' and indexname = 'reader_topics_topic_idx'
         -- По определению, а не по имени: индекс с тем же именем по другой
         -- колонке прошёл бы проверку, как проходило бы переопределённое
         -- ограничение под тем же именем. strpos, а не like: в like «_» —
         -- любой знак, и «(topicXid)» прошёл бы.
         and strpos(indexdef, '(topic_id)') > 0
    `;
    assert.equal(topicIdx, 1, "индекс reader_topics(topic_id) из 0051 должен стоять");

    // --- своя тема правится, каталожная и общая — нет ----------------------
    // Подсказка темы — критерий классификации Jev, один на всех, кто тему
    // взял. Правка каталожной темы молча терялась: форма показывала новое
    // до перезагрузки, база хранила прежнее. Решает сервер, а не форма.
    //
    // Каталожную ветку держит `blockchain`: его к этому месту держит только
    // владелец. «Дизайн» не годится — он взят и вторым читателем, и запись
    // отбило бы условие про соседа, а не про каталог.
    const [{ holders }] = await sql<{ holders: number }[]>`
      select count(*)::int as holders from dailynews.reader_topics rt
        join dailynews.topics t on t.id = rt.topic_id where t.slug = 'blockchain'
    `;
    assert.equal(holders, 1, "проверка каталожной ветки держится на теме, взятой только одним читателем");
    assert.ok(
      (await readers.getReaderTopics(owner.id)).some((topic) => topic.slug === "blockchain"),
      "и держит её именно владелец, а не сосед",
    );
    /** Имя и подсказка темы — то, о чём здесь каждое утверждение. */
    const textOf = async (topic: { slug: string } | { id: number }) => {
      const rows = "slug" in topic
        ? await sql<{ label: string; hint: string }[]>`select label, hint from dailynews.topics where slug = ${topic.slug}`
        : await sql<{ label: string; hint: string }[]>`select label, hint from dailynews.topics where id = ${topic.id}`;
      return rows[0];
    };
    const chainBefore = await textOf({ slug: "blockchain" });
    await readers.upsertTopic(
      sql, owner.id, { slug: "blockchain", label: "Крипта", hint: "Bitcoin", position: 1 },
    );
    const chainAfter = await textOf({ slug: "blockchain" });
    assert.deepEqual(chainAfter, chainBefore, "каталожная тема не переписывается ни именем, ни подсказкой");
    // Каталожная строка, разошедшаяся с набором (набрана руками до каталога
    // или переименована в базе), сходится к нему при следующей записи: иначе
    // она висела бы в третьем состоянии — ни своя, ни каталожная, и править
    // её было бы нечем. На живой базе такая была одна: «Психотерапия»
    // при «Психотерапия и mental health» в наборе.
    await sql`update dailynews.topics set label = 'Крипта' where slug = 'blockchain'`;
    await readers.upsertTopic(
      sql, owner.id, { slug: "blockchain", label: "Крипта", hint: "Bitcoin", position: 1 },
    );
    const chainRestored = await textOf({ slug: "blockchain" });
    assert.deepEqual(chainRestored, chainBefore, "каталожная тема, разошедшаяся с набором, возвращается к нему при записи");

    // Каталожная тема, которой в сиде ещё нет, заводится из стартового
    // набора, а не из присланного: иначе первый взявший определял бы критерий
    // классификации для всех своим именем и пустой подсказкой.
    const music = starterBySlug.get("music");
    assert.ok(music, "в стартовом наборе есть «music» — на нём держится проверка");
    const [{ musicRows }] = await sql<{ musicRows: number }[]>`
      select count(*)::int as "musicRows" from dailynews.topics where slug = 'music'
    `;
    assert.equal(musicRows, 0, "«music» в сиде нет — проверяется именно заведение");
    const musicId = await readers.upsertTopic(
      sql, owner.id, { slug: "music", label: "Мой музон", hint: "только винил", position: 1 },
    );
    const musicRow = await textOf({ id: musicId });
    assert.deepEqual(musicRow, { label: music.label, hint: music.hint }, "заведённая каталожная тема — из набора, а не от вызвавшего");
    await sql`delete from dailynews.topics where id = ${musicId}`;

    const ownId = await readers.upsertTopic(
      sql, owner.id, { slug: "fintech-brazil", label: "Финтех", hint: "", position: 9 },
    );
    await sql`
      insert into dailynews.reader_topics (reader_id, topic_id, weight, position)
      values (${owner.id}, ${ownId}, 1, 9) on conflict do nothing
    `;
    assert.equal(
      await readers.upsertTopic(
        sql, owner.id, { slug: "fintech-brazil", label: "Финтех Бразилии", hint: "Nubank, Pix", position: 9 },
      ),
      ownId,
      "повторная запись отдаёт ту же тему",
    );
    const ownTopic = await textOf({ id: ownId });
    assert.deepEqual(ownTopic, { label: "Финтех Бразилии", hint: "Nubank, Pix" }, "своя тема правится");
    assert.equal(
      (await readers.getReaderTopics(owner.id)).find((topic) => topic.id === ownId)?.shared, false,
      "тема, которую взял только я, не общая",
    );
    // Держащий тему читатель стирает подсказку осознанно: пустая — это стёртая.
    await readers.upsertTopic(
      sql, owner.id, { slug: "fintech-brazil", label: "Финтех Бразилии", hint: "", position: 9 },
    );
    const [cleared] = await sql<{ hint: string }[]>`select hint from dailynews.topics where id = ${ownId}`;
    assert.equal(cleared.hint, "", "у своей темы пустая подсказка — стёртая, а не пропущенная");
    await readers.upsertTopic(
      sql, owner.id, { slug: "fintech-brazil", label: "Финтех Бразилии", hint: "Nubank, Pix", position: 9 },
    );

    // Убрал тему, сохранил, взял снова: новый чип приходит с пустой
    // подсказкой, и присоединение к ничьей теме не должно стирать сохранённую;
    // а набранное при присоединении — применяется.
    await sql`delete from dailynews.reader_topics where topic_id = ${ownId}`;
    await readers.upsertTopic(
      sql, owner.id, { slug: "fintech-brazil", label: "Финтех Бразилии", hint: "", position: 9 },
    );
    const rejoined = await textOf({ id: ownId });
    assert.deepEqual(rejoined, { label: "Финтех Бразилии", hint: "Nubank, Pix" }, "повторное взятие не стирает подсказку");
    await readers.upsertTopic(
      sql, owner.id, { slug: "fintech-brazil", label: "Финтех", hint: "Nubank, Pix, Inter", position: 9 },
    );
    const rejoinedTyped = await textOf({ id: ownId });
    assert.deepEqual(rejoinedTyped, { label: "Финтех", hint: "Nubank, Pix, Inter" }, "набранное при повторном взятии применяется");
    await sql`
      insert into dailynews.reader_topics (reader_id, topic_id, weight, position)
      values (${owner.id}, ${ownId}, 1, 9) on conflict do nothing
    `;

    await sql`
      insert into dailynews.reader_topics (reader_id, topic_id, weight, position)
      values (${second.id}, ${ownId}, 1, 1)
    `;
    await readers.upsertTopic(
      sql, owner.id, { slug: "fintech-brazil", label: "Чужое имя", hint: "чужая подсказка", position: 9 },
    );
    const sharedTopic = await textOf({ id: ownId });
    assert.deepEqual(
      sharedTopic, { label: "Финтех", hint: "Nubank, Pix, Inter" },
      "тема, взятая соседом, больше не правится никем",
    );
    assert.equal(
      (await readers.getReaderTopics(owner.id)).find((topic) => topic.id === ownId)?.shared, true,
      "и помечена общей",
    );
    // Уборка целиком: оценок на эту тему нет, а лишняя тема в справочнике
    // сдвинула бы счёт тем в проверках ниже.
    await sql`delete from dailynews.reader_topics where topic_id = ${ownId}`;
    await sql`delete from dailynews.topics where id = ${ownId}`;
    console.log("  темы: каталожная не переписывается и заводится из набора, своя правится, взятая соседом — уже нет");

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

    // Список в форме предлагает до сорока пяти минут. Разъедется
    // с ограничением колонки — и выбор «45» вернёт ошибку там, где читатель
    // ничего не нарушал.
    const { READING_MINUTES } = await import("../src/lib/plans");
    const maxMinutes = READING_MINUTES[READING_MINUTES.length - 1];
    await sql`update dailynews.readers set digest_minutes = ${maxMinutes} where id = ${owner.id}`;
    await rejects(
      `update dailynews.readers set digest_minutes = ${maxMinutes + 1} where id = ${owner.id}`,
      /digest_minutes/,
      "за потолком список предлагать не должен, а база — принимать",
    );
    await sql`update dailynews.readers set digest_minutes = 6 where id = ${owner.id}`;
    console.log(`  время выпуска: ${maxMinutes} проходит, ${maxMinutes + 1} отвергается`);

    // Ноль в цели уронил бы отбор делением на ноль, а не спрятал тему.
    await rejects(
      `update dailynews.reader_topics set weight = 0 where reader_id = ${owner.id}`,
      /weight/,
      "нулевая цель должна отвергаться базой",
    );
    console.log("  цель темы: ноль запрещён ограничением");


    // --- блогерский Pro: площадки, голос, черновики ------------------------
    //
    // Пост уходит под именем читателя, поэтому чужой здесь дороже, чем
    // в ленте: сосед опубликовал бы наш черновик по нашему же промаху.
    const posts = await import("../src/lib/posts");

    await readers.saveChannel(owner.id, "telegram", {
      handle: "ownerchannel", input_url: "t.me/ownerchannel", label: "Канал владельца",
    });
    await readers.saveChannel(owner.id, "linkedin");
    await readers.saveChannel(second.id, "telegram", { handle: "verachannel" });

    const ownerChannels = await readers.getChannels(owner.id);
    assert.deepEqual(
      ownerChannels.map((channel) => channel.network).sort(),
      ["linkedin", "telegram"],
      "площадки читателя — только его",
    );
    assert.equal(
      ownerChannels.find((channel) => channel.network === "telegram")?.handle,
      "ownerchannel",
      "чужой канал в свой список не попадает",
    );
    assert.equal(
      ownerChannels.find((channel) => channel.network === "linkedin")?.handle,
      null,
      "LinkedIn читать нечем: строка означает только «дай таб»",
    );
    // Отметка «публикую здесь» не должна стирать разобранный адрес: галочка
    // и ссылка живут в одной строке, и upsert без coalesce терял бы канал.
    await readers.saveChannel(owner.id, "telegram");
    assert.equal(
      (await readers.getChannels(owner.id)).find((c) => c.network === "telegram")?.handle,
      "ownerchannel",
      "повторная отметка сети не стирает канал",
    );

    // Карточка автора кладётся объектом, а не строкой: JSON.stringify в jsonb
    // сохраняет строку, и voice_card->'voice' молча становится null (0005).
    await readers.saveVoiceCard(owner.id, {
      voice: ["короткие фразы"], structure: ["первая строка — заголовок капсом"],
      hooks: ["заголовок капсом: «ХРАНИЛИЩЕ»"], samples: ["его пост целиком"],
      frame: ["в верхних есть число"], taboo: [],
      built_from: 20, sources: ["telegram"], ranked: true,
    });
    const [cardRow] = await sql<{ kind: string; first: string | null }[]>`
      select jsonb_typeof(voice_card) as kind, voice_card->'voice'->>0 as first
        from dailynews.readers where id = ${owner.id}
    `;
    assert.equal(cardRow.kind, "object", "карточка в jsonb обязана быть объектом, а не строкой");
    assert.equal(cardRow.first, "короткие фразы", "пункт голоса читается запросом, а не разбором строки");
    const [shape] = await sql<{ form: string | null }[]>`
      select voice_card->'structure'->>0 as form from dailynews.readers where id = ${owner.id}
    `;
    assert.equal(
      shape.form, "первая строка — заголовок капсом",
      "форма поста доезжает до базы отдельным полем: без неё пост собирается новостной заметкой",
    );
    assert.ok(
      (await readers.getReader(owner.id))?.voice_card?.voice.length,
      "getReader обязан выбирать карточку: без неё пост писался бы настройками подачи",
    );

    // Материал для поста — только из его выпусков. Это и есть проверка права:
    // чужой материал постом не становится.
    const forPost = await posts.postSourceFor(owner.id, ids[0]);
    assert.equal(forPost?.title, "Владелец: GPT-6", "заголовок берётся из его выпуска, а не из items");
    assert.equal(
      await posts.postSourceFor(second.id, ids[0]),
      undefined,
      "материал чужого выпуска постом не становится",
    );

    const saved = await posts.saveDrafts(owner.id, ids[0], [
      { network: "telegram", variant: 1, text: "первый", length: 6, over: false, unverified: [] },
      { network: "telegram", variant: 2, text: "второй", length: 6, over: false, unverified: [] },
    ]);
    assert.equal(saved.length, 2, "оба варианта сохранены: выбор между ними — сигнал о вкусе");
    assert.ok(saved.every((draft) => draft.id > 0), "у каждого черновика свой номер");

    // Номер черновика приходит из браузера: без читателя в условии сосед
    // помечал бы чужую строку.
    assert.equal(
      await posts.takeDraft(second.id, saved[0].id, "первый"),
      false,
      "чужой черновик пометить нельзя",
    );
    assert.ok(await posts.takeDraft(owner.id, saved[0].id, "первый"), "свой — можно");
    const [taken] = await sql<{ taken_text: string | null }[]>`
      select taken_text from dailynews.reader_posts where id = ${saved[0].id}
    `;
    assert.equal(taken.taken_text, null, "не правил — копии текста в базе не появляется");
    await posts.takeDraft(owner.id, saved[1].id, "второй, но переписанный");
    const [edited] = await sql<{ taken_text: string | null }[]>`
      select taken_text from dailynews.reader_posts where id = ${saved[1].id}
    `;
    assert.equal(
      edited.taken_text, "второй, но переписанный",
      "его правка сохраняется: без неё вкус автора не измерить ничем",
    );
    assert.equal(await posts.takenToday(owner.id), 2, "взятые за сутки считаются по читателю");
    assert.equal(await posts.takenToday(second.id), 0, "у соседа свой счёт");
    console.log("  блогер: площадки и черновики у каждого свои, правка сохраняется");

    // Оплаченные этапы обязаны проходить ограничение: этап, которого нет
    // в check, уронил бы запись расхода — а с ней и ответ, уже оплаченный.
    for (const stage of ["voice", "post", "post-quality", "spoken-terms"] as const) {
      await readers.recordCall({
        readerId: owner.id, stage, model: "deepseek-flash", tokensIn: 10, tokensOut: 5, costUsd: 0,
      });
    }
    console.log("  расход: этапы voice, post, post-quality и spoken-terms принимаются");

    // Озвучка: аудио общее по языку, квота — личная.
    //
    // Ключ `item_audio` — материал и язык, а не материал и читатель:
    // озвучивается перевод, а он уже общий по той же паре. Добавь сюда
    // читателя — и второй платил бы синтезом за то, что уже синтезировано.
    // А `audio_sends` наоборот: без `reader_id` в счёте квота считалась бы
    // по всей ленте, и сосед закрывал бы день тому, кто не слушал ничего.
    const [firstItem] = await sql<{ id: number }[]>`
      select id from dailynews.items order by id limit 1
    `;
    const [audioDigest] = await sql<{ id: number }[]>`
      select id from dailynews.digests where reader_id = ${owner.id} order by day desc limit 1
    `;
    await sql`
      insert into dailynews.card_audio (digest_id, item_id, file_id, seconds, voice)
      values (${audioDigest.id}, ${firstItem.id}, 'AgADfake', 600, 'ru-RU-SvetlanaNeural')
    `;
    // Доказывается ключом, а не счётом строк: «строка одна» верно и тогда,
    // когда ключ включает читателя, — просто вставляли один раз.
    // Ключ — карточка, а не «материал + язык»: описание персонально,
    // и общий ключ отдал бы второму читателю текст первого.
    await rejects(
      `insert into dailynews.card_audio (digest_id, item_id, file_id, seconds, voice)
       values (${audioDigest.id}, ${firstItem.id}, 'AgADother', 700, 'ru-RU-SvetlanaNeural')`,
      /card_audio_pkey/,
      "вторая озвучка той же карточки отвергается ключом",
    );
    // Карточка соседа на тот же материал — другая озвучка: у него своё
    // описание, и общая строка звучала бы его новостью чужими словами.
    const [otherDigest] = await sql<{ id: number }[]>`
      select id from dailynews.digests where reader_id = ${second.id} order by day desc limit 1
    `;
    if (otherDigest) {
      await sql`
        insert into dailynews.card_audio (digest_id, item_id, file_id, seconds, voice)
        values (${otherDigest.id}, ${firstItem.id}, 'AgADsecond', 500, 'ru-RU-SvetlanaNeural')
      `;
      const [both2] = await sql<{ n: number }[]>`
        select count(*)::int as n from dailynews.card_audio where item_id = ${firstItem.id}
      `;
      assert.equal(both2.n, 2, "у каждого читателя своя озвучка своей карточки");
    }

    await sql`
      insert into dailynews.audio_sends (reader_id, item_id, seconds, status)
      values (${owner.id}, ${firstItem.id}, 600, 'sent')
    `;
    // Считает тот же код, что и прод: переписанный здесь предикат
    // разъедется с рабочим при первом же новом статусе, и проверка
    // будет доказывать свойство запроса, которого никто не выполняет.
    const { secondsToday: listened } = await import("../pipeline/tts");
    assert.equal(await listened(owner.id), 600, "наслушанное считается по читателю");
    assert.equal(await listened(second.id), 0, "сосед не тратит чужую квоту");

    // Отказ снимает секунды: неудавшаяся озвучка не имеет права съесть
    // день читателю, который так ничего и не услышал.
    //
    // В фикстуре секунды ненулевые нарочно. С нулём сумма оставалась бы
    // прежней и при подсчёте отказов, и утверждение проходило бы, даже
    // если `failed` добавить в список статусов, — то есть не доказывало
    // бы ничего. Прод их зануляет в catch, но строка до этого живёт
    // с оценкой, и именно такую строку надо уметь не считать.
    await sql`
      insert into dailynews.audio_sends (reader_id, item_id, seconds, status, error)
      values (${owner.id}, ${firstItem.id}, 600, 'failed', 'движок молчит')
    `;
    assert.equal(await listened(owner.id), 600, "провалившаяся озвучка квоту не тратит");

    // 0046: произношение принадлежит языку. Один термин живёт на двух
    // языках, а пара «термин + язык» повторно не вставляется. Без этого
    // первый ответивший язык занимал бы строку для всех остальных,
    // и японский читатель получал бы кириллицу.
    await sql`
      insert into dailynews.spoken_terms (term, spoken, language)
      values ('gemini', 'джемини', 'русском'), ('gemini', 'ジェミニ', 'японском')
    `;
    const [twoTongues] = await sql<{ n: number }[]>`
      select count(*)::int as n from dailynews.spoken_terms where term = 'gemini'
    `;
    assert.equal(twoTongues.n, 2, "один термин звучит по-разному на разных языках");
    await rejects(
      `insert into dailynews.spoken_terms (term, spoken, language)
       values ('gemini', 'другое', 'русском')`,
      /spoken_terms_pkey/,
      "пара «термин и язык» повторно не заводится",
    );
    // 0047: язык не подставляется молча. С `default 'русском'` вставка
    // без языка заводила бы русскую строку — тот самый отказ, который
    // 0046 и чинила.
    await rejects(
      `insert into dailynews.spoken_terms (term, spoken) values ('qwen', 'квен')`,
      /language/,
      "язык обязателен: молча русским он больше не становится",
    );

    // 0047: одна незавершённая озвучка на статью, и это ограничение базы.
    // `where not exists` перед вставкой две одновременные транзакции
    // проходят обе — ровно тот случай, от которого оно ставилось.
    await sql`
      insert into dailynews.audio_sends (reader_id, item_id, seconds, status)
      values (${owner.id}, ${firstItem.id}, 100, 'speaking')
    `;
    await rejects(
      `insert into dailynews.audio_sends (reader_id, item_id, seconds, status)
       values (${owner.id}, ${firstItem.id}, 100, 'queued')`,
      /audio_sends_one_in_flight/,
      "вторая озвучка той же статьи в работе отбивается ключом",
    );
    // А законченные копятся: по ним считается квота дня.
    await sql`
      insert into dailynews.audio_sends (reader_id, item_id, seconds, status)
      values (${owner.id}, ${firstItem.id}, 100, 'sent')
    `;
    // Идущая озвучка тратит квоту наравне с законченной, и это не мелочь:
    // иначе читатель ставит в очередь десять статей подряд, пока ни одна
    // не досчиталась, и выходит за предел на порядок.
    assert.equal(
      await listened(owner.id), 800,
      "незавершённая озвучка считается тоже: 600 + 100 в работе + 100 законченных",
    );

    // Шаг — состояние той же строки, и выдуманного шага не бывает.
    await rejects(
      `insert into dailynews.audio_sends (reader_id, item_id, seconds, status)
       values (${owner.id}, ${firstItem.id}, 1, 'напеваю')`,
      /audio_sends_status_check/,
      "выдуманный шаг озвучки отвергается",
    );
    console.log("  озвучка: карточка у каждого своя, квота и шаги — по читателю");

    // --- список колонок читателя не должен отставать от таблицы ------------
    //
    // 0029 завела подписку, effectivePlan её читает, а select в readers.ts
    // остался прежним: платящий читатель считался бесплатным и в вебе,
    // и в прогоне — молча, без единой ошибки. Проверка сверяет форму,
    // а не память: колонка, появившаяся в таблице, обязана доехать до кода.
    const live = (await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'dailynews' and table_name = 'readers'
    `).map((row) => row.column_name);
    // Читаются кодом не все: llm остался неиспользованным, служебные времена
    // никому не нужны. Список исключений короткий и назван вслух — молчаливое
    // исключение здесь ничем не отличалось бы от забытой колонки.
    // digest_size осталась от заказа в штуках: 0040 перевела его в минуты,
    // а колонку не тронула — переименованная, она стала бы ловушкой
    // («размер», а внутри минуты), снесённая отдельной миграцией стоила бы
    // дороже, чем не читается.
    const SKIP = new Set([
      "llm", "created_at", "updated_at", "reader_context_hash", "digest_size",
    ]);
    const loaded = new Set(Object.keys((await readers.getReader(owner.id)) ?? {}));
    const missed = live.filter((column) => !SKIP.has(column) && !loaded.has(column));
    assert.deepEqual(
      missed, [],
      `колонки читателя есть в базе, но не выбираются кодом: ${missed.join(", ")}`,
    );
    console.log(`  читатель: выбираются все ${live.length - SKIP.size} нужных колонок`);
    // Вопрос «дочитал?» спрашивал заголовок из items.title_ru — колонки,
    // которой нет с тех пор, как тексты дайджеста стали персональными.
    // Запрос падал каждую ночь строкой в логе, вопрос не уходил ни разу,
    // а прогон отчитывался успехом. Проверяется сам запрос прогона,
    // а не его копия: копия разъезжается молча.
    assert.equal((await readers.pendingKindleAsks(owner.id)).length, 0, "без отправок спрашивать не о чем");

    const [sentItem] = await sql<{ id: number }[]>`
      select id from dailynews.items order by id limit 1
    `;
    if (sentItem) {
      await sql`
        insert into dailynews.kindle_sends (reader_id, item_id, status, at)
        values (${owner.id}, ${sentItem.id}, 'sent', now() - interval '1 day')
      `;
      const asks = await readers.pendingKindleAsks(owner.id);
      assert.equal(asks.length, 1, "отправленная сутки назад статья попадает в вопрос");
      assert.ok(asks[0].title.length > 0, "заголовок берётся из выпуска читателя или из материала");
      console.log("  «дочитал?»: запрос выполняется и находит заголовок");
    }

    // Расшифровка шла только по свежевставленным материалам: первая
    // неудача — провайдер ответил 401 — и ролик оставался с описанием
    // из фида навсегда, потому что новым он больше никогда не будет.
    const [video] = await sql<{ id: number }[]>`
      insert into dailynews.items (source_id, url, url_canon, title, title_norm, excerpt)
      select id, 'https://www.youtube.com/watch?v=abcdefghijk',
             'youtube.com/watch?v=abcdefghijk', 'Ролик', 'ролик', 'описание из фида'
        from dailynews.sources limit 1
      returning id
    `;
    const waiting = async () => (await sql<{ id: number }[]>`
      select id from dailynews.items
       where transcribed_at is null and url like '%youtube.com/watch%'
    `).length;
    assert.equal(await waiting(), 1, "ролик без отметки ждёт расшифровки");
    await sql`update dailynews.items set transcribed_at = now() where id = ${video.id}`;
    assert.equal(await waiting(), 0, "с отметкой за ним больше не ходят");
    // Оценка живёт вместе с текстом: расшифровка его меняет, и решение
    // о материале нельзя принимать по прежнему. Ролик, расшифрованный
    // не в тот же прогон, что собран, оценён по описанию из фида —
    // у торгового канала это реклама индикаторов, скор 8 из ста.
    await sql`
      insert into dailynews.scores (item_id, total, confidence, axes, model)
      values (${video.id}, 8.4, 0.5, ${sql.json({ kind: "прежняя" })}, 'проба')
    `;
    await sql`delete from dailynews.scores where item_id = ${video.id}`;
    const [left] = await sql<{ n: number }[]>`
      select count(*)::int as n from dailynews.scores where item_id = ${video.id}
    `;
    assert.equal(left.n, 0, "снятая оценка не мешает переоценить ролик по конспекту");
    console.log("  расшифровка: неудачная попытка повторяется, удачная — нет");

    // Фид часто не отдаёт текста вовсе: у Hacker News описания нет
    // по устройству API, рассылка кладёт в него служебную строку
    // в двадцать знаков. Дальше по потоку это выглядело как работающий
    // продукт — оценка по заголовку, «конспект» по заголовку, ни ошибки,
    // ни предупреждения. Запрос догрузки читается здесь целиком: колонка,
    // заведённая миграцией, но не выбранная кодом, ничем себя не выдаёт.
    const mk = async (url: string, canon: string, excerpt: string) => (await sql<{ id: number }[]>`
      insert into dailynews.items (source_id, url, url_canon, title, title_norm, excerpt)
      select id, ${url}, ${canon}, 'Материал', 'материал', ${excerpt}
        from dailynews.sources limit 1
      returning id
    `)[0];

    const bare = await mk("https://example.com/bare", "example.com/bare", "");
    const short = await mk("https://example.com/short", "example.com/short", "Community Wisdom 298");
    const full = await mk("https://example.com/full", "example.com/full", "ф".repeat(SHORT_EXCERPT + 1));
    const clip = await mk(
      "https://www.youtube.com/watch?v=zzzzzzzzzzz", "youtube.com/watch?v=zzzzzzzzzzz", "",
    );

    const needText = async () => (await pendingArticles(sql, WINDOW_DAYS)).map((row) => row.id);
    const queue = await needText();
    assert.equal(queue.includes(bare.id), true, "материал без текста ждёт догрузки");
    assert.equal(queue.includes(short.id), true, "служебная строка из рассылки — тоже отсутствие текста");
    assert.equal(queue.includes(full.id), false, "за статьёй, которую фид отдал целиком, не ходят");
    // Ролику текст достаётся из субтитров, а не со страницы: две догрузки
    // на один материал — это лишний запрос и перезаписанный конспект.
    assert.equal(queue.includes(clip.id), false, "ролики забирает расшифровка, а не догрузка статей");

    await sql`update dailynews.items set enriched_at = now() where id = ${bare.id}`;
    assert.equal((await needText()).includes(bare.id), false, "с отметкой за ним больше не ходят");
    console.log("  догрузка статьи: пустой и служебный текст ждут, полный и ролик — нет");

    // --- сюжет: дедуп, сделанный видимым ---------------------------------------
    // Здесь доказываются две вещи сразу, и обе ломаются молча: сюжет,
    // чей оригинал пришёл из чужого источника, не должен исчезать
    // из выпуска, а счётчик «ещё N твоих источников» не должен считать
    // источник, повторивший сам себя.
    const mkSource = async (label: string, url: string) =>
      (await sql<{ id: number }[]>`
        insert into dailynews.sources (kind, label, url)
        values ('rss', ${label}, ${url}) returning id::int as id
      `)[0].id;
    const mineSource = await mkSource("Моё издание", "https://mine.example.com/feed");
    const theirSource = await mkSource("Чужое издание", "https://theirs.example.com/feed");
    await sql`
      insert into dailynews.reader_sources (reader_id, source_id)
      values (${owner.id}, ${mineSource}) on conflict do nothing
    `;

    const mkItem = async (sourceId: number, slug: string, title: string, minutesAgo: number) =>
      Number((await sql<{ id: number }[]>`
        insert into dailynews.items
               (source_id, url, url_canon, title, title_norm, excerpt, published_at)
        values (${sourceId}, ${`https://example.com/${slug}`}, ${`example.com/${slug}`},
                ${title}, ${normalizeTitle(title)}, 'Текст про видеокарту',
                now() - ${`${minutesAgo} minutes`}::interval)
        returning id
      `)[0].id);

    // Чужое издание опрошено первым и стало оригиналом — ровно так дедуп
    // и выбирает: по меньшему id, то есть по порядку сбора.
    const theirItem = await mkItem(theirSource, "gpu-theirs", "Nvidia unveils new datacenter GPU", 120);
    const myItem = await mkItem(mineSource, "gpu-mine", "Nvidia Unveils New Datacenter GPU!", 60);
    assert.equal(await markDuplicates(sql, [theirItem, myItem]), 1, "перепечатка должна пометиться");
    const [linked] = await sql<{ dup_of: number | null }[]>`
      select dup_of from dailynews.items where id = ${myItem}
    `;
    assert.equal(Number(linked.dup_of), theirItem, "оригиналом стало чужое издание");
    // Оценка есть только у оригинала: повторы в Jev не уезжают.
    await sql`
      insert into dailynews.scores (item_id, topic_id, total, confidence, axes, model)
      values (
        ${theirItem}, ${topicBy("ai-infra").id}, 130, 0.9,
        ${sql.json(axes("ai-infra", "fact") as unknown as Parameters<typeof sql.json>[0])},
        'jev-latest'
      )
    `;

    // Главное: свой источник написал — значит новость обязана дойти,
    // хотя оригинал лежит в источнике, которого у читателя нет.
    const onlyMine = await candidates(sql, owner.id, [mineSource]);
    const mineIds = new Set(onlyMine.map((row) => Number(row.id)));
    assert.ok(mineIds.has(myItem), "сюжет с чужим оригиналом не должен исчезать из отбора");
    assert.equal(
      onlyMine.find((row) => Number(row.id) === myItem)!.source_label,
      "Моё издание",
      "читателю показывается публикация его источника, а не чужая",
    );
    assert.ok(
      onlyMine.find((row) => Number(row.id) === myItem)!.axes.topic !== undefined,
      "оценка сюжета берётся у оригинала и приезжает объектом, а не строкой",
    );

    // И ровно один материал на сюжет: обе публикации доступны — берём оригинал.
    const bothMine = await candidates(sql, owner.id, [mineSource, theirSource]);
    const both = bothMine.filter((row) => [myItem, theirItem].includes(Number(row.id)));
    assert.equal(both.length, 1, `на сюжет отобрано ${both.length} материалов, должен быть один`);
    assert.equal(Number(both[0].id), theirItem, "при своём оригинале предпочитается он");

    // Публикация из своих источников, поехавшая в выпуск вместо чужого
    // оригинала, обязана получить его оценку. На строке в scores держатся
    // лента, событие чтения, отметка с читалки и догрузка выпуска — все
    // внутренним join, и без неё материал исчезает из ленты молча: выпуск
    // собран, письмо ушло, карточки нет.
    const storyTargets = targetsOf(await readers.getReaderTopics(owner.id));
    const storyPicked = await selectSurvivors(
      sql, owner.id, owner.weights, storyTargets, 5, [mineSource],
    );
    assert.deepEqual(
      storyPicked.map((row) => Number(row.id)), [myItem],
      "отбор по своим источникам обязан отдать свою публикацию сюжета",
    );
    const [shared] = await sql<{ n: number }[]>`
      select count(*)::int as n from dailynews.scores where item_id = ${myItem}
    `;
    assert.equal(shared.n, 1, "повтор, поехавший в выпуск, получает оценку своего сюжета");

    const storyDay = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    await makeDigest(owner.id, storyDay, [{ id: myItem, total: 130, title: "Владелец: GPU" }]);
    const storyFeed = await queries.getFeed(owner.id, storyDay);
    assert.deepEqual(
      storyFeed.map((row) => Number(row.id)), [myItem],
      "материал сюжета виден в ленте, а не теряется на join со scores",
    );
    assert.equal(storyFeed[0].source_id, mineSource, "источник карточки — свой, а не оригинала");

    // Сюжет, уже ушедший в выпуск, не возвращается под другим изданием.
    const otherDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await makeDigest(owner.id, otherDay, [{ id: theirItem, total: 130, title: "Владелец: GPU" }]);
    assert.ok(
      !(await candidates(sql, owner.id, [mineSource])).some((row) => Number(row.id) === myItem),
      "вчерашний сюжет не приходит второй раз от другого издания",
    );
    assert.ok(
      !(await candidates(sql, owner.id, [mineSource, theirSource]))
        .some((row) => [myItem, theirItem].includes(Number(row.id))),
      "и не приходит второй раз оригиналом",
    );

    // Витрина: список публикаций считается по источникам читателя.
    const storyBoth = await queries.getStories([mineSource, theirSource], [theirItem]);
    assert.equal(storyBoth.get(theirItem)?.length, 2, "в сюжете обе публикации");
    assert.equal(
      otherSources(storyBoth.get(theirItem)!, theirSource), 1,
      "чужое издание считается ещё одним источником",
    );
    assert.deepEqual(
      storyLines(storyBoth.get(theirItem)!, RU_DICT.feed.story).map((row) => [row.source_label, row.note]),
      [["Чужое издание", "первоисточник"], ["Моё издание", "1 час позже"]],
      "порядок и пометки считаются по времени публикации",
    );

    const storyMine = await queries.getStories([mineSource], [theirItem]);
    assert.equal(
      storyMine.get(theirItem)?.length, 1,
      "чужой источник в «твоих источниках» не показывается",
    );

    // Самоповтор: два материала одного источника — это не «ещё один источник».
    // Своей парой, а не фикстурами из начала прогона: те собраны для дедупа
    // и живут своей жизнью, и однажды «длина 2» сломалась бы по причине,
    // к счётчику источников отношения не имеющей.
    const selfFirst = await mkItem(mineSource, "same-a", "Same outlet reports the story", 90);
    const selfSecond = await mkItem(mineSource, "same-b", "Same Outlet Reports The Story!", 45);
    assert.equal(await markDuplicates(sql, [selfFirst, selfSecond]), 1, "самоповтор должен пометиться");
    const selfStory = await queries.getStories([mineSource], [selfFirst]);
    assert.equal(selfStory.get(selfFirst)?.length, 2, "повтор того же источника лежит в сюжете");
    assert.equal(
      otherSources(selfStory.get(selfFirst)!, mineSource), 0,
      "источник, повторивший сам себя, строки не даёт",
    );

    // Цепочка dup_of. Рождается сама: шортлист серой зоны строится до пометок,
    // и пока отвечает вопрос про дальнее звено, его кандидат успевает стать
    // повтором. Ключом сюжета тогда становится середина — у неё может
    // не быть оценки, и материал уходит из отбора молча.
    const chainRoot = await mkItem(mineSource, "chain-root", "Chain root story", 200);
    const chainMid = await mkItem(mineSource, "chain-mid", "Chain Root Story!", 150);
    const chainTail = await mkItem(mineSource, "chain-tail", "Chain root story?", 100);
    await sql`update dailynews.items set dup_of = ${chainMid} where id = ${chainTail}`;
    await sql`update dailynews.items set dup_of = ${chainRoot} where id = ${chainMid}`;
    const [beforeFlatten] = await sql<{ n: number }[]>`
      select count(*)::int as n from dailynews.items c
        join dailynews.items p on p.id = c.dup_of where p.dup_of is not null
    `;
    assert.equal(beforeFlatten.n, 1, "цепочка должна быть заведена — иначе проверка ничего не ловит");
    assert.equal(
      await flattenDupChains(sql), 1,
      "считаются исправленные материалы, а не переписывания",
    );
    const [afterFlatten] = await sql<{ n: number }[]>`
      select count(*)::int as n from dailynews.items c
        join dailynews.items p on p.id = c.dup_of where p.dup_of is not null
    `;
    assert.equal(afterFlatten.n, 0, "после выпрямления повтор указывает только на корень");
    const chainStory = await queries.getStories([mineSource], [chainRoot]);
    assert.equal(
      chainStory.get(chainRoot)?.length, 3,
      "выпрямленный сюжет собирается целиком, а не делится надвое",
    );

    // Цепочка из четырёх материалов правится за два шага, но исправить надо
    // два из них: третий и четвёртый (второй и так указывает на корень).
    // Сложенные длины ответов насчитали бы три — число в логе прогона
    // означало бы не то, что в нём написано.
    const deep = [
      await mkItem(mineSource, "deep-0", "Deep chain story zero", 400),
      await mkItem(mineSource, "deep-1", "Deep chain story one", 350),
      await mkItem(mineSource, "deep-2", "Deep chain story two", 300),
      await mkItem(mineSource, "deep-3", "Deep chain story three", 250),
    ];
    for (let i = 1; i < deep.length; i++) {
      await sql`update dailynews.items set dup_of = ${deep[i - 1]} where id = ${deep[i]}`;
    }
    assert.equal(await flattenDupChains(sql), 2, "два материала, сколько бы шагов ни ушло");
    const deepStory = await queries.getStories([mineSource], [deep[0]]);
    assert.equal(deepStory.get(deep[0])?.length, 4, "длинная цепочка сходится в один сюжет");

    // Инвариант обеспечивается там, где потребляется: догрузка выпуска
    // зовёт selectSurvivors мимо ночного прогона, и цепочка, оставшаяся
    // с прошлого раза, увела бы ключ сюжета в середину без оценки.
    await sql`update dailynews.items set dup_of = ${deep[1]} where id = ${deep[3]}`;
    await selectSurvivors(sql, owner.id, owner.weights, storyTargets, 5, [mineSource]);
    const [chainsLeft] = await sql<{ n: number }[]>`
      select count(*)::int as n from dailynews.items c
        join dailynews.items p on p.id = c.dup_of where p.dup_of is not null
    `;
    assert.equal(chainsLeft.n, 0, "отбор выпрямляет цепочки сам, а не надеется на прогон");
    console.log("  сюжет: чужой оригинал не прячет новость, самоповтор не считается источником");

    // Reading cache isolation, idempotent settlement and concurrent budget reservations.
    const readingStore = await import("../pipeline/reading-store");
    const budgetReader = await readers.ensureReader(BIG_TELEGRAM_ID + 99, "reading-test");
    await sql`update dailynews.readers set daily_cap_usd=0.10 where id=${budgetReader.id}`;
    const reservations = await Promise.allSettled([
      readingStore.reserveCall(sql, budgetReader.id, 0.07, "verify", "test-model"),
      readingStore.reserveCall(sql, budgetReader.id, 0.07, "verify", "test-model"),
    ]);
    assert.equal(reservations.filter((r) => r.status === "fulfilled").length, 1, "parallel reservations cannot both spend the remaining budget");
    const accepted = reservations.find((r) => r.status === "fulfilled");
    assert.ok(accepted?.status === "fulfilled");
    const callId = accepted.value;
    await readingStore.settleCall(sql, budgetReader.id, callId, { input: 10, output: 5, cached: 3, reasoning: 0, requests: 1 }, 0.01, 100);
    await readingStore.settleCall(sql, budgetReader.id, callId, null, null, 100);
    assert.ok(Math.abs((await readers.spentToday(budgetReader.id)) - 0.01) < 0.000001, "settlement is idempotent and releases the unused reservation");
    const uncertain = await readingStore.reserveCall(sql, budgetReader.id, 0.08, "compose", "test-model");
    await readingStore.settleCall(sql, budgetReader.id, uncertain, null, null, 100);
    assert.ok(Math.abs((await readers.spentToday(budgetReader.id)) - 0.09) < 0.000001, "uncertain paid calls retain a conservative charge");
    const record = { version: 2 as const, sourceVersion: "test-v", availability: "excerpt_only" as const, status: "unavailable" as const, document: null, notice: "Test", seconds: 0 };
    await readingStore.saveDocument(sql, owner.id, deep[0], "reading-private-key", record);
    assert.deepEqual(await readingStore.getDocument(sql, owner.id, "reading-private-key"), record);
    assert.equal(await readingStore.getDocument(sql, second.id, "reading-private-key"), null, "another reader cannot fetch a private summary by its key");
    const lease = await readingStore.acquireAnalysis(sql, deep[0], "reading-shared-key", "v");
    assert.ok(lease.token);
    await assert.rejects(() => readingStore.acquireAnalysis(sql, deep[0], "reading-shared-key", "v"), readingStore.ReadingBusyError);
    await readingStore.finishAnalysis(sql, "reading-shared-key", lease.token, null);
    const renewed = await readingStore.acquireAnalysis(sql, deep[0], "reading-shared-key", "v");
    assert.ok(renewed.token, "failed analysis can be retried");
    await readingStore.finishAnalysis(sql, "reading-shared-key", renewed.token, null);
    assert.equal((await readingStore.recentBaselines(sql, second.id, deep[0], "new story")).length, 0);
    const beforeUnavailable = await readers.digestProgress(owner.id, null);
    const [latestDigest] = await sql<{ id: number }[]>`select id::int from dailynews.digests where reader_id=${owner.id} order by day desc limit 1`;
    const [placeholder] = await sql<{ item_id: number }[]>`select item_id::int from dailynews.digest_items where digest_id=${latestDigest.id} limit 1`;
    if (placeholder) {
      await sql`update dailynews.digest_items set summary_document=${sql.json(record)} where digest_id=${latestDigest.id} and item_id=${placeholder.item_id}`;
      const afterUnavailable = await readers.digestProgress(owner.id, null);
      assert.equal(afterUnavailable.items, beforeUnavailable.items - 1, "unavailable summaries do not fill usable card capacity");
      // Выпуски, собранные прежней версией, держат заглушки. Отбор и прогресс
      // их не считают — лента и поиск не должны быть единственным местом,
      // где читатель встречает «выжимку подготовить не удалось».
      assert.ok(!(await queries.getFeed(owner.id, null)).some(card => card.id === placeholder.item_id), "a stored placeholder never reaches the feed");
      assert.ok(!(await queries.searchArchive(owner.id, 'выжимку')).hits.some(hit => hit.item_id === placeholder.item_id), "a stored placeholder never answers a search");
      await sql`update dailynews.digest_items set summary_document=null where digest_id=${latestDigest.id} and item_id=${placeholder.item_id}`;
    }
    const good = { ...record, status: "verified" as const };
    await readingStore.saveDocument(sql, owner.id, deep[0], "reading-private-key", good);
    await readingStore.saveDocument(sql, owner.id, deep[0], "reading-private-key", record);
    assert.equal((await readingStore.getDocument(sql, owner.id, "reading-private-key"))?.status, "verified", "a concurrent failure cannot downgrade a verified private cache entry");
    console.log("  reading: scoped caches, analysis lease, reservations, settlement and new queries verified");

    // Full source access can reveal an exclusion missing from the RSS teaser.
    const { writeReadingDigest } = await import("../pipeline/reading");
    const { compile: compileReadingRules, applyRules: applyReadingRules, NO_MATCH: noReadingMatch } = await import("../src/lib/rules");
    const excludedNames = [["FictionalBlockedVendor"]];
    await sql`update dailynews.readers set exclude_rules=${sql.json(excludedNames)} where id=${owner.id}`;
    await sql`update dailynews.items set body='<p>FictionalBlockedVendor is named only in the full article.</p>', source_content_kind='article_text' where id=${deep[0]}`;
    const filtered = await writeReadingDigest(sql, [{ id: deep[0], title: 'Neutral title', excerpt: 'Neutral teaser', body: null,
      url: 'https://example.com/full-source', source_label: 'Source', topic_label: 'Topic', total: 0, axes: {} as import("../src/lib/types").Axes }],
      '', { language: 'русском', complexity: 3, style: 'нейтральный' }, { readerId: owner.id });
    assert.deepEqual(filtered.excludedIds, [deep[0]]);
    assert.equal(filtered.items.length, 0, "excluded full sources never become unavailable placeholders");
    assert.equal(filtered.usage.requests, 0, "excluded sources do not spend the generation budget");
    if (placeholder) {
      await sql`update dailynews.items set body='<p>FictionalBlockedVendor appears only here.</p>' where id=${placeholder.item_id}`;
      const feed = await queries.getFeed(owner.id, null);
      const visibility = applyReadingRules(feed, { follow: noReadingMatch, exclude: compileReadingRules(excludedNames) });
      assert.ok(feed.some(item => item.id === placeholder.item_id), "the existing card remains stored");
      assert.ok(!visibility.visible.some(item => item.id === placeholder.item_id), "full-source exclusions also hide existing cards");
    }
    await sql`update dailynews.readers set exclude_rules='[]'::jsonb where id=${owner.id}`;
    console.log("  reading: full-source exclusions prevent generation and hide existing cards");

    // Материал, для которого проверенной выжимки не вышло, карточкой
    // не становится: заглушка «подготовить не удалось» занимала место
    // новости в ленте, в сообщении, в книге и в подкасте. Ключ модели
    // здесь снимается нарочно — отказ нужен настоящий, а сеть не нужна.
    const modelKey = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    try {
      const failed = await writeReadingDigest(sql, [{ id: deep[0], title: 'Neutral title', excerpt: 'Neutral teaser', body: null,
        url: 'https://example.com/full-source', source_label: 'Source', topic_label: 'Topic', total: 0, axes: {} as import("../src/lib/types").Axes }],
        '', { language: 'русском', complexity: 3, style: 'нейтральный' }, { readerId: owner.id, force: true });
      assert.equal(failed.items.length, 0, "a card without a verified summary never reaches the edition");
      assert.deepEqual(failed.unavailableIds, [deep[0]], "the failure is named, not published");
    } finally {
      if (modelKey) process.env.LLM_API_KEY = modelKey;
    }
    console.log("  reading: an unverified summary is dropped instead of shown as a placeholder");

    console.log("\nСхема и запросы проверены на настоящем Postgres.");
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
