import { NextResponse, type NextRequest } from "next/server";
import { issueSession, verifyLoginToken } from "@/lib/auth";

/**
 * Приземление magic link. Токен подписан и живёт десять минут; проверив его,
 * ставим обычную сессионную куку и сразу уводим с адреса, чтобы токен
 * не остался в истории браузера.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const home = new URL("/", request.nextUrl.origin);

  if (!(await verifyLoginToken(token))) {
    const login = new URL("/login", request.nextUrl.origin);
    login.searchParams.set("expired", "1");
    return NextResponse.redirect(login);
  }

  const session = await issueSession();
  const response = NextResponse.redirect(home);
  response.cookies.set(session.name, session.value, session.options);
  return response;
}
