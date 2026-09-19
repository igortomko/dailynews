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
  const { getSources, getDigestDays, getFeed } = await import("../src/lib/queries");
  const { allReaders, getReaderTopics } = await import("../src/lib/readers");

  const [meta] = await sql<{ who: string; path: string }[]>`
    select current_user as who, current_setting('search_path') as path
  `;
  console.log(`роль: ${meta.who} · search_path: ${meta.path}`);

  // Последовательно, а не Promise.all: проверке спешить некуда, а веер
  // запросов на общий пулер иногда упирается в выдачу соединений.
  const readers = await allReaders();
  const sources = await getSources();
  console.log(`источники: ${sources.length} (включено ${sources.filter((s) => s.active).length})`);
  console.log(`читателей: ${readers.length}`);

  for (const reader of readers) {
    const topics = await getReaderTopics(reader.id);
    const [latestDay] = await getDigestDays(reader.id);
    const feed = latestDay ? await getFeed(reader.id, latestDay) : [];
    const who = reader.username ? `@${reader.username}` : `читатель ${reader.id}`;
    console.log(
      `  ${who}${reader.owner ? " (владелец)" : ""}: дайджест ${reader.digest_size}, ` +
      `онбординг ${reader.onboarded_at ?? "не пройден"}, ` +
      `темы ${topics.map((t) => t.slug).join(", ") || "не заданы"}, ` +
      `в последнем выпуске ${feed.length}`,
    );
  }
  await sql.end();
}

main().catch((error) => {
  console.error(String(error).slice(0, 400));
  process.exit(1);
});
