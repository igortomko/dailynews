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
    `<title>Лента за ${escapeHtml(day)}</title>`,
    "<style>body{font-family:serif}h2{page-break-before:always}.meta{color:#555;font-size:.85em}</style>",
    "</head><body>",
    `<h1>Лента за ${escapeHtml(day)}</h1>`,
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
      from: `Лента <${senderAddress(options.sender)}>`,
      to: [options.to],
      subject: `Лента за ${options.day}`,
      text: `Выпуск за ${options.day} — во вложении.`,
      attachments: [
        {
          filename: `lenta-${options.day}.html`,
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
