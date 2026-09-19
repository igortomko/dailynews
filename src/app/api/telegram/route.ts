import { NextResponse, type NextRequest } from "next/server";
import { issueLoginToken } from "@/lib/auth";
import { answerCallback, checkSecret, loginLink, parseUpdate, sendMessage, SECRET_HEADER } from "@/lib/telegram";
import { ensureReader, recordFinished } from "@/lib/readers";

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
        ? `<a href="${link}">Открыть ленту</a>\n\nСсылка работает 10 минут.`
        : [
            "Ты в Ленте.",
            "",
            `<a href="${link}">Выбери интересы</a> — без них новости не соберутся.`,
            "Дальше каждое утро я буду присылать сюда ссылку на свежий выпуск.",
            "",
            "Ссылка работает 10 минут, новую даёт /start.",
          ].join("\n"),
    );
  } catch (error) {
    console.error(`telegram webhook: ${(error as Error).message}`);
  }

  return NextResponse.json({ ok: true });
}
