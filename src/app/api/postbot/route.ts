import { NextResponse, after, type NextRequest } from "next/server";
import { checkSecret, escapeHtml, SECRET_HEADER } from "@/lib/telegram";
import { getChannels, getReader, spentToday } from "@/lib/readers";
import { classifyDrop } from "@/lib/drops";
import { dropSourceFor, saveDrafts } from "@/lib/posts";
import { asCard, cardFromVoice } from "../../../../pipeline/voice-card";
import { writePost } from "../../../../pipeline/post";
import { publishedIn, tabsOf } from "@/lib/networks";
import { sql } from "@/lib/db";

/**
 * Второй бот: сюда владелец бросает материал, отсюда получает черновики
 * постов своим голосом.
 *
 * Отдельный токен и отдельный адрес, а не команды в читательском боте:
 * у того бота в чате идёт разговор про выпуски, и «пришли ссылку» там уже
 * значит «заведи источник». Один и тот же текст не может означать две вещи
 * в одном чате, а разводить их командой — значит требовать помнить команду.
 *
 * Отвечаем 200 на всё, что прошло секрет, даже когда внутри не вышло:
 * на любой другой код Telegram повторяет апдейт, и одна упавшая ссылка
 * превращается в поток повторов.
 */

async function send(chatId: number, text: string): Promise<void> {
  const token = process.env.POSTBOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4000),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
    signal: AbortSignal.timeout(30_000),
  }).then((res) => {
    // Молчащая отправка неотличима от «бот сломался»: Telegram отвечает 400
    // на разрубленную по 4000 знаков HTML-сущность, и владелец просто
    // не получает черновики, не узнав почему.
    if (!res.ok) console.error(`postbot send: Telegram HTTP ${res.status}`);
  }).catch((error: unknown) => {
    console.error(`postbot send: ${error instanceof Error ? error.message : error}`);
  });
}

const HELP = [
  "Брось сюда что угодно — отвечу черновиками постов твоим голосом:",
  "",
  "• ссылку на статью — прочитаю и напишу разбор;",
  "• ссылку на ролик — возьму субтитры;",
  "• пересланный пост — отвечу своим взглядом на него;",
  "• просто мысль текстом — разверну в пост.",
  "",
  "После ссылки можно дописать пометку — с какого угла заходить.",
].join("\n");

type Incoming = { chatId: number; telegramId: number; text: string; forwarded: boolean };

/** Из апдейта берётся только то, на что бот отвечает: текст от человека
 *  в личном чате. Остальное — 200 и тишина. */
function parsePost(update: unknown): Incoming | null {
  const message = (update as { message?: Record<string, unknown> })?.message;
  if (!message) return null;
  const chat = message.chat as { id?: unknown; type?: unknown } | undefined;
  const from = message.from as { id?: unknown; is_bot?: unknown } | undefined;
  const text = typeof message.text === "string" ? message.text : "";
  // Только личные чаты. Владелец, написавший боту в группе, остаётся владельцем
  // по from.id — и черновики его голосом ушли бы всем участникам разом.
  if (chat?.type !== "private") return null;
  if (typeof chat?.id !== "number" || typeof from?.id !== "number") return null;
  if (from.is_bot === true || !text.trim()) return null;
  const forwarded = Boolean(message.forward_origin ?? message.forward_from ?? message.forward_from_chat);
  return { chatId: chat.id, telegramId: from.id, text, forwarded };
}

/**
 * Замок на одном номере. Проверка стоит до базы и не зависит от неё:
 * строка владельца — это данные, которые правятся, а `owner` может однажды
 * оказаться не у того. Бот пишет посты под именем хозяина и тратит его
 * деньги, поэтому здесь список из одного номера и никакой логики вокруг.
 *
 * Номер тот же, что уже знает лента (`TELEGRAM_CHAT_ID`, им владелец
 * забирает свою строку в `ensureReader`): вторая переменная с тем же
 * значением однажды разъехалась бы с первой, и замок открылся бы не там.
 *
 * Незаданная переменная означает «никому», а не «всем»: пустое окружение
 * не должно открывать дверь — то же правило, что у секрета вебхука.
 */
function isOwner(telegramId: number): boolean {
  const allowed = Number(process.env.TELEGRAM_CHAT_ID);
  return Number.isSafeInteger(allowed) && allowed > 0 && telegramId === allowed;
}

/**
 * Читатель хозяина: из него берутся карточка голоса, сети и дневной потолок.
 * Второй проверкой после номера, а не вместо неё.
 */
async function ownerBy(telegramId: number): Promise<number | null> {
  const [row] = await sql<{ id: number }[]>`
    select id::int as id from dailynews.readers
     where owner and telegram_id = ${telegramId}
  `;
  return row?.id ?? null;
}

async function reply(incoming: Incoming): Promise<void> {
  if (!isOwner(incoming.telegramId)) return;
  const readerId = await ownerBy(incoming.telegramId);
  if (!readerId) return;

  const body = incoming.text.trim();
  if (body === "/start" || body === "/help") return void (await send(incoming.chatId, HELP));

  const reader = await getReader(readerId);
  if (!reader) return;

  const spent = await spentToday(readerId);
  if (spent >= reader.daily_cap_usd) {
    return void (await send(incoming.chatId, `Дневной потолок $${reader.daily_cap_usd} исчерпан — завтра.`));
  }

  const drop = classifyDrop(body, incoming.forwarded);
  if (!drop) return;

  const channels = await getChannels(readerId);
  const networks = tabsOf(publishedIn(channels));
  if (networks.length === 0) {
    return void (await send(incoming.chatId, "Сначала отметь в настройках, где ты публикуешь."));
  }

  const waiting = {
    link: "Читаю статью…",
    video: "Снимаю субтитры…",
    post: "Читаю пост…",
    thought: "Разворачиваю мысль…",
  }[drop.kind];
  await send(incoming.chatId, waiting);

  let source: Awaited<ReturnType<typeof dropSourceFor>>;
  try {
    source = await dropSourceFor(drop);
  } catch (error) {
    return void (await send(
      incoming.chatId,
      escapeHtml(error instanceof Error ? error.message : "не вышло достать текст"),
    ));
  }

  const card = asCard(reader.voice_card) ?? cardFromVoice({
    language: reader.language,
    complexity: reader.complexity,
    style: reader.style,
  });

  try {
    const written = await writePost(source, card, networks.map((network) => network.id), reader.id);
    await saveDrafts(readerId, source.id, written.drafts);

    for (const draft of written.drafts) {
      const warning = draft.unverified.length
        ? `\n\n⚠️ Чисел нет в материале: ${escapeHtml(draft.unverified.join(", "))}`
        : "";
      const over = draft.over ? "\n\n⚠️ Длиннее лимита сети" : "";
      await send(
        incoming.chatId,
        `<b>${escapeHtml(draft.network)} · вариант ${draft.variant}</b>\n\n` +
          `${escapeHtml(draft.text)}${warning}${over}`,
      );
    }
    if (card.built_from === 0) {
      await send(incoming.chatId, "Карточки голоса нет — писал настройками подачи, не твоим голосом.");
    }
  } catch (error) {
    await send(incoming.chatId, escapeHtml(error instanceof Error ? error.message : "не написалось"));
  }
}

export async function POST(request: NextRequest) {
  // Свой секрет, а не читательский: два бота — два токена и два секрета,
  // иначе утёкший секрет открывает оба.
  if (!checkSecret(request.headers.get(SECRET_HEADER), "POSTBOT_WEBHOOK_SECRET")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const incoming = parsePost(await request.json().catch(() => null));
  // Ответ Telegram уходит сразу: чтение статьи и письмо поста занимают
  // десятки секунд, а он повторяет апдейт, не дождавшись ответа.
  // Ответ Telegram уже ушёл, поэтому отказ до внутреннего try (база, читатель,
  // потолок) больше некому поймать: без этого он станет unhandled rejection.
  if (incoming) {
    after(() => reply(incoming).catch((error: unknown) => {
      console.error(`postbot: ${error instanceof Error ? error.message : error}`);
    }));
  }
  return NextResponse.json({ ok: true });
}
