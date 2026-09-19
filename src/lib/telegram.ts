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
  | { kind: "ignore" };

type Update = {
  message?: {
    text?: unknown;
    chat?: { id?: unknown; type?: unknown };
    from?: { id?: unknown; is_bot?: unknown; username?: unknown };
  };
};

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
    `<b>Дайджест за ${escapeHtml(day)}</b> — ${headlines.length} материалов`,
    intro ? escapeHtml(intro) : "",
    body,
    `<a href="${escapeHtml(appUrl)}">Читать</a>`,
  ].filter(Boolean).join("\n\n");

  await sendMessage(chatId, text);
}

export const loginLink = (appUrl: string, token: string) =>
  `${appUrl.replace(/\/$/, "")}/auth?token=${encodeURIComponent(token)}`;
