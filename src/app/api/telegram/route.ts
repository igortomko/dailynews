import { NextResponse, after, type NextRequest } from "next/server";
import { issueLoginToken } from "@/lib/auth";
import {
  answerCallback, askSubscribe, channelHandle, checkSecret, checkSubscription, escapeHtml,
  fetchBio, loginLink, parseUpdate, sendMessage, SECRET_HEADER,
} from "@/lib/telegram";
import {
  ensureReader, markChannelChecked, recordFinished, recordCall, resumeReader, saveSuggestions,
} from "@/lib/readers";
import { addByLink } from "@/lib/sources";
import { rankTopics } from "../../../../pipeline/interests";
import { jevCost } from "../../../../pipeline/cost";
import type { Reader } from "@/lib/types";

/**
 * Вебхук бота. Поллинг здесь невозможен: отдельный постоянный процесс
 * на общей машине заводить нельзя, а два процесса с одним токеном отбирают
 * апдейты друг у друга. Контейнер и так открыт наружу — адрес уже есть.
 *
 * Отвечаем 200 на всё, что прошло проверку секрета, даже когда внутри
 * что-то не вышло: на любой другой код Telegram повторяет апдейт, и один
 * упавший /start превращается в поток повторов.
 */

/**
 * Первое, что человек читает о продукте. Три вещи и ни одной лишней:
 * что это, сколько стоит времени, что делать дальше.
 *
 * Без восклицательных знаков и без «добро пожаловать»: приветствие,
 * которое ничего не сообщает, читатель проматывает вместе со следующей
 * строкой — а в ней как раз то, ради чего он написал.
 */
const PITCH = [
  "Лента читает за тебя блоги, каналы и рассылки, а утром присылает короткий выпуск: только то, что прошло отбор.",
  "",
  "Настройка занимает пару минут — интересы и источники. Дальше лента справляется сама.",
];

/** Приглашение в канал. Причина названа: «подпишись» без неё читается как оброк. */
const gateText = (handle: string) =>
  [...PITCH, "", `Перед входом подпишись на ${escapeHtml(handle)} — там я рассказываю, что в Ленте меняется.`].join("\n");

const welcomeText = (link: string) =>
  [
    ...PITCH,
    "",
    `<a href="${link}">Выбрать интересы</a>`,
    "",
    "Ссылка живёт 10 минут; новую всегда даёт /start.",
  ].join("\n");

const continueText = (link: string) =>
  [
    "Настройка не закончена — без интересов выпуск не из чего собирать.",
    "",
    `<a href="${link}">Продолжить</a>`,
    "",
    "Ссылка живёт 10 минут.",
  ].join("\n");

const feedText = (link: string) => `<a href="${link}">Открыть ленту</a>\n\nСсылка действует 10 минут.`;

/**
 * Гейт стоит на входе, а не над лентой.
 *
 * Читатель, который уже всё настроил, отписавшись от канала, теряет доступ
 * к своей ленте — это наказание за отписку, а не приглашение подписаться.
 * Поэтому спрашиваем один раз, до онбординга, и отметку не снимаем.
 */
const needsGate = (reader: Reader) => !reader.onboarded_at && !reader.channel_checked_at;

/**
 * Узнать, о чём человек, пока он идёт в канал.
 *
 * Один вопрос к Jev на читателя и только при заведении: он решает лишь
 * порядок стартовых интересов на первом экране. Делается после ответа
 * боту — ждать модель, пока Telegram считает секунды до повтора апдейта,
 * значит получить второй /start вместо ранжирования.
 */
async function learnAbout(readerId: number, telegramId: number): Promise<void> {
  const bio = await fetchBio(telegramId);
  if (!bio) return;
  const ranked = await rankTopics(bio);
  await saveSuggestions(readerId, bio, ranked.slugs);
  if (ranked.inputTokens > 0) {
    await recordCall({
      readerId, stage: "interests", model: ranked.model,
      tokensIn: ranked.inputTokens, costUsd: jevCost(ranked.inputTokens),
    });
  }
}

export async function POST(request: NextRequest) {
  if (!checkSecret(request.headers.get(SECRET_HEADER))) {
    return NextResponse.json({ error: "не Telegram" }, { status: 401 });
  }

  let update: unknown;
  try {
    update = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ ok: true });
  }

  const command = parseUpdate(update);
  if (command.kind === "ignore") return NextResponse.json({ ok: true });

  try {
    if (command.kind === "help") {
      await sendMessage(
        command.chatId,
        "Напиши /start — пришлю ссылку на ленту. Пришли ссылку на блог или канал — заведу источник.",
      );
      return NextResponse.json({ ok: true });
    }

    /**
     * Присланная ссылка заводит источник.
     *
     * Разбор ходит в сеть и занимает секунды, а Telegram на медленный ответ
     * повторяет апдейт — и одна ссылка превращается в несколько добавлений
     * и несколько сообщений. Поэтому отвечаем сразу, а работу доделываем
     * после ответа.
     */
    if (command.kind === "link") {
      const { telegramId, chatId, text } = command;
      after(async () => {
        try {
          const reader = await ensureReader(telegramId, null);
          const result = await addByLink(reader, text);
          await sendMessage(
            chatId,
            result.ok
              ? [
                  result.created ? "Добавил в ленту:" : "Этот источник уже был в ленте:",
                  `<b>${escapeHtml(result.found.label)}</b>`,
                  `${escapeHtml(result.found.via)} · свежих ${result.found.fresh} из ${result.found.entries}`,
                ].join("\n")
              : `Не получилось: ${escapeHtml(result.error)}`,
          );
        } catch (error) {
          console.error(`telegram link: ${(error as Error).message}`);
          await sendMessage(chatId, "Не получилось разобрать ссылку — попробуй ещё раз.").catch(() => {});
        }
      });
      await sendMessage(chatId, "Проверяю ссылку…");
      return NextResponse.json({ ok: true });
    }

    if (command.kind === "resume") {
      // Возвращение — это и есть ответ: паузу снимаем сразу, ничего
      // не переспрашивая. Читатель уже сделал единственное нужное движение.
      await resumeReader(command.telegramId, command.afterDays);
      const when = command.afterDays
        ? `Хорошо, вернусь через ${command.afterDays} ${command.afterDays === 7 ? "дней" : "дней"}.`
        : "Вернул. Выпуск придёт следующей ночью.";
      await answerCallback(command.callbackId, command.afterDays ? "Отложил" : "Вернул ленту");
      await sendMessage(command.chatId, when);
      return NextResponse.json({ ok: true });
    }

    if (command.kind === "finished") {
      await recordFinished(command.telegramId, command.itemId, command.finished);
      // Часики на кнопке гасим в любом случае: нажатие, на которое ничего
      // не ответило, читатель повторяет — и второй раз тоже впустую.
      await answerCallback(command.callbackId, command.finished ? "Записал" : "Учту");
      return NextResponse.json({ ok: true });
    }

    const reader = await ensureReader(command.telegramId, command.username);

    // Описание из профиля спрашиваем один раз и только у того, кто ещё
    // не настроился: оно нужно ровно на первом экране.
    if (!reader.onboarded_at && reader.suggested_topics.length === 0 && !reader.bio) {
      after(() => learnAbout(reader.id, command.telegramId).catch(() => {}));
    }

    const handle = channelHandle();
    if (handle && needsGate(reader)) {
      const subscription = await checkSubscription(command.telegramId);

      if (subscription === "no") {
        if (command.kind === "subscribed") {
          // Отдельным сообщением это был бы второй одинаковый экран после
          // каждого нажатия. Ответ на кнопку остаётся там, где её нажали.
          await answerCallback(
            command.callbackId,
            `Пока не вижу подписки на ${handle}. Подпишись и нажми ещё раз.`,
            true,
          );
        } else {
          await askSubscribe(command.chatId, handle, gateText(handle));
        }
        return NextResponse.json({ ok: true });
      }

      if (subscription === "unknown") {
        // «Не смог проверить» — не «ты не подписан»: иначе читатель ищет
        // подписку, которая у него уже есть. Бот не админ канала — ошибка
        // наша, и звучать она должна как наша.
        const text = "Не смог проверить подписку — Telegram не ответил. Попробуй ещё раз через минуту.";
        if (command.kind === "subscribed") await answerCallback(command.callbackId, text, true);
        else await sendMessage(command.chatId, text);
        return NextResponse.json({ ok: true });
      }

      await markChannelChecked(reader.id);
      if (command.kind === "subscribed") await answerCallback(command.callbackId, "Вижу подписку");
    } else if (command.kind === "subscribed") {
      await answerCallback(command.callbackId, "Всё уже открыто");
    }

    // Свой адрес, а не выдуманный: ссылка с чужого домена уводит читателя
    // на чужой сайт, и выглядит это как обычная ссылка бота.
    const appUrl = process.env.APP_URL?.trim() || request.nextUrl.origin;
    const link = loginLink(appUrl, await issueLoginToken(reader.id));

    await sendMessage(
      command.chatId,
      reader.onboarded_at
        ? feedText(link)
        // Прошедший гейт видит приглашение целиком, а вернувшийся на середине
        // настройки — только то, что ему осталось: заново читать, что такое
        // Лента, он не станет.
        : reader.channel_checked_at
          ? continueText(link)
          : welcomeText(link),
    );
  } catch (error) {
    console.error(`telegram webhook: ${(error as Error).message}`);
  }

  return NextResponse.json({ ok: true });
}
