/**
 * Проверка уже сохранённых адресов живым запросом, как в прогоне: с окном
 * свежести и потолком на число записей. Добавление нового источника идёт
 * другим путём — `pipeline/detect.ts`, там определяется ещё и тип.
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

if (process.argv[2]) {
  const sources = process.argv.slice(2).map((url, index) => asSource(url, index));
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
