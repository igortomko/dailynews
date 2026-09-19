import { NextResponse, after, type NextRequest } from "next/server";
import { issueLoginToken } from "@/lib/auth";
import { answerCallback, checkSecret, escapeHtml, loginLink, parseUpdate, sendMessage, SECRET_HEADER } from "@/lib/telegram";
import { ensureReader, recordFinished, resumeReader } from "@/lib/readers";
import { addByLink } from "@/lib/sources";

/**
 * Вебхук бота. Поллинг здесь невозможен: отдельный постоянный процесс
 * на общей машине заводить нельзя, а два процесса с одним токеном отбирают
 * апдейты друг у друга. Контейнер и так открыт наружу — адрес уже есть.
 *
 * Отвечаем 200 на всё, что прошло проверку секрета, даже когда внутри
 * что-то не вышло: на любой другой код Telegram повторяет апдейт, и один
 * упавший /start превращается в поток повторов.
 */
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
      await sendMessage(command.chatId, "Напиши /start — пришлю ссылку на ленту.");
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
    // Свой адрес, а не выдуманный: ссылка с чужого домена уводит читателя
    // на чужой сайт, и выглядит это как обычная ссылка бота.
    const appUrl = process.env.APP_URL?.trim() || request.nextUrl.origin;
    const link = loginLink(appUrl, await issueLoginToken(reader.id));

    await sendMessage(
      command.chatId,
      reader.onboarded_at
        ? `<a href="${link}">Открыть ленту</a>\n\nСсылка действует 10 минут.`
        : [
            "Завёл тебя в Ленте.",
            `<a href="${link}">Выбери интересы</a> — без них выпуск не собирается,`,
            "и каждое утро сюда будет приходить ссылка на свежий.",
            "",
            "Ссылка действует 10 минут; новую всегда даёт /start.",
          ].join("\n"),
    );
  } catch (error) {
    console.error(`telegram webhook: ${(error as Error).message}`);
  }

  return NextResponse.json({ ok: true });
}
