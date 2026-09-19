/**
 * Проверка живого подключения и того, что приложение видит свою схему.
 * Секретов не печатает — только то, что вернула база.
 *
 *   npx tsx --env-file=.env db/ping.ts
 */
import { createRequire } from "node:module";

async function main() {
  const require_ = createRequire(import.meta.url);
  const Module = require_("node:module") as any;
  const emptyStub = require_.resolve("server-only").replace(/index\.js$/, "empty.js");
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...rest: unknown[]) {
    return request === "server-only" ? emptyStub : resolve.call(this, request, ...rest);
  };

  const { sql } = await import("../src/lib/db");
  const { getProfile, getTopics, getSources, getFeed } = await import("../src/lib/queries");

  const [meta] = await sql<{ who: string; path: string }[]>`
    select current_user as who, current_setting('search_path') as path
  `;
  console.log(`роль: ${meta.who} · search_path: ${meta.path}`);

  // Последовательно, а не Promise.all: проверке спешить некуда, а веер
  // из четырёх запросов на общий пулер иногда упирается в выдачу соединений.
  const profile = await getProfile();
  const topics = await getTopics();
  const sources = await getSources();
  const [latestDay] = await (await import("../src/lib/queries")).getDigestDays();
  const feed = latestDay ? await getFeed(latestDay) : [];
  console.log(`профиль: дайджест ${profile.digest_size}, онбординг ${profile.onboarded_at ?? "не пройден"}`);
  console.log(`темы: ${topics.map((t) => t.slug).join(", ")}`);
  console.log(`источники: ${sources.length} (включено ${sources.filter((s) => s.active).length})`);
  console.log(`лента: ${feed.length}`);

  // Последним и громко: код, уехавший раньше миграции, роняет страницу
  // на несуществующей колонке, и заметно это только при нажатии на ту
  // самую настройку. Один раз так и было.
  const { schemaGaps } = await import("./schema-gap");
  const gaps = await schemaGaps(sql);
  await sql.end();

  if (gaps.length === 0) {
    console.log("схема: всё, что обещают миграции, в базе есть");
    return;
  }
  console.error(`\n! база отстаёт от кода: не хватает ${gaps.length}`);
  for (const gap of gaps) console.error(`  ${gap.kind} ${gap.name} — из ${gap.from}`);
  console.error("\nПрименяет владелец через SQL Editor: роль приложения не владелец таблиц.");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(String(error).slice(0, 400));
  process.exit(1);
});
