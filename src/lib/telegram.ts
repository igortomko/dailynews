import { equal } from "./auth";
import { localeOf, type Locale } from "./i18n/locale";
import { formatMinutesLong, isShort, shortfallNote } from "./reading-time";

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

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Адрес вебхука открыт всему интернету: кто угодно может прислать туда
 * «/start от читателя номер такой-то». Единственное, что отличает Telegram
 * от постороннего, — этот заголовок.
 *
 * Без заданного секрета проверка отвечает «нет», а не «да»: незаполненная
 * переменная не должна открывать дверь.
 *
 * Ботов два, и секрет у каждого свой, поэтому имя переменной — аргумент.
 * Вторая копия этой же проверки рядом разъехалась бы с первой незаметно,
 * а расходится здесь ровно один сравниваемый байт.
 */
export function checkSecret(header: string | null, envName = "TELEGRAM_WEBHOOK_SECRET"): boolean {
  const expected = process.env[envName];
  if (!expected || !header) return false;
  return equal(header, expected);
}

export type BotCommand =
  | { kind: "start"; telegramId: number; chatId: number; username: string | null; locale: Locale }
  | { kind: "help"; chatId: number }
  /** Присланная ссылка: бот заводит по ней источник, как форма в вебе. */
  | { kind: "link"; telegramId: number; chatId: number; text: string; locale: Locale }
  /** Ответ на «дочитал?»: единственный сигнал о том, что уехало на читалку. */
  | { kind: "finished"; telegramId: number; itemId: number; finished: boolean; callbackId: string }
  /** Нажал «продолжать» под вопросом спящему: лента включается обратно. */
  | { kind: "resume"; telegramId: number; chatId: number; afterDays: number; callbackId: string }
  /** Нажал «Я подписался» под гейтом: проверяем подписку заново. */
  | { kind: "subscribed"; telegramId: number; chatId: number; username: string | null; locale: Locale; callbackId: string }
  | { kind: "ignore" };

type Update = {
  message?: {
    text?: unknown;
    chat?: { id?: unknown; type?: unknown };
    from?: { id?: unknown; is_bot?: unknown; username?: unknown; language_code?: unknown };
  };
  callback_query?: {
    id?: unknown;
    data?: unknown;
    from?: { id?: unknown; is_bot?: unknown; username?: unknown; language_code?: unknown };
    message?: { chat?: { id?: unknown } };
  };
};

/** Полезная нагрузка кнопки «дочитал». Telegram даёт под неё 64 байта,
 *  поэтому id материала, а не заголовок. */
export const FINISHED_PREFIX = "fin";
/** Ответ на «продолжать?» у спящего читателя. */
export const RESUME_PREFIX = "res";
/** «Я подписался» под предложением подписаться на канал. */
export const SUBSCRIBED_PREFIX = "sub";

/**
 * Язык интерфейса, как его называет Telegram.
 *
 * `language_code` приходит в каждом апдейте и выглядит как «ru», «ru-RU»,
 * «en-US». Берём первую часть: страна нам ни о чём не говорит, а список
 * словарей короткий, и незнакомое значение `localeOf` уже сводит
 * к языку по умолчанию.
 *
 * Без этого каждый новый читатель получал английский интерфейс независимо
 * от того, на каком языке он написал боту: ошибки нет, экран открывается,
 * просто не на его языке.
 */
export const localeFromTelegram = (code: unknown): Locale =>
  localeOf(typeof code === "string" ? code.split("-")[0].toLowerCase() : undefined);

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
    if (isId(from) && callback.from?.is_bot !== true && id && parts[0] === SUBSCRIBED_PREFIX) {
      const chat = callback.message?.chat?.id;
      const username = typeof callback.from?.username === "string" ? callback.from.username : null;
      return {
        kind: "subscribed",
        telegramId: from,
        chatId: isId(chat) ? chat : from,
        username,
        locale: localeFromTelegram(callback.from?.language_code),
        callbackId: id,
      };
    }
    if (isId(from) && callback.from?.is_bot !== true && id && parts[0] === RESUME_PREFIX) {
      // chat_id берём из сообщения с кнопкой: у спящего читателя переписка
      // та же, но полагаться на равенство telegram_id и chat_id нельзя.
      const chat = callback.message?.chat?.id;
      // Ноль — «продолжить сейчас», остальное — отпуск на столько дней.
      const afterDays = /^\d+$/.test(parts[1] ?? "") ? Math.min(60, Number(parts[1])) : 0;
      return {
        kind: "resume",
        telegramId: from,
        chatId: isId(chat) ? chat : from,
        afterDays,
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
    return {
      kind: "start", telegramId, chatId, username,
      locale: localeFromTelegram(message.from?.language_code),
    };
  }
  // Прислали ссылку — значит, хотят завести источник. Это тот же жест,
  // что и вставить её в форму, и отвечать на него подсказкой «напиши /start»
  // значит делать вид, что не понял.
  // Язык нужен и здесь: у читателя, чьё первое сообщение — ссылка, строка
  // заводится этой веткой, а upsert при следующем /start язык уже не трогает
  // (и правильно делает: там мог быть выбор из настроек).
  if (looksLikeSource(text)) {
    return {
      kind: "link", telegramId, chatId, text,
      locale: localeFromTelegram(message.from?.language_code),
    };
  }

  return text ? { kind: "help", chatId } : { kind: "ignore" };
}

/**
 * Похоже ли сообщение на источник.
 *
 * Грубо и нарочно: решать, что это за источник, — дело planFor, а здесь
 * нужно только отличить ссылку от разговора, не ходя при этом в сеть.
 * Поисковые запросы X сюда не попадают: в них пробелы, и в переписке
 * «uranium OR SMR» неотличимо от фразы.
 */
export function looksLikeSource(text: string): boolean {
  const value = text.trim();
  if (!value || /\s/.test(value) || value.startsWith("/")) return false;
  return value.includes("://") || value.startsWith("@") || /[^\s@]+\.[^\s@]{2,}/.test(value);
}

async function call<T = unknown>(method: string, body: object): Promise<T> {
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
  // Отправляющим методам ответ не нужен, а спрашивающим — только он.
  // Разводить их на два клиента незачем: различается одна строка.
  return ((await res.json()) as { result: T }).result;
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
 * Отправить озвучку.
 *
 * Telegram здесь и хранилище, и плеер: своего хранилища у продукта нет,
 * а заводить его ради mp3 дороже, чем не заводить. Первая отправка льёт
 * файл и возвращает `file_id`; по нему та же статья уходит второму
 * читателю мгновенно и не весит ни байта трафика.
 *
 * Заливка идёт multipart, а пересылка по `file_id` — обычным JSON: это
 * два разных запроса к одному методу, и различает их тип аргумента,
 * а не флаг.
 */
export async function sendAudio(
  chatId: number,
  audio: Buffer | string,
  meta: { title: string; duration?: number; caption?: string },
): Promise<{ fileId: string; messageId: number }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");

  const fields: Record<string, string> = {
    chat_id: String(chatId),
    // Telegram режет заголовок сам, но молча: длинное имя приедет
    // обрезанным без следа в ответе.
    title: meta.title.slice(0, 120),
    performer: "Retorta",
  };
  if (meta.duration) fields.duration = String(Math.round(meta.duration));
  if (meta.caption) {
    fields.caption = meta.caption.slice(0, 1000);
    fields.parse_mode = "HTML";
  }

  let res: Response;
  if (typeof audio === "string") {
    res = await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...fields, audio }),
      signal: AbortSignal.timeout(60_000),
    });
  } else {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append(
      "audio",
      new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }),
      `${slugOf(meta.title)}.mp3`,
    );
    res = await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
      method: "POST",
      body: form,
      // Заливка пяти мегабайт с общей машины бывает и минутой.
      signal: AbortSignal.timeout(180_000),
    });
  }

  if (!res.ok) {
    throw new Error(`Telegram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: { message_id: number; audio?: { file_id: string } };
  };
  // `ok: false` приезжает с кодом 200, и без этой проверки отказ Telegram
  // выглядел бы как успешная отправка с пустым file_id.
  if (!body.ok || !body.result?.audio?.file_id) {
    throw new Error(`Telegram отказал: ${body.description ?? "нет file_id в ответе"}`);
  }
  return { fileId: body.result.audio.file_id, messageId: body.result.message_id };
}

/** Имя файла для Telegram: кириллицу он принимает, а служебные знаки — нет. */
const slugOf = (title: string) =>
  title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "audio";

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
 * Вопрос спящему читателю.
 *
 * Ответ одной кнопкой: спросить «продолжать?» и заставить искать сайт —
 * это способ не получить ответа. Молчание тоже ответ, и оно бесплатное:
 * пока кнопку не нажали, выпуск не пишется.
 */
export async function askResume(chatId: number, silentDays: number): Promise<void> {
  await call("sendMessage", {
    chat_id: chatId,
    text:
      `Ты не открывал ленту ${silentDays} ${plural(silentDays, "день", "дня", "дней")} — ` +
      "я поставил её на паузу, " +
      "чтобы не копить непрочитанное.\n\nВернуть?",
    reply_markup: {
      // Отпуск — это не уход. Читатель, которому сейчас не до новостей,
      // без этих кнопок отвечает молчанием, и лента не возвращается вовсе.
      inline_keyboard: [
        [{ text: "Продолжить", callback_data: `${RESUME_PREFIX}:0` }],
        [
          { text: "Через неделю", callback_data: `${RESUME_PREFIX}:7` },
          { text: "Через две", callback_data: `${RESUME_PREFIX}:14` },
        ],
      ],
    },
  });
}

/**
 * Погасить часики на кнопке. Без этого Telegram крутит их секунд тридцать,
 * и нажатие выглядит как потерянное — притом что ответ уже записан.
 */
export async function answerCallback(
  callbackId: string,
  text: string,
  alert = false,
): Promise<void> {
  // Всплывашка живёт секунду и не оставляет следа. Для «записал» этого
  // хватает, а для «подписки не вижу» — нет: читатель нажал и ждёт ответа,
  // и пропущенный ответ он прочитает как сломанную кнопку.
  await call("answerCallbackQuery", { callback_query_id: callbackId, text, show_alert: alert });
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
  /**
   * Заказано и вышло. Обещание выпуска — время, а не число карточек:
   * «40 новостей» не отвечает на вопрос, который задают перед чтением.
   */
  reading: { minutes: number; target: number },
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

  // Недобор называется вслух, а не заметается добором слабого материала:
  // короткий выпуск без объяснения читается как поломка отбора.
  const size = isShort(reading.minutes, reading.target)
    ? shortfallNote(reading.minutes, reading.target)
    : formatMinutesLong(reading.minutes);

  const text = [
    `<b>Выпуск за ${escapeHtml(dayInWords(day))}</b> — ${escapeHtml(size)}`,
    intro ? escapeHtml(intro) : "",
    body,
    `<a href="${escapeHtml(appUrl)}">Читать</a>`,
  ].filter(Boolean).join("\n\n");

  await sendMessage(chatId, text);
}

export const loginLink = (appUrl: string, token: string) =>
  `${appUrl.replace(/\/$/, "")}/auth?token=${encodeURIComponent(token)}`;

/**
 * Канал, на который зовём перед входом. Пусто — гейта нет вовсе.
 *
 * Не задано значит «пускаем», а не «не пускаем»: здесь переменная —
 * не секрет, а настройка роста. Первый же деплой без неё закрыл бы вход
 * всем новым читателям, и выглядело бы это как поломка бота.
 */
export function channelHandle(): string | null {
  const raw = process.env.TELEGRAM_CHANNEL?.trim();
  if (!raw) return null;
  // Принимаем и @имя, и t.me/имя, и голое имя: в переменную окружения
  // рано или поздно вставят то, что скопировали из адресной строки.
  const name = raw
    // Протокол необязателен: из адресной строки копируют и «t.me/имя».
    // С обязательным `https://` такая строка проходила мимо замены целиком
    // и превращалась в «@t.me/имя» — getChatMember отвечал 400, проверка
    // на каждый запрос возвращала «не знаю», и гейт застревал навсегда
    // на «не смог проверить подписку».
    .replace(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\//i, "")
    .replace(/^@/, "")
    .replace(/\/$/, "");
  return name ? `@${name}` : null;
}

export const channelLink = (handle: string) => `https://t.me/${handle.replace(/^@/, "")}`;

/** Три ответа на «подписан?». «Не знаю» — не «да»: см. verdictOf. */
export type Subscription = "yes" | "no" | "unknown";

/**
 * Что значит статус участника.
 *
 * Чистая функция: у неё есть проверка, а у живого канала — только владелец
 * с его собственной подпиской, на которой все четыре ветки не различить.
 *
 * `restricted` — это ограниченный участник: он в канале, пока is_member.
 * `left` и `kicked` — нет. Незнакомый статус читается как «нет»: Telegram
 * заводит новые, и гадать в пользу входа значит открыть его тихой ошибкой.
 */
export function verdictOf(member: { status?: unknown; is_member?: unknown } | null): Subscription {
  const status = typeof member?.status === "string" ? member.status : "";
  if (status === "creator" || status === "administrator" || status === "member") return "yes";
  if (status === "restricted") return member?.is_member === true ? "yes" : "no";
  return "no";
}

/**
 * Подписан ли читатель на канал.
 *
 * Требует, чтобы бот был администратором канала: иначе getChatMember
 * отвечает отказом, и отличить «не подписан» от «бот не админ» снаружи
 * нечем. Поэтому ошибка — это «unknown», а не «no»: читателю в этом случае
 * говорится «не смог проверить», а не «ты не подписан», и он не ищет
 * подписку, которая у него уже есть.
 */
export async function checkSubscription(telegramId: number): Promise<Subscription> {
  const handle = channelHandle();
  if (!handle) return "yes";
  try {
    return verdictOf(
      await call<{ status?: string; is_member?: boolean }>("getChatMember", {
        chat_id: handle,
        user_id: telegramId,
      }),
    );
  } catch (error) {
    console.error(`getChatMember: ${(error as Error).message}`);
    return "unknown";
  }
}

/**
 * Описание из профиля Telegram. Уходит в один вопрос Jev: какие из готовых
 * интересов этому человеку ближе. Пусто — вопрос не задаётся вовсе.
 *
 * Ошибка здесь ничего не ломает: порядок интересов станет обычным.
 * Свалиться на ней значило бы не пустить читателя в ленту из-за строчки,
 * которой он, возможно, и не писал.
 */
export async function fetchBio(telegramId: number): Promise<string | null> {
  try {
    const chat = await call<{ bio?: string; first_name?: string; last_name?: string }>("getChat", {
      chat_id: telegramId,
    });
    const bio = typeof chat?.bio === "string" ? chat.bio.trim() : "";
    return bio ? bio.slice(0, 500) : null;
  } catch (error) {
    console.error(`getChat: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Позвать в канал.
 *
 * Две кнопки, а не одна: ссылка уводит в канал, и вернуться к боту, чтобы
 * сказать «готово», читателю нечем — переписка уже уехала вверх. Кнопка
 * «Я подписался» остаётся на экране и там, куда он вернётся.
 */
export async function askSubscribe(chatId: number, handle: string, intro: string): Promise<void> {
  await call("sendMessage", {
    chat_id: chatId,
    text: intro.slice(0, 4000),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [
        [{ text: `Открыть ${handle}`, url: channelLink(handle) }],
        [{ text: "Я подписался", callback_data: `${SUBSCRIBED_PREFIX}:1` }],
      ],
    },
  });
}
