/**
 * Чего код уже требует, а в живой базе ещё нет.
 *
 * Развёртывание сверяет живой сервис с отправленным коммитом, но базу
 * не сверял никто. Код уехал на прод раньше миграции, и страница падала
 * на несуществующей колонке — увидеть это можно было, только нажав на ту
 * самую настройку. Так и вышло: 0017 и 0018 не доехали, персонализация
 * не сохранялась вовсе, а ошибка выглядела как случайная.
 *
 * Считать по журналу `dailynews.migrations` нельзя: на нём RLS, роль
 * приложения не видит ни строки и получает пустой список вместо отказа.
 * Проверка по нему сообщала бы, что не применено ничего, — и ей перестали
 * бы верить на второй день. Поэтому сверяется форма: колонки и ограничения,
 * которые миграции обещают добавить, ищутся в каталоге живой базы.
 *
 * Разбор нарочно грубый — `create table`, `add column if not exists`
 * и `add constraint`, с учётом обратных `drop`: 0015 завела расписание,
 * 0016 его убрала, 0019 увезла profile целиком.
 *
 * Колонки внутри `create table` не разбираются: за них отвечает сама
 * таблица. Нет таблицы — сообщается она одна, а не десяток её колонок.
 *
 * У именованных ограничений сверяется не только имя, но и содержимое:
 * значения, которые обещает миграция, ищутся в определении живого
 * ограничения. Иначе переопределение под тем же именем проходит молча —
 * 0018 снимает profile_digest_size_check и ставит его же с новым потолком,
 * 0025 и 0026 так же расширяют список видов источника. По имени эти пары
 * неразличимы, и неприменённая миграция выглядела бы как применённая.
 *
 * Чего он не видит: индексы, данные и переименования.
 */
import { readFileSync, readdirSync } from "node:fs";

type Db = typeof import("../src/lib/db")["sql"];

export type Gap = { kind: "таблица" | "колонка" | "ограничение"; name: string; from: string };

/** Что миграции обещают: таблицы, колонки по таблицам и именованные ограничения. */
/**
 * Разбор каталога не меняется в пределах прогона, а спрашивают его трижды:
 * сверка до накатывания, отбор пропускаемых файлов и сверка после. Парсить
 * одни и те же сорок файлов три раза незачем.
 */
const parsed = new Map<string, ReturnType<typeof parseDir>>();

export function promised(dir = "db/migrations") {
  const hit = parsed.get(dir);
  if (hit) return hit;
  const fresh = parseDir(dir);
  parsed.set(dir, fresh);
  return fresh;
}

function parseDir(dir: string) {
  const tables: { table: string; from: string }[] = [];
  const columns: { table: string; column: string; from: string }[] = [];
  // Таблица у ограничения помнится не ради красоты: увезённая таблица
  // уносит свои ограничения с собой, и без этой связи 0018 требовал бы
  // profile_digest_size_check ещё долго после того, как profile не стало.
  // Значения из тела — чтобы увидеть переопределение под тем же именем.
  const constraints: { name: string; table: string; from: string; values: string[] }[] = [];

  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    const text = readFileSync(`${dir}/${file}`, "utf8");

    for (const found of text.matchAll(/create\s+table\s+if\s+not\s+exists\s+dailynews\.(\w+)/gi)) {
      tables.push({ table: found[1], from: file });
    }
    // Увезённая таблица уносит с собой и обещания своих колонок: 0019
    // забрала profile целиком, и требовать profile.complexity после неё
    // значит показывать расхождение там, где всё правильно.
    for (const found of text.matchAll(/drop\s+table\s+if\s+exists\s+dailynews\.(\w+)/gi)) {
      const gone = found[1].toLowerCase();
      for (let i = tables.length - 1; i >= 0; i--) {
        if (tables[i].table.toLowerCase() === gone) tables.splice(i, 1);
      }
      for (let i = columns.length - 1; i >= 0; i--) {
        if (columns[i].table.toLowerCase() === gone) columns.splice(i, 1);
      }
      for (let i = constraints.length - 1; i >= 0; i--) {
        if (constraints[i].table.toLowerCase() === gone) constraints.splice(i, 1);
      }
    }

    // Один alter table может добавлять несколько колонок через запятую,
    // поэтому таблица берётся из заголовка, а колонки — из всего оператора.
    for (const statement of text.split(";")) {
      const table = statement.match(/alter\s+table\s+dailynews\.(\w+)/i)?.[1];
      if (!table) continue;
      for (const found of statement.matchAll(/add\s+column\s+if\s+not\s+exists\s+(\w+)/gi)) {
        columns.push({ table, column: found[1], from: file });
      }
      // Вместе с именем запоминается, что ограничение обещает: числа
      // и строковые значения из его тела. По имени переопределение
      // неотличимо от уже применённого.
      for (const found of statement.matchAll(/add\s+constraint\s+(\w+)([\s\S]*?)(?=add\s+constraint|$)/gi)) {
        constraints.push({
          name: found[1],
          table,
          from: file,
          values: [...found[2].matchAll(/'([^']*)'|\b(\d+)\b/g)].map((m) => m[1] ?? m[2]),
        });
      }
      // Колонку могли добавить и снять следом: 0015 завела расписание,
      // 0016 его убрала. Без этого проверка требовала бы от базы то,
      // чего код давно не ждёт, и на неё перестали бы смотреть.
      for (const found of statement.matchAll(/drop\s+column\s+if\s+exists\s+(\w+)/gi)) {
        const gone = found[1].toLowerCase();
        for (let i = columns.length - 1; i >= 0; i--) {
          if (columns[i].table === table && columns[i].column.toLowerCase() === gone) columns.splice(i, 1);
        }
      }
      for (const found of statement.matchAll(/drop\s+constraint\s+if\s+exists\s+(\w+)/gi)) {
        const gone = found[1].toLowerCase();
        for (let i = constraints.length - 1; i >= 0; i--) {
          if (constraints[i].name.toLowerCase() === gone) constraints.splice(i, 1);
        }
      }
    }
  }
  return { tables, columns, constraints };
}

/**
 * Операторы, которых сверка формы схемы не видит вовсе.
 *
 * Своя запись в журнал не в счёт: она стоит в конце каждого файла
 * и про саму миграцию не говорит ничего.
 */
const INVISIBLE =
  /create\s+(unique\s+)?index|update\s+dailynews\.|delete\s+from\s+dailynews\.|comment\s+on|insert\s+into\s+dailynews\.(?!migrations)/i;

/** Операторы, которые сверка формы схемы умеет проверить. */
const DECLARING =
  /create\s+table\s+if\s+not\s+exists\s+dailynews\.|drop\s+table\s+if\s+exists\s+dailynews\.|add\s+column\s+if\s+not\s+exists|drop\s+column\s+if\s+exists|add\s+constraint\s/i;

/**
 * Что сверка формы схемы может сказать о каждом файле.
 *
 * Считается по тексту файла, а не по тому, что от его обещаний осталось
 * к концу каталога. Разница не теоретическая: ограничение из 0035 позже
 * переопределяет 0037, и по остатку 0035 выглядела бы файлом без обещаний —
 * то есть подлежащей выполнению. А выполнить её заново значит вернуть
 * `model_calls_stage_check` к старому списку этапов и стереть чужие,
 * ровно как уже было однажды.
 *
 * `skippable` — файл можно записать в журнал не выполняя: он что-то обещал
 * форме схемы, и обещанное в базе есть. Без этой поблажки журнал, заведённый
 * позже самих миграций, не догнал бы базу никогда.
 *
 * `silent` — файл не обещал форме схемы ничего: индекс, `update`,
 * `comment on`. Её молчание о нём не значит ровным счётом ничего, и до
 * починки ворот такие уходили в журнал невыполненными. Так прошла
 * 0041_story_index (индекса в базе не появилось) и 0031 — вместе
 * с тринадцатью источниками, которые должна была убрать.
 *
 * Между ними третий случай: файл делает и то и другое. 0012 заводит
 * `summary_axes` и индекс по нему, 0030 — `deleted_at` и `sources_live_idx`.
 * Колонка на месте, индекса может не быть, поэтому такой файл не пропускается
 * тоже — но и в отчёт о невыполненных не идёт: выполнялся он из-за колонки.
 */
export function fileCoverage(dir = "db/migrations"): {
  skippable: Set<string>;
  silent: Set<string>;
} {
  const skippable = new Set<string>();
  const silent = new Set<string>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    const text = readFileSync(`${dir}/${file}`, "utf8");
    if (!DECLARING.test(text)) silent.add(file);
    else if (!INVISIBLE.test(text)) skippable.add(file);
  }
  return { skippable, silent };
}

/** Короткий вход для тех, кому нужен только первый набор. */
export const skippableFiles = (dir = "db/migrations") => fileCoverage(dir).skippable;

export async function schemaGaps(sql: Db, dir = "db/migrations"): Promise<Gap[]> {
  const { tables, columns, constraints } = promised(dir);

  /**
   * Пустой ответ здесь означает не «схемы нет», а «прочитать не вышло»:
   * сверка тогда объявляет недостающим весь список разом, и это читается
   * как «ни одна миграция не применена» — развёртывание встаёт с ложной
   * причиной, и искать её идут не туда.
   *
   * Пустым этот запрос приходил на PGlite за сокетом (db/verify.ts),
   * и причина была не в базе: лишний `ReadyForQuery` после отбитого
   * запроса уводил ответы на один вперёд, и сюда приезжал чужой. Причина
   * снята в db/free-port.ts; отказ остаётся, потому что читается он одинаково
   * при любой причине, а повтор ту поломку только маскировал.
   */
  const liveTables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables where table_schema = 'dailynews'
  `;
  if (liveTables.length === 0) {
    throw new Error("живая схема dailynews прочиталась пустой — сверять не с чем");
  }
  const hasTable = new Set(liveTables.map((row) => row.table_name));

  const live = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns
     where table_schema = 'dailynews'
  `;
  const has = new Set(live.map((row) => `${row.table_name}.${row.column_name}`));

  const named = await sql<{ conname: string; def: string }[]>`
    select c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
     where n.nspname = 'dailynews'
  `;
  const liveConstraint = new Map(named.map((row) => [row.conname, row.def]));

  return [
    ...tables
      .filter((entry) => !hasTable.has(entry.table))
      .map((entry): Gap => ({ kind: "таблица", name: entry.table, from: entry.from })),
    ...columns
      // Колонки отсутствующей таблицы не перечисляем: десяток строк
      // об одном и том же прячет остальные расхождения.
      .filter((entry) => hasTable.has(entry.table) && !has.has(`${entry.table}.${entry.column}`))
      .map((entry): Gap => ({ kind: "колонка", name: `${entry.table}.${entry.column}`, from: entry.from })),
    ...constraints
      .filter((entry) => {
        // Таблицы нет — её ограничения уехали вместе с ней.
        if (!hasTable.has(entry.table)) return false;
        const live = liveConstraint.get(entry.name);
        if (live === undefined) return true;
        // Обещанное значение, которого в живом определении нет, означает,
        // что ограничение осталось прежним: kind = 'email' отвергался бы
        // базой при коде, который его уже пишет.
        return entry.values.some((value) => !live.includes(value));
      })
      .map((entry): Gap => ({ kind: "ограничение", name: entry.name, from: entry.from })),
  ];
}

/**
 * Номера, занятые дважды: файл, который вот-вот применится, и запись
 * в журнале под тем же номером, но с другим именем.
 *
 * Чистая функция, потому что проверка обещана в AGENTS.md с тех пор, как
 * 0019 разошлась на три ветки, — а в коде её не было. В журнале живой базы
 * 19 сентября 2026 оказалось три файла под номером 0036 (`blogger`,
 * `interests_stage`, `item_transcribed`), и два из них переопределяли одно
 * и то же ограничение. Разошлись они бы молча: на живой базе порядок решает
 * время применения, на чистой — имя файла, и совпало это по удаче.
 *
 * Не отказ, а окрик. Остановиться значит оставить схему без миграции,
 * которую код на проде уже ждёт, — это хуже самого столкновения.
 */
export function numberCollisions(
  pending: string[],
  journal: Iterable<string>,
): { file: string; taken: string[] }[] {
  const numberOf = (name: string) => name.slice(0, 4);
  const byNumber = new Map<string, string[]>();
  for (const name of journal) {
    const key = numberOf(name);
    byNumber.set(key, [...(byNumber.get(key) ?? []), name]);
  }
  return pending
    .map((file) => ({
      file,
      // Своё имя из списка убираем: файл, уже стоящий в журнале, сам с собой
      // не сталкивается — он просто применён.
      taken: (byNumber.get(numberOf(file)) ?? []).filter(
        (name) => name !== file.replace(/\.sql$/, ""),
      ),
    }))
    .filter((row) => row.taken.length > 0);
}
