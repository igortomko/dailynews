/**
 * Забрать статью по ссылке и оставить от неё текст.
 *
 * Два уровня вместо трёх. У DropKind, который решает ту же задачу для
 * тысяч чужих ссылок, их три: обычный запрос, свой headless Chrome через
 * residential-прокси и платный краулер сверху. Здесь лента личная
 * и ссылки приходят из RSS и Hacker News, поэтому хватает первого уровня
 * и одного запасного. Свой Chrome с прокси заводится, когда конкретный
 * источник начнёт падать регулярно, а не заранее.
 */
import { parseHTML } from "linkedom";

/**
 * Динамический импорт, а не обычный: defuddle отдаёт подпуть ./node только
 * для ESM, а конвейер запускается через tsx, который собирает эти файлы
 * в CJS. Статический import ломается на require ещё до первого запроса —
 * и ломается он в прогоне, а не в типах.
 */
type DefuddleFn = (doc: Document, url: string, options?: Record<string, unknown>) =>
  Promise<{ content?: string; title?: string; author?: string; site?: string }>;

let defuddle: DefuddleFn | null = null;
async function loadDefuddle(): Promise<DefuddleFn> {
  defuddle ??= (await import("defuddle/node")).Defuddle as unknown as DefuddleFn;
  return defuddle;
}

export type Article = {
  title: string;
  author: string | null;
  site: string;
  /** Markdown, а не HTML: переводится кусками по абзацам и не рвёт разметку. */
  markdown: string;
  words: number;
  /** Каким уровнем достали. Уходит в лог: молчаливый переход на запасной
   *  путь — это медленно и платно, и знать об этом надо. */
  via: "feed" | "direct" | "reader";
};

/** Похоже на браузер: часть сайтов отдаёт пустую страницу голому agent'у. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/**
 * Ниже этого статья не статья. Защита от самого частого отказа: страница
 * ответила 200, разметка распарсилась, в тексте — «Enable JavaScript»
 * или форма подписки. Формально успех, читать нечего.
 */
const MIN_WORDS = 120;

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

async function get(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Разбор готового HTML: одинаков для текста из фида и для скачанной страницы. */
async function clean(html: string, url: string, via: Article["via"]): Promise<Article | null> {
  const { document } = parseHTML(html);
  const Defuddle = await loadDefuddle();
  const result = await Defuddle(document as unknown as Document, url, { markdown: true });

  const markdown = (result.content ?? "").trim();
  const words = countWords(markdown);
  if (words < MIN_WORDS) return null;

  return {
    title: result.title || new URL(url).hostname,
    author: result.author || null,
    site: result.site || new URL(url).hostname,
    markdown,
    words,
    via,
  };
}

/** Первый уровень: страница как есть, разбор на месте. */
async function direct(url: string): Promise<Article | null> {
  return clean(await get(url), url, "direct");
}

/**
 * Запасной уровень: Jina Reader. Он сам отрисовывает JavaScript и отдаёт
 * уже очищенный текст — то, ради чего у DropKind стоит свой Chrome.
 * Бесплатный тариф без ключа медленнее и с лимитом, но ссылок здесь
 * единицы в день.
 */
async function reader(url: string): Promise<Article | null> {
  const markdown = (
    await get(`https://r.jina.ai/${url}`, {
      accept: "text/plain",
      "x-return-format": "markdown",
    })
  ).trim();

  const words = countWords(markdown);
  if (words < MIN_WORDS) return null;

  // Reader кладёт свою шапку перед текстом: Title, URL Source, Published Time,
  // потом «Markdown Content:». Заголовок оттуда берём, шапку отрезаем —
  // иначе она уедет в книгу как первый абзац.
  const head = markdown.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
  const body = markdown.split(/^Markdown Content:\s*$/m)[1]?.trim() ?? markdown;

  return {
    title: head || new URL(url).hostname,
    author: null,
    site: new URL(url).hostname,
    markdown: body,
    words: countWords(body),
    via: "reader",
  };
}

/**
 * Достать статью. Бросает, если не смог ни одним путём: пустая книга
 * на читалке хуже честной ошибки в интерфейсе.
 *
 * feedBody — полный текст, который отдал сам фид. Если он есть, никуда
 * ходить не надо: текст уже приехал при сборе, он чистый, и его не может
 * не отдать антибот. Это уровень, которого нет и не может быть у сервисов
 * вроде DropKind: им приходит голая ссылка, а сюда — запись фида целиком.
 */
export async function fetchArticle(url: string, feedBody?: string | null): Promise<Article> {
  const reasons: string[] = [];

  if (feedBody) {
    try {
      const fromFeed = await clean(feedBody, url, "feed");
      if (fromFeed) return fromFeed;
      reasons.push(`feed: текста меньше ${MIN_WORDS} слов`);
    } catch (error) {
      reasons.push(`feed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const [name, attempt] of [["direct", direct], ["reader", reader]] as const) {
    try {
      const article = await attempt(url);
      if (article) return article;
      reasons.push(`${name}: текста меньше ${MIN_WORDS} слов`);
    } catch (error) {
      reasons.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`не смог забрать текст (${reasons.join("; ")})`);
}
