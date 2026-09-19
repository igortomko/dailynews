import { NextResponse, type NextRequest } from "next/server";
import { issueLoginToken } from "@/lib/auth";
import { ensureReader } from "@/lib/readers";
import { checkSecret, loginLink, parseUpdate, sendMessage, SECRET_HEADER } from "@/lib/telegram";

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
