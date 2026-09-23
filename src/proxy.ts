import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

/**
 * Файл обязан лежать в src/, а не в корне: проект использует srcDirectory,
 * и Next ищет proxy рядом с app/. В корне он молча не подключается —
 * страницы отдаются кому угодно, и заметить это по коду нельзя.
 *
 * proxy.ts, а не middleware.ts: в Next 16 конвенция переименована, старое
 * имя предупреждает на каждой сборке и идёт по edge-песочнице; proxy
 * исполняется в обычном Node — на запрос это на пару миллисекунд дешевле.
 *
 * Приложение висит в открытом интернете. Чтение дайджеста само по себе
 * не тайна, а вот запись интересов и событий чтения — да: посторонние
 * события чтения ломают калибровку тише, чем что угодно другое.
 */
// /api/version открыт намеренно: он нужен развёртыванию до входа
// и не отдаёт ничего, кроме хеша коммита.
// /api/telegram и /api/lemon открыты намеренно: их аутентифицирует подпись
// вебхука, а куки ни у Telegram, ни у Lemon Squeezy нет и быть не может.
// Забыть их здесь — значит получить тихий 307 вместо платежа: отправитель
// увидит редирект как успех доставки и больше не повторит.
const PUBLIC = [
  "/login", "/auth", "/api/version", "/api/telegram", "/api/lemon", "/_next", "/favicon.ico", "/brand",
  // Политику и условия читают до входа: ревьюеры Meta, и тот, кто решает, заводиться ли.
  "/privacy", "/terms",
  // Уведомления Threads об отзыве доступа и удалении данных: куки у Meta нет,
  // подлинность решает подпись секретом приложения.
  "/api/threads/",
  // Отписка из письма: приходят и с чужого устройства, а почтовый клиент
  // шлёт её сам, без куки. Подлинность решает подпись в ссылке.
  "/api/unsubscribe",
];

export async function proxy(request: NextRequest) {
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
