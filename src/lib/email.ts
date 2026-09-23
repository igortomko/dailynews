/**
 * Письма читателю: ссылка входа и выпуск тем, кто пришёл без Telegram.
 *
 * Через тот же Resend и тот же домен, что и Kindle: второй проверенный
 * домен — это DNS, а не код. Локальная часть `news` с отправителями
 * Kindle не сталкивается: те — цифры Telegram или `reader<id>`
 * (`kindleSenderName`), и счётчик объёма у Amazon остаётся их личным.
 *
 * Без импорта server-only: письмо с выпуском шлёт прогон в Actions.
 */
import { dayUrl, digestMessage, type Headline } from "./telegram";
import { plural } from "./plural";

const DOMAIN = process.env.KINDLE_FROM_DOMAIN?.trim() || "kindle.tomko.io";
const FROM = process.env.MAIL_FROM?.trim() || `Reporta <news@${DOMAIN}>`;

/** Ящик в нижнем регистре: один адрес — один читатель, как бы его ни набрали. */
export const normalizeEmail = (value: string) => value.trim().toLowerCase();

/** Проверка формы, а не существования: существование подтверждает клик по ссылке. */
export const looksLikeEmail = (value: string) =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Разметка Telegram в простой текст письма: теги прочь, сущности обратно. */
const plain = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

export async function sendEmail(input: { to: string; subject: string; html: string; text: string }) {
  const key = process.env.RESEND_API_KEY;
  // Незаданный ключ — отказ вслух: молча не отправленная ссылка входа
  // выглядит для читателя как письмо, застрявшее в спаме.
  if (!key) throw new Error("RESEND_API_KEY не задан");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: FROM, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Кнопка ссылкой: почтовые клиенты режут стили, а таблицу и inline-стиль держат все. */
const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(label)}</a></p>`;

export function loginEmail(link: string, t: { subject: string; intro: string; button: string; outro: string }) {
  return {
    subject: t.subject,
    html: `<p>${escapeHtml(t.intro)}</p>${button(link, t.button)}<p style="color:#666">${escapeHtml(t.outro)}</p>`,
    text: `${t.intro}\n\n${link}\n\n${t.outro}`,
  };
}

/**
 * Выпуск письмом. Тело — то же, что у rich message в Telegram
 * (`digestMessage`): заголовки, темы, ссылка на каждую карточку.
 * Вторая вёрстка того же списка разошлась бы с первой на первой правке.
 * Подкаста здесь нет: он едет блоком аудио, а у письма его места нет.
 */
export function digestEmail(input: {
  day: string;
  headlines: Headline[];
  appUrl: string;
  size: string;
  picked: string | null;
  upsell: string | null;
}) {
  const { html, classic } = digestMessage({ ...input, podcast: false });
  const subject = plain(classic.split("\n")[0]);
  const url = dayUrl(input.appUrl, input.day);
  return {
    subject,
    html: `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;max-width:640px">${html}${button(url, "Читать выпуск")}</div>`,
    text: `${plain(classic)}\n\n${url}`,
  };
}

/**
 * Пауза спящего — то же, что вопрос в боте (`askResume`), только без кнопок:
 * заход на сайт снимает паузу сам, и ссылки на ленту достаточно.
 */
export function pauseEmail(appUrl: string, silentDays: number) {
  const intro =
    `Лента не открывалась ${silentDays} ${plural(silentDays, "день", "дня", "дней")}, ` +
    "и мы поставили выпуск на паузу, чтобы не слать его в пустоту. " +
    "Зайди в ленту — и выпуски вернутся со следующей ночи.";
  return {
    subject: "Reporta на паузе",
    html: `<p>${escapeHtml(intro)}</p>${button(appUrl, "Вернуть ленту")}`,
    text: `${intro}\n\n${appUrl}`,
  };
}
