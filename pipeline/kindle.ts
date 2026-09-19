/**
 * Выпуск книгой на Kindle. Через Resend: домен kindle.tomko.io.
 *
 * Обратный адрес свой на каждого читателя. Amazon считает объём по адресу
 * отправителя — E010 предупреждение, E011 последнее, E012 блокировка
 * с формулировкой «personal, non-commercial use only», — и общий адрес
 * копит счётчик на всех, а отваливается разом у всех.
 *
 * Отправляем HTML, а не EPUB: Send to Kindle принимает его и сам делает
 * из заголовков оглавление.
 * ponytail: HTML вместо EPUB — если понадобится обложка и точное
 * разбиение на главы, здесь появится сборка zip.
 */
import { FEATURES } from "../src/lib/plans";
import { effectivePlan } from "../src/lib/lemon";
/** Домен отправителя. Переменная старше константы: она уже есть
 *  в окружении, и константа рядом с ней — настройка, которой никто
 *  не управляет. Пустая строка — это «не задано», а не пустой домен. */
const DOMAIN = process.env.KINDLE_FROM_DOMAIN?.trim() || "kindle.tomko.io";

export type Article = {
  title: string;
  summary: string;
  url: string;
  source_label: string;
  topic_label: string;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function digestHtml(day: string, intro: string, articles: Article[]): string {
  const body = articles
    .map((a) =>
      [
        `<h2>${escapeHtml(a.title)}</h2>`,
        `<p class="meta">${escapeHtml(a.topic_label)} · ${escapeHtml(a.source_label)}</p>`,
        `<p>${escapeHtml(a.summary)}</p>`,
        `<p class="meta"><a href="${escapeHtml(a.url)}">Источник</a></p>`,
      ].join("\n"),
    )
    .join("\n\n");

  // Кодировка объявляется явно: без неё Kindle читает кириллицу как мусор,
  // и выпуск приходит целым на вид.
  return [
    "<!doctype html>",
    '<html lang="ru"><head><meta charset="utf-8">',
    `<title>Retorta за ${escapeHtml(day)}</title>`,
    "<style>body{font-family:serif}h2{page-break-before:always}.meta{color:#555;font-size:.85em}</style>",
    "</head><body>",
    `<h1>Retorta за ${escapeHtml(day)}</h1>`,
    intro ? `<p>${escapeHtml(intro)}</p>` : "",
    body,
    "</body></html>",
  ].join("\n");
}

export const senderAddress = (local: string) => `${local}@${DOMAIN}`;

/**
 * Возвращает false, когда отправка не настроена, — и это не ошибка прогона:
 * Kindle подключён не у всех, и выпуск в вебе должен появиться в любом случае.
 */
export async function sendToKindle(options: {
  to: string;
  sender: string;
  day: string;
  intro: string;
  articles: Article[];
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  const html = digestHtml(options.day, options.intro, options.articles);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: `Retorta <${senderAddress(options.sender)}>`,
      to: [options.to],
      subject: `Retorta за ${options.day}`,
      text: `Выпуск за ${options.day} — во вложении.`,
      attachments: [
        {
          filename: `retorta-${options.day}.html`,
          content: Buffer.from(html, "utf8").toString("base64"),
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return true;
}

/**
 * Уходит ли выпуск этому читателю на читалку.
 *
 * Три условия, и каждое выключает по своей причине: нет адреса — слать
 * некуда; нет обратного адреса — Amazon отбросит письмо молча; выключен
 * переключатель — читатель просил не слать выпуск, но адрес оставил
 * для отправки отдельных статей. Раньше третьего не было, и «не присылай
 * выпуск» делалось стиранием адреса, заодно выключая ручную отправку.
 */
type KindleTarget = {
  kindle_address: string | null;
  kindle_sender: string | null;
  kindle_digest: boolean;
  // Тариф целиком, а не признак: действующий считается из статуса и даты,
  // и второй способ его вычислить разошёлся бы с первым.
  plan: string;
  // Подписка целиком: её отсутствие — законное состояние (тариф выставлен
  // руками), и без этой колонки владелец получал бы отказ при правильном
  // тарифе в базе.
  subscription_id: string | null;
  subscription_status: string | null;
  plan_ends_at: string | null;
};

/**
 * Уходит ли выпуск этому читателю на читалку — и если нет, почему.
 *
 * Вердикт, а не булево: три причины отказа требуют разного обращения.
 * Пустой адрес — читатель не просил, молчать уместно. Не выданный обратный
 * адрес — сбой на нашей стороне при вписанном адресе, и молчать нельзя:
 * выпуска ждут. Выключенный переключатель — решение читателя; адрес он
 * оставил для отправки отдельных статей, и раньше такого выбора не было
 * вовсе: «не присылай выпуск» делалось стиранием адреса, заодно выключая
 * ручную отправку.
 */
export type KindleVerdict =
  | { send: true; to: string; sender: string }
  | { send: false; reason: "no-address" | "no-sender" | "switched-off" | "plan" };

export function kindleDigestVerdict(reader: KindleTarget): KindleVerdict {
  // Тариф проверяется и здесь, а не только в форме: переключатель мог
  // остаться включённым с прежнего тарифа, а письмо — это чужой лимит
  // у Amazon и счёт у Resend.
  if (!FEATURES.delivery.has(effectivePlan(reader as never))) return { send: false, reason: "plan" };
  if (!reader.kindle_address) return { send: false, reason: "no-address" };
  if (!reader.kindle_sender) return { send: false, reason: "no-sender" };
  if (!reader.kindle_digest) return { send: false, reason: "switched-off" };
  return { send: true, to: reader.kindle_address, sender: reader.kindle_sender };
}

/**
 * Отдельная статья книгой. Отличается от выпуска не только содержимым:
 * выпуск уходит HTML, а статья — EPUB.
 *
 * Причина в картинках и в метаданных. У HTML, присланного письмом, Amazon
 * вытаскивает текст сам и на этом спотыкается — код E015, «Web Extraction
 * Error»: «empty, protected, or contains incompatible elements». Картинки
 * по внешним ссылкам он не забирает, а в библиотеке читалки книга
 * называется так, как написано в метаданных, которых у голого HTML нет.
 * Для выпуска это неважно — там заголовки и описания без картинок.
 */
export async function sendArticleToKindle(options: {
  to: string;
  sender: string;
  title: string;
  epub: Buffer;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("нет RESEND_API_KEY: отправлять нечем");

  // Amazon: 50 МБ на письмо, base64 раздувает на треть. Статья столько
  // не наберёт, книга с сотней несжатых картинок — запросто, и упереться
  // лучше здесь, с понятной ошибкой, чем в их код E007.
  if (options.epub.length > 20 * 1024 * 1024) {
    throw new Error(`книга ${(options.epub.length / 1024 / 1024).toFixed(1)} МБ, потолок 20 МБ`);
  }

  // Имя файла видно в библиотеке, если метаданные не прочитались.
  // Кириллица и пробелы в нём до читалки доезжают плохо.
  const name =
    options.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) ||
    "article";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: `Retorta <${senderAddress(options.sender)}>`,
      to: [options.to],
      subject: options.title,
      text: options.title,
      attachments: [{ filename: `${name}.epub`, content: options.epub.toString("base64") }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/**
 * Почему отправка статьи невозможна прямо сейчас. Пустая строка — можно.
 *
 * Отдельно от самой отправки и без импорта базы: это чистая функция,
 * и у неё есть проверка в npm test, который не ходит ни в базу, ни в сеть.
 */
export function articleBlocker(
  reader: {
    kindle_address: string | null;
    kindle_sender: string | null;
    kindle_approved: boolean;
    daily_cap_usd: number;
  },
  spent: number,
): string {
  if (!reader.kindle_address) return "Сначала настрой Kindle в «Доставке» — там нужен адрес читалки";
  if (!reader.kindle_sender) return "Это наша поломка — напиши боту в Telegram";
  // Пока отправитель не одобрен у Amazon, письмо уходит и исчезает: код
  // E014, уведомление владельцу читалки, тишина в нашу сторону. Отказать
  // здесь дешевле, чем потратить минуту и цент на книгу, которую Amazon
  // выбросит, — и честнее, чем показать «отправлено».
  if (!reader.kindle_approved) return "Amazon ещё не разрешил наш адрес — доделай настройку в «Доставке»";
  // Потолок проверяется до вызовов, а не после: узнать о перерасходе
  // постфактум можно и из счёта.
  if (spent >= reader.daily_cap_usd) {
    // Сумма наружу не уходит: это наш потолок расходов, а не квота,
    // о которой читатель что-то знает. Ему важно одно — когда снимется.
    return "Сегодня больше отправить нельзя — завтра лимит обнулится";
  }
  return "";
}
