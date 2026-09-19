import { XMLParser } from "fast-xml-parser";
import type { RawItem, Source } from "../src/lib/types";

const UA = "dailynews/2.0 (+https://github.com/igortomko/dailynews)";
const MAX_BYTES = 5_000_000;

/**
 * Источники настраиваются пользователем, то есть адрес приходит извне.
 * Поэтому: только http(s), свой таймаут и потолок на размер ответа —
 * иначе один зависший фид держит весь прогон.
 */
async function get(url: string, timeoutMs = 20_000): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`протокол не поддерживается: ${parsed.protocol}`);
  }
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "*/*" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new Error(`ответ ${length} байт, больше потолка`);

  const body = await res.text();
  if (body.length > MAX_BYTES) throw new Error("ответ больше потолка");
  return body;
}

async function getJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
  return JSON.parse(await get(url, timeoutMs)) as T;
}

/** Запускает задачи пачками по `limit`, чтобы не раскладывать источник на лопатки. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// RSS / Atom — универсальный адаптер. Через него же ходит Reddit (/r/x/.rss),
// YouTube, arXiv, Substack: отдельные фетчеры для них не нужны.
// ---------------------------------------------------------------------------
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  trimValues: true,
});

function firstString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return firstString(value[0]);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("#text" in record) return firstString(record["#text"]);
    if ("@href" in record) return firstString(record["@href"]);
  }
  return "";
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  mdash: "—", ndash: "–", hellip: "…", middot: "·", deg: "°", euro: "€",
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    // Числовые сущности пишут и с ведущими нулями (&#039;), и в шестнадцатеричном
    // виде (&#x2019;). Без общего разбора «EU&#039;s» доезжает до заголовка как есть.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(value: unknown): Date | null {
  const raw = firstString(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function fetchRss(source: Source): Promise<RawItem[]> {
  const xml = await get(source.url);
  const doc = parser.parse(xml) as Record<string, any>;

  // RSS 2.0 кладёт записи в rss.channel.item, Atom — в feed.entry.
  const channel = doc?.rss?.channel ?? doc?.["rdf:RDF"] ?? doc?.feed;
  if (!channel) throw new Error("не похоже на RSS или Atom");
  const entries: unknown[] = [channel.item, channel.entry]
    .flatMap((node) => (Array.isArray(node) ? node : node ? [node] : []));
  if (entries.length === 0) return [];

  return entries.flatMap((entry) => {
    const node = entry as Record<string, unknown>;
    const title = stripHtml(firstString(node.title));

    // Atom прячет ссылку в атрибуте link/@href, RSS — в тексте <link>.
    let url = firstString(node.link);
    if (!url || url.startsWith("{")) {
      const links = Array.isArray(node.link) ? node.link : [node.link];
      const alternate = links.find((l: any) => l?.["@rel"] !== "self" && l?.["@href"]);
      url = firstString(alternate) || firstString(node.id) || firstString(node.guid);
    }
    if (!title || !url?.startsWith("http")) return [];

    const excerpt = stripHtml(
      firstString(node.description) ||
        firstString(node.summary) ||
        firstString(node["content:encoded"]) ||
        firstString(node.content),
    ).slice(0, 1200);

    return [{
      url,
      title,
      excerpt,
      points: null,
      comments: null,
      published_at: parseDate(node.pubDate ?? node.published ?? node.updated ?? node["dc:date"]),
    }];
  });
}

// ---------------------------------------------------------------------------
// Hacker News — свой фетчер только ради очков и числа комментариев,
// которых нет в RSS-выдаче.
// ---------------------------------------------------------------------------
type HnItem = {
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  time?: number;
  text?: string;
  type?: string;
};

export async function fetchHackerNews(source: Source): Promise<RawItem[]> {
  const listing = String(source.config?.listing ?? "topstories");
  const count = Number(source.config?.count ?? 90);
  const ids = await getJson<number[]>(`https://hacker-news.firebaseio.com/v0/${listing}.json`);

  const stories = await pooled(ids.slice(0, count), 12, async (id) => {
    try {
      return await getJson<HnItem>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, 10_000);
    } catch {
      return null;
    }
  });

  return stories.flatMap((story) => {
    if (!story?.title || story.type !== "story") return [];
    return [{
      url: story.url ?? `https://news.ycombinator.com/item?id=${(story as any).id}`,
      title: story.title,
      excerpt: story.text ? stripHtml(story.text).slice(0, 1200) : "",
      points: story.score ?? null,
      comments: story.descendants ?? null,
      published_at: story.time ? new Date(story.time * 1000) : null,
    }];
  });
}

// ---------------------------------------------------------------------------
// Reddit. Без OAuth это не работает: лимит для анонимных запросов считается
// по адресу и по квоте, а не по темпу — проверено, восемь секунд паузы
// не спасают, второй сабреддит уже получает 429. С client_credentials
// лимит 100 запросов в минуту, и в ответе есть очки и число комментариев,
// которых в RSS-выдаче нет вообще.
// ---------------------------------------------------------------------------
let redditToken: { value: string; expiresAt: number } | null = null;

async function redditAccessToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (redditToken && Date.now() < redditToken.expiresAt) return redditToken.value;

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Reddit OAuth HTTP ${res.status}`);

  const token = (await res.json()) as { access_token: string; expires_in: number };
  redditToken = {
    value: token.access_token,
    expiresAt: Date.now() + (token.expires_in - 60) * 1000,
  };
  return redditToken.value;
}

type RedditChild = {
  data: {
    title: string;
    url?: string;
    permalink: string;
    score: number;
    num_comments: number;
    created_utc: number;
    selftext?: string;
    stickied?: boolean;
    over_18?: boolean;
  };
};

export async function fetchReddit(source: Source): Promise<RawItem[]> {
  const token = await redditAccessToken();
  // url у reddit-источника — имя сабреддита, а не адрес.
  const subreddit = source.url.replace(/^\/?r\//, "").replace(/\/$/, "");
  const listing = String(source.config?.listing ?? "hot");
  const limit = Number(source.config?.limit ?? 50);

  if (!token) {
    throw new Error("нужны REDDIT_CLIENT_ID и REDDIT_CLIENT_SECRET: без них Reddit отдаёт 429");
  }

  const res = await fetch(
    `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/${listing}?limit=${limit}&raw_json=1`,
    {
      headers: { authorization: `bearer ${token}`, "user-agent": UA },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const payload = (await res.json()) as { data?: { children?: RedditChild[] } };
  return (payload.data?.children ?? []).flatMap(({ data }) => {
    if (!data?.title || data.stickied || data.over_18) return [];
    return [{
      url: data.url?.startsWith("http") ? data.url : `https://www.reddit.com${data.permalink}`,
      title: data.title,
      excerpt: data.selftext ? stripHtml(data.selftext).slice(0, 1200) : "",
      points: data.score ?? null,
      comments: data.num_comments ?? null,
      published_at: data.created_utc ? new Date(data.created_utc * 1000) : null,
    }];
  });
}

// ---------------------------------------------------------------------------
// X (Twitter). Официальный API берёт $5 за тысячу прочитанных постов,
// перепродавцы — около $0.15, то есть на два порядка дешевле при том же
// содержимом. Провайдер спрятан за одной функцией: сменить его — это
// переписать запрос и разбор ответа, а не трогать пайплайн.
//
// url источника здесь — поисковый запрос X, а не адрес:
//   "from:karpathy OR from:sama"   ·   "uranium enrichment min_faves:100"
// ---------------------------------------------------------------------------
const X_ENDPOINT = "https://api.twitterapi.io/twitter/tweet/advanced_search";
/** Страница выдачи — 20 постов. Потолок держит счёт предсказуемым. */
const X_MAX_PAGES = 2;

type XTweet = {
  id: string;
  url: string;
  text: string;
  createdAt: string;
  likeCount?: number;
  retweetCount?: number;
  viewCount?: number;
  author?: { userName?: string; name?: string };
};

export async function fetchX(source: Source): Promise<RawItem[]> {
  const apiKey = process.env.X_API_KEY;
  if (!apiKey) throw new Error("нужен X_API_KEY (twitterapi.io)");

  const maxAgeDays = Number(source.config?.max_age_days ?? 3);
  const maxPages = Number(source.config?.max_pages ?? X_MAX_PAGES);
  const queryType = String(source.config?.query_type ?? "Latest");

  // since_time ставится в сам запрос: платить за старые посты, которые
  // всё равно отсеет фильтр свежести, незачем.
  const since = Math.floor((Date.now() - maxAgeDays * 86_400_000) / 1000);
  const query = `${source.url} since_time:${since}`;

  const items: RawItem[] = [];
  let cursor = "";

  for (let page = 0; page < maxPages; page++) {
    const url = `${X_ENDPOINT}?query=${encodeURIComponent(query)}&queryType=${queryType}&cursor=${encodeURIComponent(cursor)}`;
    const res = await fetch(url, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const payload = (await res.json()) as {
      tweets?: XTweet[];
      has_next_page?: boolean;
      next_cursor?: string;
    };

    for (const tweet of payload.tweets ?? []) {
      if (!tweet?.text) continue;
      const handle = tweet.author?.userName ? `@${tweet.author.userName}` : "";
      const published = new Date(tweet.createdAt);
      // Текст приходит с неразвёрнутыми HTML-сущностями (&amp;, &gt;).
      // В заголовке дайджеста они видны читателю как есть.
      const text = stripHtml(tweet.text);
      items.push({
        // Первая строка поста работает заголовком: у твита его нет,
        // а Jev и дайджест ждут заголовок отдельно от текста.
        title: `${handle ? `${handle}: ` : ""}${text.slice(0, 200)}`,
        url: tweet.url || `https://x.com/i/status/${tweet.id}`,
        excerpt: text.slice(0, 1200),
        points: tweet.likeCount ?? null,
        comments: tweet.retweetCount ?? null,
        published_at: Number.isNaN(published.getTime()) ? null : published,
      });
    }

    if (!payload.has_next_page || !payload.next_cursor) break;
    cursor = payload.next_cursor;
  }

  return items;
}

const FETCHERS: Record<Source["kind"], (source: Source) => Promise<RawItem[]>> = {
  rss: fetchRss,
  reddit: fetchReddit,
  hackernews: fetchHackerNews,
  x: fetchX,
};

export async function fetchSource(source: Source): Promise<RawItem[]> {
  return FETCHERS[source.kind](source);
}

/**
 * Пауза между запросами к одному и тому же хосту, по видам источников.
 * Значения измерены, а не выбраны: twitterapi.io отдаёт 429 при паузе
 * в полторы секунды и отвечает 200 при восьми.
 */
const HOST_DELAY_MS: Record<string, number> = { x: 8000 };
const DEFAULT_HOST_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hostOf = (source: Source): string => {
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return source.kind;
  }
};

/**
 * Часть фидов отдаёт весь архив разом: у OpenAI это больше тысячи записей,
 * у HuggingFace — под девятьсот. Без отсечки первый прогон утащит в скоринг
 * многолетнюю историю, и она будет конкурировать за место в дайджесте
 * с сегодняшними новостями.
 */
const MAX_AGE_DAYS = 7;
const MAX_ITEMS_PER_SOURCE = 60;

function freshest(items: RawItem[], source: Source): RawItem[] {
  const maxAge = Number(source.config?.max_age_days ?? MAX_AGE_DAYS);
  const cap = Number(source.config?.max_items ?? MAX_ITEMS_PER_SOURCE);
  const cutoff = Date.now() - maxAge * 86_400_000;

  return items
    // Без даты материал оставляем: её не отдают многие фиды, и молча
    // выбрасывать такой источник целиком хуже, чем пропустить старое.
    .filter((item) => !item.published_at || item.published_at.getTime() >= cutoff)
    .sort((a, b) => (b.published_at?.getTime() ?? 0) - (a.published_at?.getTime() ?? 0))
    .slice(0, cap);
}

export type SourceResult =
  | { source: Source; ok: true; items: RawItem[] }
  | { source: Source; ok: false; error: string };

/**
 * Источники разных хостов опрашиваются параллельно, одного хоста — по очереди
 * с паузой. Десяток сабреддитов, запрошенных разом, получает 429 на все:
  * ограничение стоит на стороне Reddit и считается по адресу, а не по фиду.
 */
export async function fetchAllSources(
  sources: Source[],
  onResult?: (result: SourceResult) => void,
): Promise<SourceResult[]> {
  const byHost = new Map<string, Source[]>();
  for (const source of sources) {
    const host = hostOf(source);
    byHost.set(host, [...(byHost.get(host) ?? []), source]);
  }

  const all = await Promise.all(
    [...byHost.values()].map(async (group) => {
      const results: SourceResult[] = [];
      for (const [index, source] of group.entries()) {
        if (index > 0) await sleep(HOST_DELAY_MS[source.kind] ?? DEFAULT_HOST_DELAY_MS);
        let result: SourceResult;
        try {
          result = { source, ok: true, items: freshest(await fetchSource(source), source) };
        } catch (error) {
          result = { source, ok: false, error: (error as Error).message.slice(0, 500) };
        }
        results.push(result);
        onResult?.(result);
      }
      return results;
    }),
  );
  return all.flat();
}
