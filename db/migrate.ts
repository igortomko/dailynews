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
 * владельцем: RLS на нём обходит только владелец, роль приложения видит
 * пустой список вместо отказа.
 *
 * Накатывать всё подряд нельзя, хотя файлы и писались идемпотентными.
 * Идемпотентность — это про повтор на той же базе, а не про повтор на базе,
 * ушедшей вперёд: 0008 задаёт `reads_event_check` без голосов, 0010 голоса
 * добавляет, и повтор 0008 на живых данных отбивается самой базой. Так и
 * вышло при первом прогоне.
 *
 * Файл, которого нет в журнале, но чьи обещания в схеме уже выполнены,
 * записывается как применённый без выполнения — иначе журнал, заведённый
 * позже самих миграций, никогда не догонит базу. Каждый такой случай
 * печатается: тихо считать миграцию применённой нельзя.
 */
import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { promised, schemaGaps } from "./schema-gap";
import { sql } from "../src/lib/db";

const OWNER = process.env.SUPABASE_DB_URL;

async function main() {
  const gapsBefore = await schemaGaps(sql);

  if (!OWNER) {
    await sql.end();
    if (gapsBefore.length === 0) {
      console.log("База знает всё, что обещают миграции. Накатывать нечего.");
      return;
    }
    console.error(`Базе не хватает ${gapsBefore.length}:`);
    for (const gap of gapsBefore) console.error(`  ${gap.kind} ${gap.name} — из ${gap.from}`);
    console.error(
      "\n! SUPABASE_DB_URL не задан — под ролью приложения DDL запрещён.\n" +
      "  Положить владельческую строку: npx tsx scripts/env-set.ts SUPABASE_DB_URL\n" +
      "  Supabase → Settings → Database → Connection string → Session pooler, роль postgres.",
    );
    process.exit(1);
  }

  const owner = postgres(OWNER, { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 });
  let applied = 0;
  let recorded = 0;
  try {
    // Владельческая строка обязана вести в ту же базу, что и рабочая.
    // Прямой хост и пулер выглядят по-разному, и проект в строке пулера
    // спрятан в имени роли — на глаз они не сверяются. Накатить миграции
    // в соседний проект общего аккаунта — ошибка, которую никто не заметит:
    // команды пройдут, журнал наполнится, а приложение останется без колонок.
    const [here] = await sql<{ mark: string }[]>`
      select md5(coalesce(reader_context, '') || digest_size::text) as mark
        from dailynews.profile where id = 1
    `;
    const [there] = await owner<{ mark: string }[]>`
      select md5(coalesce(reader_context, '') || digest_size::text) as mark
        from dailynews.profile where id = 1
    `;
    if (!here || !there || here.mark !== there.mark) {
      console.error(
        "\n! SUPABASE_DB_URL ведёт не в ту базу, с которой работает приложение.\n" +
        "  Профили в них разные, значит это разные проекты Supabase.\n" +
        "  Возьми строку из того же проекта, что и DATABASE_URL.",
      );
      process.exit(1);
    }

    const journal = await owner<{ name: string }[]>`select name from dailynews.migrations`;
    const known = new Set(journal.map((row) => row.name));
    const files = readdirSync("db/migrations").filter((file) => file.endsWith(".sql")).sort();
    const pending = files.filter((file) => !known.has(file.replace(/\.sql$/, "")));

    if (pending.length === 0) {
      console.log(`Журнал знает все ${files.length} миграций. Накатывать нечего.`);
      return;
    }
    console.log(`В журнале ${known.size} из ${files.length}, к разбору ${pending.length}.`);

    // Какой файл за какой разрыв отвечает: если разрывов у файла нет,
    // его обещания в базе уже выполнены.
    const owed = new Set(gapsBefore.map((gap) => gap.from));

    for (const file of pending) {
      const name = file.replace(/\.sql$/, "");
      if (!owed.has(file)) {
        console.log(`  ${file}: обещанное в базе уже есть — записываю в журнал, не выполняя`);
        await owner`insert into dailynews.migrations (name) values (${name}) on conflict (name) do nothing`;
        recorded++;
        continue;
      }
      console.log(`→ ${file}`);
      await owner.unsafe(readFileSync(`db/migrations/${file}`, "utf8"));
      console.log("  применена");
      applied++;
    }
  } finally {
    await owner.end({ timeout: 10 }).catch(() => {});
    await sql.end().catch(() => {});
  }

  // Проверяем результат рабочей ролью: «команда прошла» и «база изменилась» —
  // разные утверждения, и вторая проверяется тем же, чем ходит приложение.
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
  console.log(`\n✓ выполнено ${applied}, записано без выполнения ${recorded}, разрывов не осталось`);

  if (applied > 0) await warnProdBehind();
}

/**
 * База одна на все ветки, а прод обслуживает одну из них.
 *
 * 19 сентября 2026 миграция 0020 уехала в живую базу из своего worktree
 * и снесла `profile`, `items.title_ru` и `digests.item_ids` — всё, на чём
 * стоял код, развёрнутый из main. Сайт лёг целиком, и ни одна проверка
 * этого не поймала: `schema-gap` ищет то, чего базе не хватает, а здесь
 * база ушла вперёд. Отказ выглядел как успех ровно до первого открытия
 * страницы.
 *
 * Поэтому после каждой применённой миграции спрашиваем прод, какой коммит
 * он обслуживает. Чужой коммит означает: прод сейчас говорит со схемой,
 * которой уже нет. Не падаем — миграцию откатывать поздно, — но говорим
 * громко и единственным нужным словом: разворачивай.
 */
async function warnProdBehind() {
  const base = process.env.APP_URL;
  if (!base) return;

  let served: string;
  try {
    const response = await fetch(new URL("/api/version", base), {
      signal: AbortSignal.timeout(5000),
    });
    served = ((await response.json()) as { commit?: string }).commit ?? "";
  } catch {
    return; // прод недостижим — это не повод падать здесь
  }
  if (!served) return;

  const { execFileSync } = await import("node:child_process");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (served === head) return;

  // Коммит прода среди предков HEAD — прод просто отстал на свои же
  // миграции, и разворачивание догонит. Иначе это другая ветка, и прод
  // уже сейчас обращается к тому, чего в базе нет.
  let ancestor = false;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", served, head], { stdio: "ignore" });
    ancestor = true;
  } catch {
    ancestor = false;
  }

  console.error(
    `\n! схема изменилась, а ${base} обслуживает ${served.slice(0, 8)}, не ${head.slice(0, 8)}` +
    (ancestor
      ? "\n  Прод отстал от схемы — разворачивай: ./deploy/deploy.sh"
      : "\n  Это другая ветка. Прод сейчас говорит со схемой, которой уже нет —" +
        "\n  так 19 сентября 2026 лёг весь сайт. Разворачивай ту ветку, чьи миграции" +
        "\n  только что применены: ./deploy/deploy.sh"),
  );
}

/**
 * Диагностика: одну и ту же схему видят рабочая роль и владелец.
 * Расхождение между ними — это не «миграция не доехала», а «доехала,
 * но роль её не видит», и лечится оно грантом, а не повтором миграции.
 */
async function diagnose() {
  const mine = await schemaGaps(sql);
  console.log(`рабочая роль не видит: ${mine.length}`);
  for (const gap of mine) console.log(`  ${gap.kind} ${gap.name} — из ${gap.from}`);

  if (!OWNER) {
    await sql.end();
    return;
  }
  const owner = postgres(OWNER, { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 });
  const theirs = await schemaGaps(owner as unknown as typeof sql);
  console.log(`\nвладелец не видит: ${theirs.length}`);
  for (const gap of theirs) console.log(`  ${gap.kind} ${gap.name} — из ${gap.from}`);

  // Переопределение ограничения под тем же именем сверка формы не видит,
  // а именно оно решает, сохранится ли «60 новостей». Печатаем текстом.
  const checks = await owner<{ conname: string; def: string }[]>`
    select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'dailynews.profile'::regclass and contype = 'c'
     order by conname
  `;
  console.log("\nограничения profile:");
  for (const row of checks) console.log(`  ${row.conname}: ${row.def}`);

  const journal = await owner<{ name: string; applied_at: Date }[]>`
    select name, applied_at from dailynews.migrations order by name desc limit 5
  `;
  console.log(`\nпоследние записи журнала:`);
  for (const row of journal) console.log(`  ${row.name}  ${row.applied_at.toISOString().slice(0, 16)}`);

  await owner.end({ timeout: 10 }).catch(() => {});
  await sql.end().catch(() => {});
}

// Разбор файлов нужен и без сети: так видно, что вообще обещано.
if (process.argv.includes("--check")) {
  diagnose().catch(async (error) => {
    console.error(error.message ?? error);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
} else if (process.argv.includes("--list")) {
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
