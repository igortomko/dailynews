/**
 * Проверка источников живым запросом. Тем же кодом пользуется интерфейс,
 * когда добавляешь фид руками: каталог из непроверенных адресов —
 * это молча пустая вкладка через неделю.
 *
 *   npx tsx pipeline/check-sources.ts <url> [url...]
 */
import { fetchAllSources } from "./fetch";
import type { Source } from "../src/lib/types";

export function asSource(url: string, id = 0): Source {
  return {
    id,
    kind: url.includes("reddit.com") ? "reddit" : "rss",
    label: url,
    url,
    config: {},
    active: true,
    last_ok_at: null,
    last_count: null,
    last_error: null,
  };
}

export async function checkFeed(url: string) {
  const [result] = await fetchAllSources([asSource(url)]);
  return result.ok
    ? { ok: true as const, count: result.items.length, sample: result.items[0]?.title ?? "" }
    : { ok: false as const, count: 0, sample: "", error: result.error };
}

if (process.argv[2]) {
  const sources = process.argv.slice(2).map(asSource);
  fetchAllSources(sources).then((results) => {
    for (const r of results) {
      console.log(
        r.ok
          ? `OK   ${String(r.items.length).padStart(3)}  ${r.source.url}  ${r.items[0]?.title.slice(0, 55) ?? ""}`
          : `FAIL   0  ${r.source.url}  ${r.error}`,
      );
    }
  });
}
