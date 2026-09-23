/**
 * Отчёт по черновикам постов: какой вариант он берёт и как взятое заходит.
 *
 * Два вопроса, на которые правила промпта отвечали по чужим данным.
 *
 * Первый — какой вариант он берёт. Правило «первый вариант — реакция,
 * второй — разбор» выведено из корпуса чужих каналов; если реакцию он
 * не берёт никогда, правило ему вредит, и видно это только здесь.
 *
 * Второй — как взятое заходит. Посты из черновиков ищутся в его публичном
 * канале по тексту, и их просмотры сравниваются с медианой остальных его
 * постов. Сравнение внутри его канала, а не с чужими: у разных каналов
 * разные аудитории, и абсолютные числа между ними несравнимы. Найденный
 * пост пишется в `reader_posts.published_url` и `views` — под это колонки
 * и заводились (0036). Только Telegram: t.me/s/ отдаёт просмотры бесплатно,
 * а X берёт деньги за каждый прочитанный твит.
 *
 *   npm run drafts:report                 # владелец
 *   npm run drafts:report -- --reader 7
 */
import { sql } from "../src/lib/db";
import { getChannels } from "../src/lib/readers";
import type { Source } from "../src/lib/types";
import { fetchTelegramFeed } from "./fetch";
import { MATURE_MS, matchPublished } from "./drafts-match";

const median = (numbers: number[]): number | null => {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function main() {
  const at = process.argv.indexOf("--reader");
  const [reader] = at > 0
    ? await sql<{ id: number }[]>`select id::int as id from dailynews.readers where id = ${Number(process.argv[at + 1])}`
    : await sql<{ id: number }[]>`select id::int as id from dailynews.readers where owner`;
  if (!reader) throw new Error("читатель не найден");

  const variants = await sql<{ network: string; variant: number; taken: number; edited: number }[]>`
    select network, variant, count(*)::int as taken,
           count(*) filter (where taken_text is not null)::int as edited
      from dailynews.reader_posts
     where reader_id = ${reader.id} and taken_at is not null
     group by network, variant
     order by network, variant
  `;
  const offered = await sql<{ network: string; n: number }[]>`
    select network, count(distinct item_id)::int as n
      from dailynews.reader_posts
     where reader_id = ${reader.id}
     group by network
  `;

  console.log(`Читатель ${reader.id}: какой вариант он берёт`);
  if (variants.length === 0) console.log("  взятых черновиков ещё нет");
  for (const row of variants) {
    const total = offered.find((entry) => entry.network === row.network)?.n ?? 0;
    // Имена вариантов — из требований сетей в `networks.ts`.
    const name =
      row.network === "telegram" ? (row.variant === 1 ? "реакция" : "разбор")
      : row.network === "threads" ? (row.variant === 1 ? "реакция" : "задело")
      : `вариант ${row.variant}`;
    console.log(
      `  ${row.network.padEnd(9)} ${name.padEnd(10)} взял ${row.taken} из ${total} предложенных, правил ${row.edited}`,
    );
  }

  const telegram = (await getChannels(reader.id)).find((channel) => channel.network === "telegram");
  if (!telegram?.handle) {
    console.log("\nКанал Telegram не подключён — сравнивать просмотры не с чем.");
    return;
  }

  const feed = await fetchTelegramFeed({ id: 0, kind: "telegram", url: telegram.handle, config: {} } as Source);
  const now = Date.now();
  const posts = feed.items
    .filter((item) => item.published_at && now - item.published_at.getTime() > MATURE_MS)
    .map((item) => ({ url: item.url, text: item.excerpt, at: item.published_at, views: item.views ?? null }));

  const drafts = await sql<{ id: number; text: string; taken_at: Date }[]>`
    select id::int as id, coalesce(taken_text, text) as text, taken_at
      from dailynews.reader_posts
     where reader_id = ${reader.id} and network = 'telegram' and taken_at is not null
  `;
  const found = matchPublished(drafts, posts);
  for (const [id, post] of found) {
    await sql`
      update dailynews.reader_posts
         set published_url = ${post.url}, views = ${post.views}, checked_at = now()
       where id = ${id} and reader_id = ${reader.id}
    `;
  }

  const fromDrafts = new Set([...found.values()]);
  const ours = [...fromDrafts].map((post) => post.views).filter((v): v is number => v !== null);
  const rest = posts.filter((post) => !fromDrafts.has(post)).map((post) => post.views)
    .filter((v): v is number => v !== null);
  const [a, b] = [median(ours), median(rest)];

  console.log(`\n@${telegram.handle}: ${posts.length} зрелых постов на странице канала, из черновиков — ${ours.length}`);
  if (a === null || b === null) {
    console.log("  сравнивать пока не с чем");
  } else {
    console.log(`  медиана просмотров: из черновиков ${a}, остальные ${b} (${Math.round((a / b - 1) * 100)}%)`);
    if (ours.length < 10) console.log("  меньше десяти пар — это шум, а не измерение");
  }
}

if (process.argv[1]?.endsWith("drafts-report.ts")) {
  main().then(() => sql.end(), async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await sql.end();
    process.exit(1);
  });
}
