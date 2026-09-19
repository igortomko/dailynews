import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, issueSession, verifyLoginToken } from "@/lib/auth";

/**
 * Приземление ссылки из бота. Токен подписан, живёт десять минут и несёт
 * номер читателя: сессия ставится тому, кому бот эту ссылку прислал,
 * а не тому, кто открыл адрес. Сразу уводим с адреса, чтобы токен
 * не остался в истории браузера.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const readerId = await verifyLoginToken(token);

  // Тот же адрес, которым бот собирает саму ссылку: вход и приземление
  // обязаны совпадать. Отказ здесь выглядел как успех в самой неприятной
  // форме — кука ставится, переход выполняется, страница не открывается.
  const appUrl = appOrigin(request.nextUrl.origin);

  if (!readerId) {
    const login = new URL("/login", appUrl);
    login.searchParams.set("expired", "1");
    return NextResponse.redirect(login);
  }

  const session = await issueSession(readerId);
  const response = NextResponse.redirect(new URL("/", appUrl));
  response.cookies.set(session.name, session.value, session.options);
  return response;
}
