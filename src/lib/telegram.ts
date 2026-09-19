import { equal } from "./auth";

/**
 * Бот здесь делает две вещи: заводит читателя по /start и присылает ему
 * ссылку на свежий выпуск. Читают в вебе, а не в Telegram: там пролистывание
 * неотличимо от чтения, и любая статистика оттуда завышена ровно на ту долю,
 * которую читатель проматывает.
 *
 * Апдейты приходят вебхуком, а не поллингом. Отдельный процесс на общей
 * машине заводить нельзя, а два процесса с одним токеном отбирают апдейты
 * друг у друга — симптом выглядит как «бот иногда не отвечает».
 */
export const SECRET_HEADER = "x-telegram-bot-api-secret-token";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Адрес вебхука открыт всему интернету: кто угодно может прислать туда
 * «/start от читателя номер такой-то». Единственное, что отличает Telegram
 * от постороннего, — этот заголовок.
 *
 * Без заданного секрета проверка отвечает «нет», а не «да»: незаполненная
 * переменная не должна открывать дверь.
 */
export function checkSecret(header: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !header) return false;
  return equal(header, expected);
}

export type BotCommand =
  | { kind: "start"; telegramId: number; chatId: number; username: string | null }
  | { kind: "help"; chatId: number }
  /** Ответ на «дочитал?»: единственный сигнал о том, что уехало на читалку. */
  | { kind: "finished"; telegramId: number; itemId: number; finished: boolean; callbackId: string }
  | { kind: "ignore" };

type Update = {
  message?: {
    text?: unknown;
    chat?: { id?: unknown; type?: unknown };
    from?: { id?: unknown; is_bot?: unknown; username?: unknown };
  };
  callback_query?: {
    id?: unknown;
    data?: unknown;
    from?: { id?: unknown; is_bot?: unknown };
  };
};

/** Полезная нагрузка кнопки «дочитал». Telegram даёт под неё 64 байта,
 *  поэтому id материала, а не заголовок. */
export const FINISHED_PREFIX = "fin";

const isId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

/**
 * Разбор апдейта. Чистая функция: у неё есть проверка в npm test, а у
 * работающего вебхука — нет, пока кто-нибудь не напишет боту.
 *
 * Только личные чаты. В группе /start прислал бы ссылку входа всем
 * участникам разом, и выглядело бы это как обычный ответ бота.
 */
export function parseUpdate(update: unknown): BotCommand {
  // Нажатие кнопки приходит не сообщением, а callback_query, и до этой
  // ветки апдейт молча проваливался в ignore: кнопка нажималась, часики
  // на ней крутились вечно, ответ никуда не записывался.
  const callback = (update as Update | null)?.callback_query;
  if (callback) {
    const from = callback.from?.id;
    const data = typeof callback.data === "string" ? callback.data : "";
    const id = typeof callback.id === "string" ? callback.id : "";
    const parts = data.split(":");
    if (
      isId(from) && callback.from?.is_bot !== true && id &&
      parts[0] === FINISHED_PREFIX && parts.length === 3 && /^\d+$/.test(parts[1])
    ) {
      return {
        kind: "finished",
        telegramId: from,
        itemId: Number(parts[1]),
        finished: parts[2] === "1",
        callbackId: id,
      };
    }
    return { kind: "ignore" };
  }

  const message = (update as Update | null)?.message;
  if (!message || message.chat?.type !== "private") return { kind: "ignore" };

  const chatId = message.chat?.id;
  const telegramId = message.from?.id;
  if (!isId(chatId) || !isId(telegramId) || message.from?.is_bot === true) {
    return { kind: "ignore" };
  }

  const text = typeof message.text === "string" ? message.text.trim() : "";
  // /start@ИмяБота и /start с полезной нагрузкой — тот же /start.
  const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();
  if (command === "/start") {
    const username = typeof message.from?.username === "string" ? message.from.username : null;
    return { kind: "start", telegramId, chatId, username };
  }
  return text ? { kind: "help", chatId } : { kind: "ignore" };
}

async function call(method: string, body: object): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Telegram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export async function sendMessage(chatId: number, text: string): Promise<void> {
  await call("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

/**
 * Спросить, дочитал ли он то, что уехало на читалку.
 *
 * Это единственная петля измерения вокруг отправки: Amazon обратно
 * не говорит ничего и не может. Автор DropKind на тот же вопрос отвечает
 * «процентов 80, это моя личная оценка» — у него голая ссылка и нечем
 * мерить. У Ленты есть и что отправлено, и с каким скором.
 *
 * Одно сообщение на статью и только на следующий день: спросить вечером
 * того же дня значит спросить до того, как он сел читать.
 */
export async function askFinished(chatId: number, itemId: number, title: string): Promise<void> {
  await call("sendMessage", {
    chat_id: chatId,
    text: `Дочитал «${title.slice(0, 120)}»?`,
    reply_markup: {
      inline_keyboard: [[
        { text: "Дочитал", callback_data: `${FINISHED_PREFIX}:${itemId}:1` },
        { text: "Не пошло", callback_data: `${FINISHED_PREFIX}:${itemId}:0` },
      ]],
    },
  });
}

/**
 * Погасить часики на кнопке. Без этого Telegram крутит их секунд тридцать,
 * и нажатие выглядит как потерянное — притом что ответ уже записан.
 */
export async function answerCallback(callbackId: string, text: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackId, text });
}

/**
 * Дата словами: «2026-09-19» → «19 сентября». В базе день лежит строкой,
 * и без разворота читатель каждое утро получал бы машинную дату.
 * Год не пишется: выпуск приходит в день выпуска.
 */
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export function dayInWords(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  // Незнакомая форма возвращается как есть: подменять её выдуманной датой
  // хуже, чем показать строку из базы.
  if (!match) return day;
  // Формат совпал — это ещё не дата: «2026-13-19» дал бы «19 undefined»
  // в единственном сообщении, которое читатель видит каждое утро.
  const month = Number(match[2]);
  const date = Number(match[3]);
  // Календарём, а не диапазоном: «2026-02-31» проходит проверку на 1–31
  // и выходит «31 февраля». Date нормализует такую дату в марта первое,
  // и расхождение после нормализации и есть ответ.
  const parsed = new Date(Date.UTC(Number(match[1]), month - 1, date));
  if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) return day;
  return `${date} ${MONTHS[month - 1]}`;
}

/**
 * Русское склонение при числе. Одна реализация на все слова: копия на каждое
 * новое слово — это ещё одно место, где «11» однажды получит «выпуск».
 * Одиннадцать–четырнадцать берут форму множественного вопреки последней
 * цифре, и мимо этого проходят чаще всего.
 */
function plural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return many;
  const ones = n % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

export const digestsWord = (n: number) => plural(n, "выпуск", "выпуска", "выпусков");
export const newsWord = (n: number) => plural(n, "новость", "новости", "новостей");

export type Headline = { title: string; topic: string };

/**
 * Уведомление о выпуске. Заголовки без ссылок на источники: открытие
 * материала должно происходить в вебе, иначе калибровке неоткуда узнать,
 * что было прочитано, а что пролистано.
 */
export async function notify(
  chatId: number,
  day: string,
  intro: string,
  headlines: Headline[],
  appUrl: string,
): Promise<void> {
  const byTopic = new Map<string, string[]>();
  for (const h of headlines) {
    byTopic.set(h.topic, [...(byTopic.get(h.topic) ?? []), h.title]);
  }

  const body = [...byTopic.entries()]
    .map(([topic, titles]) =>
      [`<b>${escapeHtml(topic)}</b>`, ...titles.map((t) => `· ${escapeHtml(t)}`)].join("\n"),
    )
    .join("\n\n");

  const text = [
    `<b>Выпуск за ${escapeHtml(dayInWords(day))}</b> — ${headlines.length} ${newsWord(headlines.length)}`,
    intro ? escapeHtml(intro) : "",
    body,
    `<a href="${escapeHtml(appUrl)}">Читать</a>`,
  ].filter(Boolean).join("\n\n");

  await sendMessage(chatId, text);
}

export const loginLink = (appUrl: string, token: string) =>
  `${appUrl.replace(/\/$/, "")}/auth?token=${encodeURIComponent(token)}`;
