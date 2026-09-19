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
 * Чего он не видит: индексы, данные, переименования и переопределение
 * ограничения под тем же именем. 0018 снимает profile_digest_size_check
 * и ставит его же с новым потолком — по имени эти два неразличимы,
 * и такую правку проверка пропустит. Признать это честнее, чем сделать
 * вид, что сверка полная.
 */
import { readFileSync, readdirSync } from "node:fs";

type Db = typeof import("../src/lib/db")["sql"];

export type Gap = { kind: "таблица" | "колонка" | "ограничение"; name: string; from: string };

/** Что миграции обещают: таблицы, колонки по таблицам и именованные ограничения. */
export function promised(dir = "db/migrations") {
  const tables: { table: string; from: string }[] = [];
  const columns: { table: string; column: string; from: string }[] = [];
  // Таблица у ограничения помнится не ради красоты: увезённая таблица
  // уносит свои ограничения с собой, и без этой связи 0018 требовал бы
  // profile_digest_size_check ещё долго после того, как profile не стало.
  const constraints: { name: string; table: string; from: string }[] = [];

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
      for (const found of statement.matchAll(/add\s+constraint\s+(\w+)/gi)) {
        constraints.push({ name: found[1], table, from: file });
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

export async function schemaGaps(sql: Db, dir = "db/migrations"): Promise<Gap[]> {
  const { tables, columns, constraints } = promised(dir);

  const liveTables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables where table_schema = 'dailynews'
  `;
  const hasTable = new Set(liveTables.map((row) => row.table_name));

  const live = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns
     where table_schema = 'dailynews'
  `;
  const has = new Set(live.map((row) => `${row.table_name}.${row.column_name}`));

  const named = await sql<{ conname: string }[]>`
    select c.conname
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
     where n.nspname = 'dailynews'
  `;
  const hasConstraint = new Set(named.map((row) => row.conname));

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
      .filter((entry) => !hasConstraint.has(entry.name))
      .map((entry): Gap => ({ kind: "ограничение", name: entry.name, from: entry.from })),
  ];
}
