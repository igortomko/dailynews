/**
 * Сборка книги для Kindle.
 *
 * EPUB, а не голый HTML, хотя Amazon принимает и его. У HTML своя ошибка
 * доставки — E015, «Web Extraction Error»: Amazon сам вытаскивает текст
 * из присланной страницы и отказывается, если она «empty, protected, or
 * contains incompatible elements». Собирая EPUB, мы делаем эту работу
 * сами и знаем, что получилось. Заодно в книгу попадают заголовок
 * и автор — в библиотеке читалки виден именно они.
 */
import epub from "epub-gen-memory";

/** marked восемнадцатой версии — только ESM, а конвейер идёт через tsx
 *  в CJS. Тот же случай, что с defuddle: статический import падает
 *  на require в прогоне, а не в типах. */
type Render = (markdown: string) => string | Promise<string>;
let render: Render | null = null;
async function loadMarked(): Promise<Render> {
  render ??= (await import("marked")).marked.parse as Render;
  return render;
}

/**
 * Код языка для EPUB. Профиль хранит язык словом («русском»), потому что
 * он уходит в промпт, а читалке нужен код: от него зависит перенос слов.
 * Незнакомый язык — не повод падать, книга важнее переносов.
 */
function langCode(language: string): string {
  const word = language.toLowerCase();
  if (word.includes("рус")) return "ru";
  if (word.includes("англ")) return "en";
  if (word.includes("португ")) return "pt-BR";
  if (word.includes("испан")) return "es";
  if (word.includes("немец")) return "de";
  return "ru";
}

/**
 * SVG выбрасывается до сборки. Amazon возвращает E013/E016 на документы
 * с SVG, математикой и градиентами: книга доставляется, но теряет
 * перетекание текста — размер шрифта на читалке перестаёт работать.
 * Ради одной картинки терять это не стоит.
 */
const dropSvg = (html: string) => html.replace(/<img[^>]+\.svg[^>]*>/gi, "");

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Kindle рисует ссылку в начале как обычный абзац; серый цвет и линия
 *  сверху отделяют её от текста, не занимая отдельной страницы. */
const CSS = `
  .source { margin: 0 0 1.4em; font-size: 0.85em; color: #555; }
  blockquote { margin: 1em 1.5em; font-style: italic; }
  pre { font-size: 0.8em; white-space: pre-wrap; word-wrap: break-word; }
  img { max-width: 100%; }
`;

export type Book = {
  title: string;
  author: string | null;
  site: string;
  url: string;
  /** Уже переведённый markdown. */
  markdown: string;
  language: string;
};

export async function buildEpub(book: Book): Promise<Buffer> {
  const parse = await loadMarked();
  const body = dropSvg(String(await parse(book.markdown)));

  // Ссылка на оригинал в начале, а не в подвале: на читалке подвал —
  // это отдельный экран в конце, до которого не доходят, а вернуться
  // к источнику хочется как раз на первых абзацах.
  const source =
    `<p class="source">${escape(book.site)} · ` +
    `<a href="${escape(book.url)}">${escape(book.url)}</a></p>`;

  return epub(
    {
      title: book.title,
      author: book.author || book.site,
      lang: langCode(book.language),
      css: CSS,
      // Картинка не открывается — это не причина не отдать текст.
      ignoreFailedDownloads: true,
      fetchTimeout: 20_000,
      // Оглавление из одной главы — лишний экран перед статьёй,
      // а заголовок над текстом дублирует обложку.
      tocInTOC: false,
      prependChapterTitles: false,
    },
    [{ title: book.title, content: source + body }],
  ) as Promise<Buffer>;
}
