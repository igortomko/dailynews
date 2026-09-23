import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, issueSession } from "./auth";
import { localeOf } from "./i18n/locale";
import { ensureEmailReader } from "./readers";

/**
 * Приземление входа по почте — общее у ссылки из письма и у Google:
 * оба приходят с уже подтверждённым адресом, и дальше им делать одно
 * и то же. Две копии разошлись бы на первой правке.
 *
 * Язык интерфейса — из `Accept-Language`, и только при заведении строки,
 * как `language_code` у Telegram.
 */
export async function landByEmail(request: NextRequest, email: string | null): Promise<NextResponse> {
  const appUrl = appOrigin(request.nextUrl.origin);
  if (!email) {
    const login = new URL("/login", appUrl);
    login.searchParams.set("expired", "1");
    return NextResponse.redirect(login);
  }
  const lang = request.headers.get("accept-language")?.split(/[-,;]/)[0].trim().toLowerCase();
  const reader = await ensureEmailReader(email, localeOf(lang));
  const session = await issueSession(reader.id);
  const response = NextResponse.redirect(new URL("/", appUrl));
  response.cookies.set(session.name, session.value, session.options);
  return response;
}
