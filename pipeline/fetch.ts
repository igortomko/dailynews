import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { XMLParser } from "fast-xml-parser";
import type { RawItem, Source } from "../src/lib/types";
import { fetchLetters } from "./mail";

const UA = "dailynews/2.0 (+https://github.com/igortomko/dailynews)";
const MAX_BYTES = 5_000_000;

const INTERNAL = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  // 169.254.169.254 — метаданные облака, самая ценная цель из всех.
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["224.0.0.0", 4],
  // Служебные и зарезервированные: в чужой сети они бывают маршрутизируемы,
  // а фида за ними нет ни одного.
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["240.0.0.0", 4], ["255.255.255.255", 32],
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  INTERNAL.addSubnet(network, prefix, isIP(network) === 6 ? "ipv6" : "ipv4");
}

/**
 * Ведёт ли адрес внутрь сети. BlockList, а не свои префиксы: он сам приводит
 * v4 внутри v6 к общему виду, а проверка по префиксам ловила «::ffff:127.0.0.1»
 * и пропускала ровно тот же адрес шестнадцатеричной записью — «::ffff:7f00:1».
 */
export function isInternal(ip: string): boolean {
  const plain = ip.replace(/^\[|\]$/g, "");
  const type = isIP(plain);
  // Нераспознанное — не адрес: пропускать такое наружу незачем.
  if (type === 0) return true;
  return INTERNAL.check(plain, type === 6 ? "ipv6" : "ipv4");
}

async function assertPublic(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (addresses.length === 0) throw new Error("имя не разрешается в адрес");
  const internal = addresses.find(isInternal);
  if (internal) throw new Error(`адрес ведёт во внутреннюю сеть (${internal})`);
}

/** Сколько перенаправлений готовы пройти, проверяя каждое. */
const MAX_REDIRECTS = 5;

/**
 * Запрос по внешнему адресу.
 *
 * Адрес источника вводит человек, а машина общая: рядом в той же сети живут
 * чужие контейнеры. Без проверки адреса форма добавления — готовый сканер
 * внутренней сети, где «HTTP 401» на внутреннем адресе уже ответ. Поэтому имя
 * разрешается в адрес до запроса, а каждое перенаправление проверяется заново:
 * публичный хост умеет увести на 127.0.0.1, и на этом смысл проверки кончился
 * бы. От подмены DNS между проверкой и соединением это не защищает —
 * закрепление адреса потребовало бы своего диспетчера, и это отдельное
 * решение, а не заодно.
 *
 * Потолок на размер стоит у вызывающего: страницу og-картинки читают
 * по кускам и бросают на середине.
 */
export async function requestPublic(
  url: string,
  options: { timeoutMs?: number; accept?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const deadline = Date.now() + (options.timeoutMs ?? 20_000);
  let current = new URL(url);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new Error(`протокол не поддерживается: ${current.protocol}`);
    }
    await assertPublic(current);

    const res = await fetch(current, {
      headers: { "user-agent": UA, accept: options.accept ?? "*/*", ...options.headers },
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      // Не "follow": перенаправление — это новый адрес, и его нужно
      // проверить тем же порядком, что и первый.
      redirect: "manual",
    });
    if (res.status < 300 || res.status >= 400) return res;

    // Тело перенаправления никто не читает, а непрочитанное держит сокет:
    // пять переходов подряд — и соединения кончаются на ровном месте.
    const location = res.headers.get("location");
    await res.body?.cancel().catch(() => {});
    if (!location) throw new Error(`HTTP ${res.status} без адреса перехода`);
    current = new URL(location, current);
  }
  throw new Error(`больше ${MAX_REDIRECTS} перенаправлений`);
}

/**
 * Текст по внешнему адресу: свой таймаут на всю цепочку и потолок на размер —
 * иначе один зависший или бесконечный фид держит весь прогон.
 */
export async function fetchText(
  url: string,
  timeoutMs = 20_000,
  options: { accept?: string; headers?: Record<string, string> } = {},
): Promise<string> {
  const res = await requestPublic(url, { timeoutMs, ...options });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new Error(`ответ ${length} байт, больше потолка`);

  // Читаем по кускам и считаем байты: res.text() сначала соберёт в памяти
  // весь ответ и только потом даст его измерить, а длина строки — это
  // символы, а не байты, и на кириллице потолок расходится вдвое.
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("ответ больше потолка");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function getJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
  return JSON.parse(await fetchText(url, timeoutMs)) as T;
}

/** Запускает задачи пачками по `limit`, чтобы не раскладывать источник на лопатки. */
export async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

export function stripHtml(html: string): string {
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

/** Фид целиком: записи и собственное название — его берёт форма добавления. */
export type FeedDoc = { title: string; items: RawItem[] };

/**
 * Узел разобранного XML. Описана только вложенность: листья приезжают
 * строками, числами и массивами — их разбирает firstString, которому
 * всё равно, что пришло.
 */
type XmlNode = { [key: string]: XmlNode | undefined };

/**
 * Разбор отделён от запроса: форма добавления источника уже скачала страницу,
 * чтобы понять, фид это или HTML, и качать то же тело второй раз незачем.
 */
export function parseFeed(xml: string): FeedDoc {
  const doc = parser.parse(xml) as XmlNode;

  // RSS 2.0 кладёт записи в rss.channel.item, Atom — в feed.entry.
  const channel = doc?.rss?.channel ?? doc?.["rdf:RDF"] ?? doc?.feed;
  if (!channel) throw new Error("не похоже на RSS или Atom");
  const title = stripHtml(firstString(channel.title ?? channel?.channel?.title)).slice(0, 200);
  const entries: unknown[] = [channel.item, channel.entry]
    .flatMap((node) => (Array.isArray(node) ? node : node ? [node] : []));
  if (entries.length === 0) return { title, items: [] };

  const items = entries.flatMap((entry) => {
    const node = entry as Record<string, unknown>;
    const title = stripHtml(firstString(node.title));

    // Atom прячет ссылку в атрибуте link/@href, RSS — в тексте <link>.
    let url = firstString(node.link);
    if (!url || url.startsWith("{")) {
      const links = (Array.isArray(node.link) ? node.link : [node.link]) as (
        Record<string, unknown> | undefined
      )[];
      const alternate = links.find((l) => l?.["@rel"] !== "self" && l?.["@href"]);
      url = firstString(alternate) || firstString(node.id) || firstString(node.guid);
    }
    if (!title || !url?.startsWith("http")) return [];

    // Полный текст фида берётся ДО обрезки. Раньше он проходил через
    // stripHtml и slice(1200) и исчезал: для Substack и WordPress это
    // означало лезть за статьёй на сайт, хотя она уже приехала целиком,
    // чистая и даром. Потолок — на случай фида, отдающего книгу в одной
    // записи; хранится это для всего потока.
    const full = firstString(node["content:encoded"]) || firstString(node.content);
    const body = full && full.length > 600 ? full.slice(0, 400_000) : undefined;

    // media:description — описание ролика у YouTube: своего <description>
    // в его Atom нет вовсе, и без этой ветки канал приезжал одними
    // заголовками. Оценка и дайджест писались по заголовку, а выглядело
    // это как обычный материал.
    const media = node["media:group"] as Record<string, unknown> | undefined;
    const excerpt = stripHtml(
      firstString(node.description) ||
        firstString(node.summary) ||
        firstString(media?.["media:description"]) ||
        full,
    ).slice(0, 1200);

    return [{
      url,
      title,
      excerpt,
      body,
      points: null,
      comments: null,
      published_at: parseDate(node.pubDate ?? node.published ?? node.updated ?? node["dc:date"]),
    }];
  });

  return { title, items };
}

export async function fetchRssFeed(source: Source): Promise<FeedDoc> {
  return parseFeed(await fetchText(source.url));
}

export async function fetchRss(source: Source): Promise<RawItem[]> {
  return (await fetchRssFeed(source)).items;
}

// ---------------------------------------------------------------------------
// Hacker News — свой фетчер только ради очков и числа комментариев,
// которых нет в RSS-выдаче.
// ---------------------------------------------------------------------------
type HnItem = {
  id?: number;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  time?: number;
  text?: string;
  type?: string;
};

export async function fetchHackerNews(source: Source): Promise<RawItem[]> {
  // Листинг берётся из url: так написано в схеме («'topstories' или поисковый
  // запрос X»), а читался он только из config, которого в каталоге нет ни у кого.
  // Второй источник HN с url = 'newstories' молча отдавал бы topstories.
  const listing = String(source.url || source.config?.listing || "topstories");
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
      url: story.url ?? `https://news.ycombinator.com/item?id=${story.id}`,
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
/**
 * Окно свежести. Шире, чем у фидов, потому что автор пишет реже издания:
 * замер на живом аккаунте — 14 активных дней из 30, своих постов 12 из 47
 * (остальное реплаи). Трое суток отдавали ноль у обоих заведённых авторов.
 */
const X_MAX_AGE_DAYS = 7;

type XTweet = {
  id: string;
  url: string;
  text: string;
  createdAt: string;
  likeCount?: number;
  retweetCount?: number;
  viewCount?: number;
  isReply?: boolean;
  inReplyToUsername?: string;
  retweeted_tweet?: unknown;
  quoted_tweet?: unknown;
  entities?: { urls?: { expanded_url?: string }[] };
  author?: { userName?: string; name?: string };
};

/**
 * Ссылка на материал из самого твита.
 *
 * Твит с внешней ссылкой — это анонс статьи, и адресом материала должна быть
 * статья, а не твит: по адресу твита `enrich` не получит ничего (X без
 * браузера не отдаёт содержимого), и оценка встанет по 280 знакам анонса.
 * Заодно бесплатно чинится дедуп: `url_canon` статьи сойдётся с тем же
 * адресом из RSS первым слоем, без вопроса к Jev по заголовкам, которые
 * у твита и у издания не сходятся никогда.
 *
 * Свои адреса X не считаются: цитата другого твита — не материал.
 * Сокращатели тоже, и это замер, а не осторожность: в живой выдаче
 * `dlvr.it/TVb9jh` ведёт на datacenterdynamics.com, а `shorturl.at/hjOyJ`
 * не отвечает вовсе. Взять адрес сокращателя значит записать в `url_canon`
 * то, что не сойдётся с той же статьёй из RSS, — то есть отдать ровно ту
 * выгоду, ради которой ссылка из твита и берётся. Разворачивать их в сборе
 * нельзя: это запрос на каждую ссылку в каждом твите, оплаченный временем
 * прогона. Такой твит остаётся твитом.
 *
 * Список, а не правило: у сокращателя нет признака. `dlvr.it` и `reut.rs`
 * снаружи одинаковы, и всякий короткий хост в сокращатели записать —
 * значит выбросить половину изданий.
 */
const SHORTENERS = new Set([
  "t.co", "bit.ly", "dlvr.it", "shorturl.at", "buff.ly", "ow.ly", "lnkd.in",
  "trib.al", "ift.tt", "tinyurl.com", "is.gd", "cutt.ly", "rb.gy", "hubs.ly",
  "spr.ly", "zurl.co", "shr.lc",
]);

export function tweetLink(tweet: XTweet): string | null {
  for (const entry of tweet.entities?.urls ?? []) {
    const raw = entry.expanded_url;
    if (!raw?.startsWith("http")) continue;
    let host: string;
    try {
      host = new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    if (host === "x.com" || host === "twitter.com") continue;
    if (SHORTENERS.has(host)) continue;
    return raw;
  }
  return null;
}

/**
 * Опрашивать ли источник в этом прогоне.
 *
 * Сбор идёт раз в час, а X — раз в сутки. Его запрос берёт окно в неделю
 * (`X_MAX_AGE_DAYS`), и платим мы за каждый вернувшийся твит: раз в час
 * одни и те же посты оплачивались бы двадцать четыре раза, а новыми
 * в базу ложились бы единицы. Сузить окно до «с прошлого опроса» нельзя —
 * пустой час ставил бы `silent_since` живому автору, ровно то, от чего
 * неделя и спасает. Двадцать часов, а не двадцать четыре: прогон
 * по расписанию опаздывает по-разному, и сутки ровно пропускали бы
 * опрос через раз.
 */
export function pollNow(source: Pick<Source, "kind" | "last_ok_at">, now = Date.now()): boolean {
  if (source.kind !== "x" || !source.last_ok_at) return true;
  // Драйвер отдаёт timestamptz объектом Date, а тип обещает строку: `new Date` понимает оба.
  return now - new Date(source.last_ok_at).getTime() >= 20 * 3_600_000;
}

export async function fetchX(source: Source): Promise<RawItem[]> {
  const apiKey = process.env.X_API_KEY;
  if (!apiKey) throw new Error("нужен X_API_KEY (twitterapi.io)");

  // Неделя, а не трое суток, и это замер, а не осторожность: автор в X
  // активен примерно половину дней месяца (14 из 30 у замеренного аккаунта),
  // и пауза в четыре дня у него обычное дело. В трёхдневное окно живой автор
  // попадает через раз — оба заведённых источника отдавали ноль при том, что
  // писали пять дней назад, — а первый пустой прогон ставит `silent_since`
  // и зовёт убрать источник, который работает. Счёт от окна не зависит:
  // `since_time` уходит в сам запрос, и платим мы за то, что вернулось,
  // а у автора это два-три поста, а не архив.
  const maxAgeDays = Number(source.config?.max_age_days ?? X_MAX_AGE_DAYS);
  const maxPages = Number(source.config?.max_pages ?? X_MAX_PAGES);
  const queryType = String(source.config?.query_type ?? "Latest");
  // Ответы нужны только карточке автора: ответ на чужой твит — это его
  // мнение о чужом, ровно то, чему учится черновик. В сборе новостей они
  // по-прежнему отсекаются — там переписка оплачивалась бы как материал.
  const keepReplies = source.config?.replies === true;

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
      // Реплай — это разговор, ретвит — чужой материал второй раз. Операторы
      // `-is:reply -is:retweet` убирают их до оплаты, но запрос пишет
      // читатель, и рассчитывать на них нельзя: без этой отсечки лента
      // выбранных авторов приходит их перепиской.
      if ((tweet.isReply && !keepReplies) || tweet.retweeted_tweet) continue;
      const handle = tweet.author?.userName ? `@${tweet.author.userName}` : "";
      const link = tweetLink(tweet);
      const published = new Date(tweet.createdAt);
      // Текст приходит с неразвёрнутыми HTML-сущностями (&amp;, &gt;).
      // В заголовке дайджеста они видны читателю как есть.
      const own = stripHtml(tweet.text);
      // Ответ без адресата читается как пост, а форма у него другая:
      // пометка говорит модели, что это реплика в чужой ветке.
      const text = tweet.isReply
        ? `[ответ${tweet.inReplyToUsername ? ` @${tweet.inReplyToUsername}` : ""}] ${own}`
        : own;
      items.push({
        // Первая строка поста работает заголовком: у твита его нет,
        // а Jev и дайджест ждут заголовок отдельно от текста.
        title: `${handle ? `${handle}: ` : ""}${text.slice(0, 200)}`,
        url: link ?? tweet.url ?? `https://x.com/i/status/${tweet.id}`,
        excerpt: text.slice(0, 1200),
        points: tweet.likeCount ?? null,
        comments: tweet.retweetCount ?? null,
        views: tweet.viewCount ?? null,
        shares: Boolean(link || tweet.quoted_tweet || tweet.isReply),
        published_at: Number.isNaN(published.getTime()) ? null : published,
      });
    }

    if (!payload.has_next_page || !payload.next_cursor) break;
    cursor = payload.next_cursor;
  }

  return items;
}

// ---------------------------------------------------------------------------
// Telegram. Только публичные каналы и только веб-просмотр t.me/s/<канал>:
// Bot API читает лишь те каналы, где бот админ, а MTProto с личной сессией
// на общей машине — отдельное решение владельца.
//
// Это разбор чужой разметки, и он сломается при её смене — молча, как всегда.
// Поэтому: тест на сохранённом куске и попадание под проверку тишины.
// ---------------------------------------------------------------------------

/**
 * Разбор страницы публичного канала.
 *
 * Посты режутся по data-post, а не разбираются тремя независимыми списками
 * (посты, тексты, времена) с последующим сопоставлением по номеру: пост
 * без текста — их там хватает, одни картинки — сдвинул бы все даты на один,
 * и каждая новость получила бы чужое время. Выглядело бы это нормально.
 */
/**
 * «49.3K», «1.74M», «812» — Telegram печатает просмотры сокращённо.
 * Пусто и нераспознанное — null, а не ноль: ноль означает «никто не читал»,
 * и на нём карточка автора решила бы, что удачных постов у него нет вовсе.
 */
export function countOf(raw: string | undefined): number | null {
  if (!raw) return null;
  const digits = Number(raw.replace(/,/g, "").replace(/[KM]$/, ""));
  if (!Number.isFinite(digits)) return null;
  if (raw.endsWith("K")) return Math.round(digits * 1000);
  if (raw.endsWith("M")) return Math.round(digits * 1e6);
  return Math.round(digits);
}

/**
 * Делится ли пост канала чужим материалом: переслан из другого канала,
 * несёт превью ссылки или ссылку наружу в тексте. Ссылка на другой канал
 * в t.me — тоже чужое; на свой же канал — нет: это «как я писал раньше».
 */
export function sharesInTelegram(chunk: string, body: string, channel: string): boolean {
  if (/tgme_widget_message_forwarded_from/.test(chunk)) return true;
  if (/tgme_widget_message_link_preview/.test(chunk)) return true;
  const own = channel.replace(/^@/, "").toLowerCase();
  return [...body.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/gi)].some(([, href]) => {
    try {
      const url = new URL(href);
      if (!/(^|\.)(t\.me|telegram\.me)$/.test(url.hostname)) return true;
      const parts = url.pathname.split("/").filter(Boolean);
      const name = (parts[0] === "s" ? parts[1] : parts[0])?.toLowerCase() ?? "";
      return Boolean(name) && name !== own;
    } catch {
      return false;
    }
  });
}

export function parseTelegram(html: string, channel: string): FeedDoc {
  const title = stripHtml(
    html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? "",
  ) || channel;

  // Закрытый, несуществующий или выключивший веб-просмотр канал отвечает 200
  // и уводит с /s/ на страницу контакта. Без этой проверки такой источник
  // сохранился бы пустым и через неделю выглядел бы просто заброшенным.
  const marks = [...html.matchAll(/data-post="([^"]+)"/g)];
  if (marks.length === 0) {
    throw new Error(
      /Telegram: Contact @/.test(html)
        ? "это не публичный канал: t.me/s/ отдал страницу контакта"
        : "канал не отдал ни одного поста",
    );
  }

  const items: RawItem[] = [];
  for (const [index, mark] of marks.entries()) {
    const start = mark.index ?? 0;
    const end = index + 1 < marks.length ? (marks[index + 1].index ?? html.length) : html.length;
    const chunk = html.slice(start, end);

    const body = chunk.match(
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    )?.[1];
    // Пост без текста — одни картинки. Заголовка у него нет, и выдумывать
    // его неоткуда.
    if (!body) continue;

    // <br> до общей чистки тегов: без этого строки склеиваются в одну,
    // и заголовком становится весь пост целиком.
    const text = stripHtml(body.replace(/<br\s*\/?>/gi, "\n"));
    if (!text) continue;

    const when = chunk.match(/<time datetime="([^"]+)"/)?.[1];
    const published = when ? new Date(when) : null;
    items.push({
      url: `https://t.me/${mark[1]}`,
      // «49.3K» и «1.74M» — так их печатает сама страница. Нужны только
      // карточке автора: по ним видно, какие его посты заходят.
      views: countOf(chunk.match(/tgme_widget_message_views">([\d.,KM]+)</)?.[1]),
      shares: sharesInTelegram(chunk, body, channel),
      // У поста нет заголовка, как и у твита: первая строка работает
      // заголовком, потому что Jev и дайджест ждут его отдельно от текста.
      title: (text.split("\n").find((line) => line.trim()) ?? text).trim().slice(0, 200),
      excerpt: text.replace(/\s+/g, " ").slice(0, 1200),
      points: null,
      comments: null,
      published_at: published && !Number.isNaN(published.getTime()) ? published : null,
    });
  }
  return { title, items };
}

export async function fetchTelegramFeed(source: Source): Promise<FeedDoc> {
  // url источника здесь — имя канала, а не адрес (как у Reddit).
  const channel = source.url.replace(/^@/, "").replace(/^.*t\.me\/(s\/)?/, "").replace(/\/.*$/, "");
  return parseTelegram(await fetchText(`https://t.me/s/${encodeURIComponent(channel)}`), channel);
}

export async function fetchTelegram(source: Source): Promise<RawItem[]> {
  return (await fetchTelegramFeed(source)).items;
}

// ---------------------------------------------------------------------------
// Почта. Выделенный ящик опрашивается по IMAP в том же ночном прогоне.
// Входящего эндпоинта не заводится: на общей машине лишнего наружу быть
// не должно. url источника здесь — адрес отправителя, а не адрес фида.
// ---------------------------------------------------------------------------
const nameOf = (from: string) => (from.split("<")[0] ?? "").replace(/["']/g, "").trim();

export async function fetchEmailFeed(source: Source): Promise<FeedDoc> {
  const url = process.env.IMAP_URL;
  if (!url) throw new Error("выделенный ящик не настроен: нужен IMAP_URL");

  const letters = await fetchLetters(
    { url, folder: process.env.IMAP_FOLDER },
    source.url,
    Number(source.config?.max_age_days ?? 7),
    Number(source.config?.max_items ?? 30),
  );

  return {
    title: letters.map((letter) => nameOf(letter.from)).find(Boolean) ?? source.url,
    items: letters.map((letter) => ({
      // У письма нет веб-адреса, пока отправитель его не дал. mid: — это
      // настоящая схема RFC 2392 для идентификатора письма; выдуманный домен
      // выглядел бы правдоподобно и увёл бы читателя на чужой сайт.
      url: letter.link ?? `mid:${letter.messageId}`,
      // Дедуп идёт по Message-ID, а не по ссылке: «посмотреть в браузере»
      // у половины рассылок один и тот же на все выпуски, и вторая новость
      // от отправителя молча не доехала бы никогда.
      canon: `mid:${letter.messageId}`,
      title: letter.subject || letter.text.split("\n")[0].slice(0, 200),
      excerpt: letter.text.replace(/\s+/g, " ").slice(0, 1200),
      points: null,
      comments: null,
      published_at: letter.date,
    })),
  };
}

export async function fetchEmail(source: Source): Promise<RawItem[]> {
  return (await fetchEmailFeed(source)).items;
}

const FETCHERS: Record<Source["kind"], (source: Source) => Promise<RawItem[]>> = {
  rss: fetchRss,
  reddit: fetchReddit,
  hackernews: fetchHackerNews,
  x: fetchX,
  telegram: fetchTelegram,
  email: fetchEmail,
};

export async function fetchSource(source: Source): Promise<RawItem[]> {
  return FETCHERS[source.kind](source);
}

/** У каких источников есть собственное название — его берёт форма добавления. */
const TITLED: Partial<Record<Source["kind"], (source: Source) => Promise<FeedDoc>>> = {
  rss: fetchRssFeed,
  telegram: fetchTelegramFeed,
  email: fetchEmailFeed,
};

/**
 * Записи вместе с названием источника, если оно у него есть. Форме добавления
 * нужно и то, и другое, а у HN, Reddit и X названия нет вообще.
 */
export async function fetchDoc(source: Source): Promise<FeedDoc> {
  const titled = TITLED[source.kind];
  return titled ? titled(source) : { title: "", items: await fetchSource(source) };
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

export function freshest(items: RawItem[], source: Source): RawItem[] {
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

/**
 * Почему источник не ответил — словами, а не кодом драйвера.
 *
 * Node отдаёт наверх «fetch failed» на всё сразу: и на несуществующий домен,
 * и на просроченный сертификат, и на оборванное соединение, — а настоящую
 * причину прячет в error.cause. В списке источников это одинаковая строка,
 * по которой нельзя решить, чинить адрес, подождать или выбросить источник.
 */
export function explain(error: unknown): string {
  const err = (error ?? {}) as {
    name?: string;
    message?: string;
    code?: string;
    cause?: { code?: string; message?: string };
  };
  const message = String(err.message ?? error ?? "");
  const code = err.cause?.code ?? err.code ?? "";

  if (err.name === "TimeoutError" || /timed out|aborted/i.test(message)) {
    return "не ответил за отведённое время";
  }

  const byCode: Record<string, string> = {
    ENOTFOUND: "домен не существует",
    EAI_AGAIN: "домен не разрешается",
    ECONNREFUSED: "хост отказал в соединении",
    ECONNRESET: "соединение оборвано на полпути",
    EHOSTUNREACH: "хост недоступен",
    ETIMEDOUT: "не ответил за отведённое время",
    CERT_HAS_EXPIRED: "просроченный сертификат",
    ERR_TLS_CERT_ALTNAME_INVALID: "сертификат выдан другому домену",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "сертификат не проверяется",
    DEPTH_ZERO_SELF_SIGNED_CERT: "самоподписанный сертификат",
  };
  if (byCode[code]) return byCode[code];

  const status = Number(message.match(/^HTTP (\d{3})/)?.[1] ?? 0);
  // 402 приходит от перепродавца X, когда кончился баланс. «Источник ответил
  // 402» звучит как поломка источника, а чинить надо счёт.
  if (status === 402) return "нужна оплата (402) — у провайдера кончился баланс";
  if (status === 401 || status === 403) return `источник закрылся от робота (${status})`;
  if (status === 404 || status === 410) return `адрес больше не существует (${status})`;
  if (status === 429) return "источник просит реже (429)";
  if (status >= 500) return `сервер источника не в порядке (${status})`;
  if (status) return `источник ответил ${status}`;

  return message.slice(0, 300) || "не ответил без объяснений";
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
          result = { source, ok: false, error: explain(error).slice(0, 500) };
        }
        results.push(result);
        onResult?.(result);
      }
      return results;
    }),
  );
  return all.flat();
}
