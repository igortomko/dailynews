/**
 * Приём просто ссылки: вставили адрес — определился тип и настоящий адрес фида.
 *
 * Три слоя, по порядку от бесплатного к дорогому:
 *   1. правило по хосту — без сети, мгновенно, предсказуемо;
 *   2. <link rel="alternate" type="application/rss+xml"> со самой страницы;
 *   3. перебор частых путей (/feed, /rss, /index.xml, …).
 *
 * Кандидат сохраняется только после живой пробы: без неё каталог источников —
 * это список адресов, который через неделю молча отдаёт пустую вкладку.
 * Окупается приём на YouTube и GitHub: фид у них есть, но по адресу, который
 * человек не угадает.
 *
 *   npx tsx pipeline/detect.ts https://simonwillison.net
 */
import type { Sql } from "postgres";
import { fetchFeed, fetchSource, fetchText, freshest } from "./fetch";
import type { RawItem, Source } from "../src/lib/types";

export type Candidate = {
  kind: Source["kind"];
  /** Смысл зависит от kind: адрес фида, имя сабреддита, listing, запрос X. */
  url: string;
  label?: string;
  config?: Record<string, unknown>;
};

export type Detected = {
  kind: Source["kind"];
  url: string;
  label: string;
  /** Сколько записей в фиде всего и сколько из них в окне свежести. */
  count: number;
  fresh: number;
  sample: string;
};

export type Detection = { ok: true; found: Detected } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Слой 1: правила по хосту
// ---------------------------------------------------------------------------

/**
 * Совпадение по домену, а не по подстроке: `host.includes("reddit.com")`
 * принял бы `fakereddit.com.evil.net` за Reddit.
 */
const atHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Первый сегмент пути у X — не всегда имя: /search, /home, /i/... */
const X_NOT_A_HANDLE = new Set(["search", "home", "i", "explore", "notifications", "messages"]);

/**
 * Правило по хосту. `null` — правила нет, дальше идут слои с запросами.
 * Бросает, когда хост знаком, а ссылка не та: «нужна ссылка на сабреддит»
 * полезнее, чем молчаливый перебор /feed по reddit.com.
 */
export function byHost(input: string): Candidate[] | null {
  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (atHost(host, "t.me") || atHost(host, "telegram.me")) {
    // t.me/s/<канал> — тот же канал, только сразу в режиме веб-просмотра.
    const name = parts[0] === "s" ? parts[1] : parts[0];
    if (!name || name.startsWith("+") || name === "joinchat") {
      throw new Error("Это ссылка-приглашение в закрытый канал: веб-просмотр таких не отдаёт");
    }
    return [{ kind: "telegram", url: name, label: `@${name}` }];
  }

  if (atHost(host, "reddit.com")) {
    const name = parts[0] === "r" ? parts[1] : null;
    if (!name) throw new Error("Нужна ссылка на сабреддит: reddit.com/r/LocalLLaMA");
    return [{ kind: "reddit", url: name, label: `r/${name}` }];
  }

  if (atHost(host, "news.ycombinator.com")) {
    const listingByPath: Record<string, string> = { newest: "newstories", best: "beststories" };
    const listing = listingByPath[parts[0]] ?? "topstories";
    return [{ kind: "hackernews", url: listing, label: "Hacker News" }];
  }

  if (atHost(host, "x.com") || atHost(host, "twitter.com")) {
    const query = url.searchParams.get("q");
    if (query) return [{ kind: "x", url: query, label: `X · ${query.slice(0, 40)}` }];
    const handle = parts[0];
    if (!handle || X_NOT_A_HANDLE.has(handle.toLowerCase())) {
      throw new Error("Нужна ссылка на профиль (x.com/karpathy) или на поиск");
    }
    return [{ kind: "x", url: `from:${handle}`, label: `X · @${handle}` }];
  }

  if (atHost(host, "youtube.com")) {
    const playlist = url.searchParams.get("list");
    if (parts[0] === "channel" && parts[1]) {
      return [{ kind: "rss", url: `https://www.youtube.com/feeds/videos.xml?channel_id=${parts[1]}` }];
    }
    if (playlist) {
      return [{ kind: "rss", url: `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlist}` }];
    }
    // У ссылки на @имя нет channel_id — он лежит только в HTML страницы,
    // то есть это работа второго слоя, а не правила.
    return null;
  }

  if (atHost(host, "github.com")) {
    const [owner, repo] = parts;
    if (!owner || !repo) throw new Error("Нужна ссылка на репозиторий: github.com/owner/repo");
    const base = `https://github.com/${owner}/${repo}`;
    // Релизов нет у многих репозиториев: фид при этом валиден и пуст.
    // Без второго кандидата приём отказывал бы на живом репозитории.
    return [
      { kind: "rss", url: `${base}/releases.atom`, label: `${owner}/${repo} · релизы` },
      { kind: "rss", url: `${base}/commits.atom`, label: `${owner}/${repo} · коммиты` },
    ];
  }

  if (atHost(host, "substack.com")) {
    return [{ kind: "rss", url: `${url.origin}/feed` }];
  }

  if (atHost(host, "arxiv.org")) {
    const category = parts[0] === "list" ? parts[1] : null;
    if (category) return [{ kind: "rss", url: `https://rss.arxiv.org/rss/${category}` }];
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Слой 2 и 3: спросить страницу, потом перебрать частые пути
// ---------------------------------------------------------------------------

/** Адрес уже похож на фид — тогда его и пробуем первым, без лишних запросов. */
export function looksLikeFeed(input: string): boolean {
  const path = new URL(input).pathname.toLowerCase();
  return /\.(xml|atom|rss)$/.test(path) || /(^|\/)(feed|rss|atom)\/?$/.test(path);
}

/**
 * Ссылки на фид из HTML. Это стандарт, и его отдают почти все движки блогов —
 * поэтому перебор путей идёт только когда здесь ничего нет.
 */
export function feedLinks(html: string, base: string): string[] {
  const found: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel\s*=\s*["']?[^"'>]*\balternate\b/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    // Кавычки в атрибутах не обязательны по стандарту, и часть шаблонов
    // их не ставит: без третьей ветки такой <link> просто не виден.
    const match = tag.match(/href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/i);
    const href = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!href) continue;
    try {
      // В HTML амперсанд пишется сущностью, и без разворота адрес
      // ?channel_id=x&amp;foo уходит в запрос как есть.
      found.push(new URL(href.replace(/&amp;/gi, "&"), base).toString());
    } catch {
      // Мусорный href — не повод бросать всю страницу.
    }
  }
  return [...new Set(found)];
}

const FEED_PATHS = ["/feed", "/rss", "/index.xml", "/atom.xml", "/feed.xml", "/blog/feed"];

/** Частые адреса фидов: от корня сайта и от самого пути, если он не корень. */
export function feedGuesses(input: string): string[] {
  const url = new URL(input);
  const dir = url.pathname.replace(/\/+$/, "");
  const bases = dir ? [`${url.origin}${dir}`, url.origin] : [url.origin];
  return [...new Set(bases.flatMap((base) => FEED_PATHS.map((path) => `${base}${path}`)))];
}

// ---------------------------------------------------------------------------
// Проба
// ---------------------------------------------------------------------------

/** Потолок на число проб: перебор путей не должен превращаться в обход сайта. */
const MAX_PROBES = 10;

const asSource = (candidate: Candidate): Source => ({
  id: 0,
  kind: candidate.kind,
  label: candidate.label ?? candidate.url,
  url: candidate.url,
  // Проба не должна стоить как прогон: одна страница X, десяток историй HN.
  // max_age_days поднят нарочно: fetchX иначе спрашивает посты за три дня,
  // и живой аккаунт, молчавший неделю, выглядит как неработающий источник.
  config: { ...candidate.config, count: 10, limit: 10, max_pages: 1, max_age_days: 30 },
  active: true,
  last_ok_at: null,
  last_count: null,
  last_error: null,
});

function detected(candidate: Candidate, title: string, items: RawItem[]): Detected {
  return {
    kind: candidate.kind,
    url: candidate.url,
    label: (candidate.label || title || "").trim().slice(0, 200) || candidate.url,
    count: items.length,
    fresh: freshest(items, asSource(candidate)).length,
    sample: items[0]?.title.slice(0, 200) ?? "",
  };
}

/**
 * Живая проба одного кандидата. Считается запись в фиде, а не свежая запись:
 * у медленного блога последний пост может быть старше окна свежести, и фид
 * при этом рабочий. Число свежих возвращается рядом — пусть человек видит.
 */
export async function probeSource(candidate: Candidate): Promise<Detection> {
  try {
    if (candidate.kind === "rss") {
      const feed = await fetchFeed(candidate.url);
      if (feed.items.length === 0) return { ok: false, error: "фид отвечает, но пуст" };
      return { ok: true, found: detected(candidate, feed.title, feed.items) };
    }
    const items = await fetchSource(asSource(candidate));
    if (items.length === 0) return { ok: false, error: "источник отвечает, но ничего не отдал" };
    return { ok: true, found: detected(candidate, "", items) };
  } catch (error) {
    return { ok: false, error: (error as Error).message.slice(0, 300) };
  }
}

/**
 * Полное определение по вставленной ссылке. Возвращает либо то, что нашлось
 * и проверено, либо честную причину — «фида нет» вслух лучше, чем тихое
 * сохранение пустого источника.
 */
export async function detectSource(input: string): Promise<Detection> {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: string;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: `Поддерживаются только http и https, а не ${parsed.protocol}` };
    }
    url = parsed.toString();
  } catch {
    return { ok: false, error: "Это не похоже на ссылку" };
  }

  let ruled: Candidate[] | null;
  try {
    ruled = byHost(url);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  // Хост знаком — верим правилу и не перебираем пути: /feed на github.com
  // это шум, а не запасной вариант.
  if (ruled) return probeAll(ruled, `Тип определился (${ruled[0].kind}), но проба не прошла`);

  // Адрес уже похож на фид — пробуем его сразу, страницу за ним не тянем.
  if (looksLikeFeed(url)) {
    const direct = await probeSource({ kind: "rss", url });
    if (direct.ok) return direct;
  }

  let page = "";
  let pageError = "";
  try {
    page = await fetchText(url);
  } catch (error) {
    // Страница может не отвечать, а фид рядом с ней — жить. Идём перебором.
    pageError = (error as Error).message.slice(0, 120);
  }

  const linked = page ? feedLinks(page, url) : [];
  const plan: Candidate[] = (linked.length > 0 ? linked : feedGuesses(url))
    .map((candidate) => ({ kind: "rss" as const, url: candidate }));

  let whenAllFail = "На странице нет ссылки на фид, и обычные адреса (/feed, /rss, /index.xml) тоже пусты";
  if (linked.length > 0) whenAllFail = "Страница указывает на фид, но он не отвечает";
  else if (pageError) whenAllFail = `Страница не отвечает (${pageError}), и обычные адреса фида тоже`;

  return probeAll(plan, whenAllFail);
}

/** Пробует кандидатов по порядку и отдаёт первого живого. */
async function probeAll(plan: Candidate[], whenAllFail: string): Promise<Detection> {
  let last = "";
  for (const candidate of plan.slice(0, MAX_PROBES)) {
    const result = await probeSource(candidate);
    if (result.ok) return result;
    last = `${candidate.url} — ${result.error}`;
  }
  return { ok: false, error: last ? `${whenAllFail}. Последняя попытка: ${last}` : whenAllFail };
}

/**
 * Сохранение принятого источника. Запрос живёт здесь, а не в actions.ts,
 * чтобы `npm run verify:db` проверял его настоящий текст: `config` — jsonb,
 * и строка вместо объекта там не видна ни на чтении, ни в интерфейсе.
 */
export async function saveSource(
  sql: Sql,
  source: Pick<Detected, "kind" | "url" | "label">,
  origin?: string,
): Promise<void> {
  // Исходную ссылку храним, только если она не совпала с адресом фида:
  // через полгода «я вставлял вот это» отвечает быстрее, чем расшифровка
  // адреса, которого человек никогда не видел.
  const config = origin && origin !== source.url ? { origin } : {};
  await sql`
    insert into dailynews.sources (kind, label, url, config)
    values (${source.kind}, ${source.label}, ${source.url}, ${sql.json(config)})
    on conflict (kind, url) do update
      set active = true,
          label = excluded.label,
          config = sources.config || excluded.config
  `;
}

if (process.argv[2]) {
  (async () => {
    for (const input of process.argv.slice(2)) {
      const result = await detectSource(input);
      console.log(
        result.ok
          ? `OK   ${result.found.kind.padEnd(10)} ${result.found.url}\n     ${result.found.label} · свежих ${result.found.fresh} из ${result.found.count} · ${result.found.sample}`
          : `FAIL ${input}\n     ${result.error}`,
      );
    }
  })();
}
