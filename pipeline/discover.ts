/**
 * Разбор вставленной ссылки: что это за источник и где у него фид.
 *
 * Тип источника человек знать не обязан, а название уже лежит в самом фиде.
 * Поэтому на входе — просто ссылка, а всё остальное выясняется здесь,
 * тремя слоями от бесплатного к дорогому:
 *
 *   1. правила по хосту — ни одного запроса;
 *   2. разметка страницы: <link rel="alternate"> и четыре угаданных пути;
 *   3. проба тем же фетчером и той же отсечкой свежести, которыми ходит прогон.
 *
 * YouTube и GitHub — главная причина всей затеи: фид у них есть, но по адресу,
 * который человек не угадает (feeds/videos.xml?channel_id=…, releases.atom).
 *
 * Отказ обязан выглядеть отказом: источник, сохранённый без единой записи,
 * через неделю становится пустой вкладкой, и понять, что он мёртв с рождения,
 * уже нельзя. Поэтому сохраняется только то, что действительно ответило,
 * а «фида нет», «страница собирается в браузере» и «пейволл» называются вслух.
 */
import { explain, fetchDoc, fetchText, freshest, parseFeed, type FeedDoc } from "./fetch";
import type { Source } from "../src/lib/types";

/**
 * Кандидат в строку лога, без того, что нельзя писать в общий лог.
 *
 * У почтового источника `url` — это адрес читателя, а в адресе фида
 * запросто едет ключ (`?token=…`) или логин с паролем. Разбираться,
 * почему «у сайта нет ленты», надо по путям, которые мы пробовали, —
 * а не по тому, чей это ящик.
 */
function redacted(candidate: Candidate): string {
  if (candidate.kind === "email") return candidate.url.replace(/^[^@]+/, "***");
  try {
    const url = new URL(candidate.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return candidate.url;
  }
}

/**
 * Как нашли ленту на сайте. Одна строка на оба пути — объявленный
 * в разметке и угаданный по типовому адресу: читателю эта разница не видна
 * и не нужна, а две копии одного текста разъедутся на первой же правке.
 */
const VIA_SITE = "нашли на сайте";

export type Candidate = {
  kind: Source["kind"];
  /** Смысл зависит от kind: адрес фида, имя сабреддита, листинг HN, запрос X. */
  url: string;
  /** Чем объяснить читателю, откуда взялся этот адрес. */
  via: string;
};

/** Правила по хосту либо дают кандидатов, либо честно отказывают. */
export type Plan = { candidates: Candidate[]; probePage: boolean } | { refuse: string };

/** Четыре пути, по которым фид лежит чаще всего, если его не объявили в разметке. */
const GUESSES = ["/feed", "/rss", "/index.xml", "/atom.xml"];

/** Пути X, которые не являются именем пользователя. */
const X_RESERVED = new Set([
  "home", "explore", "search", "notifications", "messages", "i", "settings",
  "compose", "hashtag", "intent", "login", "about",
]);

/**
 * Ссылка ли это вообще. Запрос X («from:karpathy OR from:sama») ссылкой
 * не является и никогда ею не станет — это единственный источник, у которого
 * адреса нет в принципе, поэтому текст без точки читается как запрос.
 */
export function asUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes(".") ? url : null;
  } catch {
    return null;
  }
}

/**
 * Первый слой: что известно про хост заранее. Ни одного запроса.
 * Каждое правило проверяется в selftest на строке-примере — разметка
 * и адреса у сервисов меняются, и правило, которое перестало срабатывать,
 * выглядит ровно как «у этого сайта нет фида».
 */
export function planFor(input: string): Plan {
  // Раньше адреса: URL() принимает «a@b.com» как хост b.com с именем
  // пользователя a, и подписка молча превратилась бы в попытку найти фид
  // на сайте отправителя.
  const address = input.trim().toLowerCase();
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
    return {
      candidates: [{ kind: "email", url: address, via: "письма с этого адреса" }],
      probePage: false,
    };
  }

  const url = asUrl(input);
  if (!url) {
    const query = input.trim();
    if (!query) return { refuse: "Вставь ссылку" };

    // @имя — это канал Telegram. Собачка есть и у X, но платный из двух
    // только X: угадать в его пользу значит взять деньги за догадку.
    // Аккаунт X вставляют ссылкой x.com/имя или запросом from:имя.
    const handle = query.match(/^@([A-Za-z][A-Za-z0-9_]{3,31})$/);
    if (handle) {
      return {
        candidates: [{ kind: "telegram", url: handle[1], via: `публичный канал @${handle[1]}` }],
        probePage: false,
      };
    }

    // Запрос X — это пробелы или операторы вида from:, min_faves:.
    // Одинокое слово запросом не является, и отправлять его в платную
    // выдачу, чтобы получить оттуда пустоту, незачем.
    if (!/\s/.test(query) && !/(^|\s)[a-z_]+:/i.test(query)) {
      return {
        refuse: "Не похоже на ссылку. Канал Telegram — @имя, аккаунт X — x.com/имя",
      };
    }
    return { candidates: [{ kind: "x", url: query, via: "поисковый запрос X" }], probePage: false };
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  const only = (kind: Source["kind"], target: string, via: string): Plan => ({
    candidates: [{ kind, url: target, via }],
    probePage: false,
  });

  if (host === "reddit.com" || host === "old.reddit.com") {
    const name = segments[0] === "r" ? segments[1] : null;
    if (name) return only("reddit", name, `сабреддит r/${name}`);
  }

  if (host === "news.ycombinator.com") {
    const listing =
      segments[0] === "newest" ? "newstories" : segments[0] === "best" ? "beststories" : "topstories";
    return only("hackernews", listing, `Hacker News, ${listing}`);
  }

  if (host === "x.com" || host === "twitter.com") {
    // Список X — готовая лента выбранных авторов, и это самый дешёвый фильтр
    // шлака из всех: отобраны люди, а не реакции. Своей ветки в сборе он
    // не требует — `list:` такой же оператор advanced_search, как `from:`.
    if (segments[0] === "i" && segments[1] === "lists" && /^\d+$/.test(segments[2] ?? "")) {
      return only("x", `list:${segments[2]}`, `список X ${segments[2]}`);
    }
    const handle = segments[0];
    if (handle && !X_RESERVED.has(handle.toLowerCase()) && /^[A-Za-z0-9_]{1,15}$/.test(handle)) {
      return only("x", `from:${handle}`, `посты @${handle}`);
    }
    return { refuse: "Вставь ссылку на аккаунт целиком: x.com/имя" };
  }

  if (host === "youtube.com" || host === "m.youtube.com") {
    // Канал по id и плейлист собираются из адреса. Для @handle и /c/имя id
    // в адресе нет, но YouTube объявляет фид в <link rel="alternate">,
    // поэтому такие ссылки уходят во второй слой, а не в отдельный разбор.
    if (segments[0] === "channel" && segments[1]) {
      return only("rss", `https://www.youtube.com/feeds/videos.xml?channel_id=${segments[1]}`, "канал YouTube");
    }
    const list = url.searchParams.get("list");
    if (segments[0] === "playlist" && list) {
      return only("rss", `https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`, "плейлист YouTube");
    }
  }

  if (host === "github.com") {
    const [owner, repo] = segments;
    if (owner && repo) {
      // Релизы сначала, коммиты следом: у репозитория без единого релиза
      // releases.atom отвечает 200 и пустым фидом — это и есть отказ,
      // который выглядит как успех. Пустой фид просто не выигрывает пробу.
      return {
        candidates: [
          { kind: "rss", url: `https://github.com/${owner}/${repo}/releases.atom`, via: "релизы репозитория" },
          { kind: "rss", url: `https://github.com/${owner}/${repo}/commits.atom`, via: "коммиты репозитория" },
        ],
        probePage: false,
      };
    }
    if (owner) return only("rss", `https://github.com/${owner}.atom`, "активность пользователя GitHub");
  }

  if (host.endsWith(".substack.com")) {
    return only("rss", `https://${host}/feed`, "рассылка Substack");
  }

  if (host === "arxiv.org" || host === "export.arxiv.org") {
    const category = segments[0] === "list" ? segments[1] : null;
    if (category) return only("rss", `http://export.arxiv.org/rss/${category}`, `arXiv, раздел ${category}`);
  }

  if (host === "t.me" || host === "telegram.me") {
    // Ссылка бывает на канал, на его веб-просмотр и на отдельный пост.
    const name = segments[0] === "s" ? segments[1] : segments[0];
    if (!name || name.startsWith("+") || name === "joinchat") {
      return { refuse: "Закрытый чат читать нечем — нужен открытый канал t.me/имя" };
    }
    return only("telegram", name, `публичный канал @${name}`);
  }

  // Общий случай: сначала сам адрес — он может уже быть фидом, — а если это
  // страница, второй слой достанет из её разметки объявленный фид.
  return { candidates: [{ kind: "rss", url: url.toString(), via: "по адресу" }], probePage: true };
}

/** Похоже ли тело ответа на фид, а не на страницу. */
export function looksLikeFeed(body: string): boolean {
  return /^\s*(<\?xml|<rss\b|<feed\b|<rdf:RDF)/i.test(body);
}

function attr(tag: string, name: string): string {
  const found = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s">]+))`, "i"));
  return (found?.[2] ?? found?.[3] ?? found?.[4] ?? "").trim();
}

/**
 * Второй слой: фиды, объявленные в разметке страницы.
 *
 * Регуляркой по конкретной известной разметке, а не разбором HTML целиком:
 * <link> — самодостаточный тег, и зависимость ради него не нужна. Порядок
 * атрибутов, кавычки и относительный href встречаются все три, поэтому
 * каждый разобран отдельно, а не одним шаблоном «как обычно пишут».
 */
export function feedLinks(html: string, base: string): string[] {
  const found: string[] = [];
  // Документ целиком, а не <head>: у YouTube объявление фида лежит в теле,
  // на 761-й тысяче символов из 2,7 миллиона. Разумная на вид отсечка «первые
  // триста килобайт, фид объявляют в шапке» уже один раз дала ответ «у этого
  // сайта нет фида» ровно на том случае, ради которого всё затевалось.
  // Потолок на размер ответа стоит в fetchText и этого достаточно.
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\balternate\b/i.test(attr(tag, "rel"))) continue;
    if (!/(rss|atom|rdf)\+xml/i.test(attr(tag, "type"))) continue;
    const href = attr(tag, "href");
    if (!href) continue;
    try {
      const resolved = new URL(href, base).toString();
      if (!found.includes(resolved)) found.push(resolved);
    } catch {
      // Битый href — не повод бросать остальные объявления на странице.
    }
  }
  return found.slice(0, 5);
}

/** Третий запасной ход: четыре пути, по которым фид лежит чаще всего. */
export function guesses(base: string): string[] {
  const url = asUrl(base);
  if (!url) return [];
  const roots = [...new Set([url.origin + url.pathname.replace(/\/+$/, ""), url.origin])];
  return roots.flatMap((root) => GUESSES.map((path) => `${root}${path}`)).slice(0, 8);
}

/**
 * Почему на странице не нашлось фида. Без этого ответ «фида нет» одинаков
 * и для сайта без фида, и для страницы, которая вообще не отдаёт содержимого
 * без браузера, и для пейволла, — а это три разных решения для читателя.
 */
export function diagnose(html: string): string | null {
  // schema.org: так пейволл объявляет себя поисковикам. Дороже и честнее,
  // чем гадать по словам «подписка» в тексте.
  if (/"isAccessibleForFree"\s*:\s*(false|"false")/i.test(html)) return "статьи читаются только по подписке";
  if (/content=["']locked["']/i.test(html) && /content_tier/i.test(html)) return "статьи читаются только по подписке";

  const text = html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (html.length > 2000 && text.length < 200) return "сайт ничего не отдаёт без браузера";
  return null;
}

export type Found = {
  kind: Source["kind"];
  /** Что сохранится в sources.url. */
  url: string;
  /** Что вставил человек — сохраняется рядом, в sources.input_url. */
  input_url: string;
  label: string;
  /** Записей в фиде всего и сколько из них прошло отсечку свежести прогона. */
  entries: number;
  fresh: number;
  /** Заголовок свежей записи — доказательство, что источник и правда ответил. */
  sample: string;
  /** Её адрес: строку с доказательством можно открыть и убедиться самому. */
  sample_url: string;
  via: string;
};

export type Discovery = { ok: true; found: Found } | { ok: false; error: string };

/**
 * Чем проба отличается от прогона.
 *
 * Окно шире: проба отвечает на «отвечает ли этот источник вообще», а не
 * «свежо ли у него сегодня». У X окно по умолчанию трое суток, и аккаунт,
 * молчавший четыре дня, получал «записей в нём нет» и не добавлялся —
 * отказ, неотличимый от несуществующего адреса. Свежесть считается отдельно
 * и уже окном прогона.
 *
 * Объём, наоборот, уже: Hacker News по умолчанию читает девяносто историй
 * по одной, то есть проверка одной ссылки стоила девяноста обращений к API.
 */
const PROBE_CONFIG = { max_age_days: 30, count: 12, limit: 25, max_pages: 1 };

const probe = (candidate: Candidate, config: Record<string, unknown> = {}): Source => ({
  id: 0,
  kind: candidate.kind,
  label: candidate.url,
  url: candidate.url,
  config,
  active: true,
  input_url: null,
  last_ok_at: null,
  last_count: null,
  last_error: null,
  silent_since: null,
  deleted_at: null,
});

function labelFor(doc: FeedDoc | null, candidate: Candidate): string {
  // Название берётся из <title> фида; поле в форме остаётся правимым.
  if (doc?.title) return doc.title.slice(0, 120);
  if (candidate.kind === "hackernews") return `Hacker News · ${candidate.url}`;
  if (candidate.kind === "reddit") return `r/${candidate.url}`;
  if (candidate.kind === "x") return `X · ${candidate.url}`.slice(0, 120);
  if (candidate.kind === "telegram") return `@${candidate.url}`;
  if (candidate.kind === "email") return candidate.url;
  return candidate.url.slice(0, 120);
}

/**
 * Пробует кандидатов по очереди и останавливается на первом, который
 * действительно что-то отдал. Кандидат, ответивший 200 и пустым фидом,
 * не выигрывает: ровно так выглядит репозиторий без релизов.
 */
async function tryCandidates(candidates: Candidate[], input: string): Promise<Discovery> {
  let lastError = "";

  for (const candidate of candidates) {
    try {
      // Тем же фетчером, которым ходит прогон: у X, HN, Reddit и Telegram свой.
      const doc: FeedDoc = await fetchDoc(probe(candidate, PROBE_CONFIG));
      const items = doc.items;
      if (items.length === 0) {
        // Название фида в отказе отличает «адрес неверный» от «адрес верный,
        // но сегодня пусто»: arXiv в выходные отдаёт фид со skipDays и без
        // единой записи, и без названия это неотличимо от промаха.
        lastError = doc?.title
          ? `у «${doc.title}» есть лента новостей, но она пустая`
          : "лента новостей нашлась, но она пустая";
        continue;
      }
      const source = probe(candidate);
      const fresh = freshest(items, source);
      return {
        ok: true,
        found: {
          kind: candidate.kind,
          url: candidate.url,
          input_url: input.trim(),
          label: labelFor(doc, candidate),
          entries: items.length,
          fresh: fresh.length,
          sample: (fresh[0] ?? items[0]).title.slice(0, 200),
          sample_url: (fresh[0] ?? items[0]).url,
          via: candidate.via,
        },
      };
    } catch (error) {
      lastError = explain(error).slice(0, 200);
    }
  }
  // Перечень попыток читателю не уходит, но и пропадать ему нельзя: без него
  // «у этого сайта нет ленты» там, где она есть, воспроизводится только
  // руками. В лог — да, в ответ — нет.
  console.log(
    `  discover: не подошло ни одно из ${candidates.length}: ` +
    candidates.map(redacted).join(", "),
  );
  return { ok: false, error: lastError || "Ни один адрес не ответил" };
}

/**
 * Проба одного конкретного кандидата — того, что уже показала форма.
 * Сохранение перепроверяет именно его, а не повторяет весь разбор: иначе
 * сохранилось бы одно, а подтверждал читатель другое.
 */
export async function probeOne(
  kind: Source["kind"],
  url: string,
  input: string,
): Promise<Discovery> {
  return tryCandidates([{ kind, url, via: "по адресу" }], input);
}

export async function discover(input: string): Promise<Discovery> {
  const plan = planFor(input);
  if ("refuse" in plan) return { ok: false, error: plan.refuse };


  if (!plan.probePage) {
    const result = await tryCandidates(plan.candidates, input);
    if (result.ok) return result;
    // Без перечня адресов, которые мы пробовали: читателю он ничего
    // не говорит и повлиять на него он не может.
    return { ok: false, error: result.error };
  }

  // Общий случай: страница качается один раз. Если это уже фид — готово;
  // если страница — из её разметки берутся объявленные фиды, а тело остаётся
  // на руках, чтобы потом объяснить отказ, а не просто сообщить о нём.
  const base = plan.candidates[0].url;
  let page = "";
  try {
    page = await fetchText(base);
  } catch (error) {
    return { ok: false, error: `Адрес не отвечает: ${explain(error).slice(0, 200)}` };
  }

  if (looksLikeFeed(page)) {
    const doc = parseFeed(page);
    if (doc.items.length > 0) {
      const candidate: Candidate = { kind: "rss", url: base, via: "по адресу" };
      const fresh = freshest(doc.items, probe(candidate));
      return {
        ok: true,
        found: {
          kind: "rss",
          url: base,
          input_url: input.trim(),
          label: labelFor(doc, candidate),
          entries: doc.items.length,
          fresh: fresh.length,
          sample: (fresh[0] ?? doc.items[0]).title.slice(0, 200),
          sample_url: (fresh[0] ?? doc.items[0]).url,
          via: candidate.via,
        },
      };
    }
    return { ok: false, error: "Лента новостей нашлась, но она пустая" };
  }

  const declared: Candidate[] = feedLinks(page, base).map((url) => ({
    kind: "rss" as const,
    url,
    via: VIA_SITE,
  }));
  const guessed: Candidate[] = guesses(base)
    .filter((url) => !declared.some((candidate) => candidate.url === url))
    .map((url) => ({ kind: "rss" as const, url, via: VIA_SITE }));

  const result = await tryCandidates([...declared, ...guessed], input);
  if (result.ok) return result;

  const why = diagnose(page);
  if (why) return { ok: false, error: `Новости отсюда не забрать: ${why}` };
  return {
    ok: false,
    // Список наших попыток наружу не уходит — ни здесь, ни в ветке выше:
    // читатель не может ни повлиять на него, ни что-то из него понять.
    error: "У этого сайта нет ленты новостей — её должен завести сам сайт",
  };
}
