import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

/**
 * Файл обязан лежать в src/, а не в корне: проект использует srcDirectory,
 * и Next ищет middleware рядом с app/. В корне он молча не подключается —
 * страницы отдаются кому угодно, и заметить это по коду нельзя.
 *
 * Приложение висит в открытом интернете. Чтение дайджеста само по себе
 * не тайна, а вот запись интересов и событий чтения — да: посторонние
 * события чтения ломают калибровку тише, чем что угодно другое.
 */
const PUBLIC = ["/login", "/_next", "/favicon.ico"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();

  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
