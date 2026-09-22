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
import { documentText, type StoredReading } from "../src/lib/reading-document";
import { typography } from "../src/lib/typography";
import type { Dict } from "../src/lib/i18n";
import { ru } from "../src/lib/i18n/ru/index";
import { cheapestFor, FEATURES, type Plan } from "../src/lib/plans";
import { kindlePeriodOf, type KindlePeriod } from "../src/lib/types";
import { effectivePlan } from "../src/lib/lemon";
/** Домен отправителя. Переменная старше константы: она уже есть
 *  в окружении, и константа рядом с ней — настройка, которой никто
 *  не управляет. Пустая строка — это «не задано», а не пустой домен. */
const DOMAIN = process.env.KINDLE_FROM_DOMAIN?.trim() || "kindle.tomko.io";

export type Article = {
  title: string;
  summary: string;
  reading?: StoredReading;
  url: string;
  source_label: string;
  topic_label: string;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Один выпуск внутри книги. Их бывает семь: недельная книга — это те же
 * выпуски, что пришли бы семью письмами, собранные в один файл.
 */
export type Issue = { day: string; intro: string; articles: Article[] };

/**
 * Заголовок книги и тема письма. Диапазон, а не «за неделю»: дата отвечает
 * на вопрос «что я пропустил», а слово «неделя» — нет, и в библиотеке
 * читалки семь таких книг подряд неразличимы.
 *
 * Даты сырые, как и у дневной: книга уезжает читателю с любым языком
 * интерфейса, а ISO-дата читается одинаково у всех — в отличие от
 * «16 сентября», которое пришлось бы переводить на шестнадцать языков
 * ради строки в заголовке файла.
 */
export const bookTitle = (issues: Issue[]): string =>
  issues.length > 1
    ? `Reporta, ${issues[0].day} — ${issues[issues.length - 1].day}`
    : `Reporta за ${issues[0]?.day ?? ""}`;

/**
 * Книга: один выпуск или несколько.
 *
 * Дни идут от старого к новому — это книга, а не лента: читают её подряд,
 * и обратный порядок означал бы, что понедельник объясняется после среды.
 *
 * Уровень заголовка статьи зависит от числа дней, и это не украшение:
 * оглавление читалки строится по заголовкам, и в недельной книге день
 * обязан быть главой, а статья внутри неё. Оставь статью на h2 — и семь
 * дней встанут в оглавлении вперемешку с сотней заголовков.
 */
export function digestHtml(issues: Issue[]): string {
  const week = issues.length > 1;
  const title = bookTitle(issues);

  const articleHtml = (a: Article) =>
    [
      `<p class="meta"><a href="${escapeHtml(/^https?:\/\//i.test(a.url) ? a.url : "#")}">${escapeHtml(a.source_label)}</a> · ${escapeHtml(a.topic_label)}</p>`,
      `<${week ? "h3" : "h2"}>${escapeHtml(typography(a.title))}</${week ? "h3" : "h2"}>`,
      ...(a.reading?.document ? [a.reading.notice, documentText(a.reading.document)] : [a.summary]).filter(Boolean).join("\n\n").split(/\n\n+/).map((p) => `<p>${escapeHtml(typography(p)).replace(/\n/g, "<br>")}</p>`),
    ].join("\n");

  const body = issues
    .map((issue) =>
      [
        // Вступление дня остаётся при своём дне: оно написано про этот
        // выпуск, и вынесенное наверх книги объясняло бы вторник словами
        // субботы. Нового текста для книги не пишется — это был бы вызов
        // модели за то, что уже написано семь раз.
        week ? `<h2>${escapeHtml(issue.day)}</h2>` : "",
        issue.intro ? `<p>${escapeHtml(issue.intro)}</p>` : "",
        issue.articles.map(articleHtml).join("\n\n"),
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  // Кодировка объявляется явно: без неё Kindle читает кириллицу как мусор,
  // и выпуск приходит целым на вид.
  return [
    "<!doctype html>",
    '<html lang="ru"><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>body{font-family:serif}${week ? "h2,h3" : "h2"}{page-break-before:always}.meta{color:#555;font-size:.85em}</style>`,
    "</head><body>",
    `<h1>${escapeHtml(title)}</h1>`,
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
  issues: Issue[];
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  // Пустая книга письмом не уходит: Amazon примет её и положит в библиотеку
  // пустой файл, а читатель прочитает это как «за неделю не было ничего»,
  // хотя означать это может отпуск, паузу или сбой прогона.
  if (options.issues.length === 0) return false;

  const html = digestHtml(options.issues);
  const title = bookTitle(options.issues);
  const name = `reporta-${options.issues[0].day}${options.issues.length > 1 ? `-${options.issues[options.issues.length - 1].day}` : ""}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: `Reporta <${senderAddress(options.sender)}>`,
      to: [options.to],
      subject: title,
      text: `${title} — во вложении.`,
      attachments: [
        {
          filename: `${name}.html`,
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
  /** 'daily' или 'weekly'; свободный текст читается как 'daily'. */
  kindle_period: string;
  /** День последней недельной отправки, 'YYYY-MM-DD' или null. */
  kindle_weekly_at: string | null;
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
  | { send: true; to: string; sender: string; period: KindlePeriod }
  | {
      send: false;
      reason:
        | "no-address"
        | "no-sender"
        | "switched-off"
        | "plan"
        | "weekly-other-day"
        | "weekly-sent";
    };

/**
 * Сколько выпусков входит в недельную книгу. Семь, включая сегодняшний:
 * читатель заказал не «неделю», а то, что пришло бы ему письмами, — и день,
 * выпавший из окна, не вернётся уже никогда.
 */
export const WEEK_DAYS = 7;

/**
 * Суббота. День недели у недельной книги выбран, а не настраивается: книга
 * на семь выпусков — это чтение на выходных, а пришедшая в среду она
 * читается с телефона по частям, то есть ровно как лента, только позже.
 *
 * Полдень в UTC, а не полночь: день приходит датой без времени, и `T00:00`
 * в отрицательном поясе означал бы предыдущие сутки — суббота стала бы
 * пятницей у всех, кто западнее Гринвича.
 */
export const WEEKLY_DOW = 6;
export const isWeeklyDay = (day: string): boolean =>
  new Date(`${day}T12:00:00Z`).getUTCDay() === WEEKLY_DOW;

export function kindleDigestVerdict(reader: KindleTarget, day: string): KindleVerdict {
  // Тариф проверяется и здесь, а не только в форме: переключатель мог
  // остаться включённым с прежнего тарифа, а письмо — это чужой лимит
  // у Amazon и счёт у Resend.
  if (!FEATURES.delivery.has(effectivePlan(reader as never))) return { send: false, reason: "plan" };
  if (!reader.kindle_address) return { send: false, reason: "no-address" };
  if (!reader.kindle_sender) return { send: false, reason: "no-sender" };
  if (!reader.kindle_digest) return { send: false, reason: "switched-off" };

  const period = kindlePeriodOf(reader.kindle_period);
  if (period === "weekly") {
    // Не суббота — молчим: это не отказ, а шесть дней из семи.
    if (!isWeeklyDay(day)) return { send: false, reason: "weekly-other-day" };
    // Второй прогон за те же сутки не шлёт вторую книгу. Amazon считает
    // объём по адресу отправителя и гасит его без предупреждения читателю.
    if (reader.kindle_weekly_at === day) return { send: false, reason: "weekly-sent" };
  }

  return { send: true, to: reader.kindle_address, sender: reader.kindle_sender, period };
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
      from: `Reporta <${senderAddress(options.sender)}>`,
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
  /**
   * Действующий тариф. Проверяется здесь, а не только на кнопке: адрес
   * читалки переживает понижение тарифа, и без этой строки отправка статьи
   * продолжала бы стоить цент за нажатие на тарифе, где читалки нет вовсе.
   * У выпуска книгой такая проверка стоит своя (`kindleDigestVerdict`),
   * а у отдельной статьи не стояло нигде.
   */
  plan: Plan,
  spent: number,
  // Словарь необязателен и по умолчанию русский: эту же проверку зовёт
  // ночной прогон, где спрашивать язык не у кого, — а веб передаёт язык
  // своего читателя и получает отказ на нём.
  t: Dict["errors"] = ru.errors,
): string {
  // Тариф — первым: без него отказ называл бы недостающий адрес, который
  // на закрытом тарифе и вписать-то негде.
  if (!FEATURES.delivery.has(plan)) return t.kindleOnPlan(cheapestFor("delivery").label);
  if (!reader.kindle_address) return t.kindleNoAddress;
  if (!reader.kindle_sender) return t.kindleNoSender;
  // Пока отправитель не одобрен у Amazon, письмо уходит и исчезает: код
  // E014, уведомление владельцу читалки, тишина в нашу сторону. Отказать
  // здесь дешевле, чем потратить минуту и цент на книгу, которую Amazon
  // выбросит, — и честнее, чем показать «отправлено».
  if (!reader.kindle_approved) return t.kindleNotApproved;
  // Потолок проверяется до вызовов, а не после: узнать о перерасходе
  // постфактум можно и из счёта.
  if (spent >= reader.daily_cap_usd) {
    // Сумма наружу не уходит: это наш потолок расходов, а не квота,
    // о которой читатель что-то знает. Ему важно одно — когда снимется.
    return t.kindleCapReached;
  }
  return "";
}
