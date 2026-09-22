import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { iconHref } from "@/lib/favicon";

/**
 * Значок чужого сайта — нашими руками, а не браузером читателя.
 *
 * До этого `<img src="https://чужой-домен/favicon.ico">` стоял прямо
 * в разметке, и это не работало дважды.
 *
 * **Оно не показывало значок.** Замер 22 сентября 2026 на стартовом наборе:
 * у nngroup.com `/favicon.ico` отдаёт 404, у arstechnica.com — 405 на любой
 * путь, psypost.org и news.crunchbase.com отвечают 200 с нулём байт,
 * а uxdesign.cc отдаёт валидный ico, которого браузер всё равно не получает:
 * бот-защита смотрит на кросс-сайтовый `Referer`. Из шести проблемных
 * хостов ни один не чинится угадыванием второго пути — `/apple-touch-icon.png`
 * у трёх из них тоже пустой или запрещённый. Значок объявляет сама страница
 * (`<link rel="icon">`), и узнать его можно только прочитав её.
 *
 * **И оно раздавало читателя.** Семнадцать строк списка — семнадцать
 * запросов с его адреса на семнадцать чужих доменов при каждом показе
 * страницы, то есть его IP и его список чтения уезжали ровно тем, кого
 * он читает. Наш сервер ходит один на всех и никому не говорит, чей это
 * список, — это та же причина, по которой значок не берётся у s2/favicons.
 *
 * Вход — только свой читатель: адрес открыт всему интернету, и без сессии
 * это был бы бесплатный сканер чужих сайтов под нашим адресом.
 */

/** Сколько ждать чужой сайт. Значок не стоит того, чтобы держать запрос. */
const TIMEOUT_MS = 6000;
/** Больше этого значок не бывает; всё крупнее — не значок, а страница. */
const MAX_BYTES = 256 * 1024;
/**
 * Сутки в браузере и неделя на грани: значок меняется раз в годы,
 * а каждый промах стоит двух запросов к чужому сайту.
 */
const CACHE = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800";

/**
 * Свой сайт под чужим адресом. Хост приходит из запроса, поэтому проверяется
 * он, а не наши намерения: без этого адрес становится чужими руками внутри
 * нашей сети — `?host=localhost:3000` или адрес пулера базы.
 */
function publicHost(host: string): boolean {
  if (!host || host.length > 253 || /[^a-z0-9.\-:]/i.test(host)) return false;
  const name = host.split(":")[0].toLowerCase();
  if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".internal")) return false;
  // Голый адрес вместо имени: у настоящего сайта есть имя, а IP в параметре
  // означает попытку дотянуться до соседа по сети.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.includes("[")) return false;
  return name.includes(".");
}

/** Картинка ли это на самом деле, а не страница с ошибкой под видом значка. */
const isImage = (type: string | null, size: number) =>
  size > 0 && size <= MAX_BYTES && Boolean(type) && type!.startsWith("image/");

async function grab(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      // Браузерный заголовок, но без `Referer`: бот-защита у половины
      // проблемных хостов срабатывает именно на кросс-сайтовую ссылку.
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; Reporta/1.0; +https://news.tomko.io)",
        accept: "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const readerId = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!readerId) return new NextResponse(null, { status: 401 });

  const host = request.nextUrl.searchParams.get("host") ?? "";
  if (!publicHost(host)) return new NextResponse(null, { status: 400 });

  // Сначала дешёвый путь: он есть у большинства и не требует читать страницу.
  let found = await grab(`https://${host}/favicon.ico`);
  let body = found ? await found.arrayBuffer() : null;

  if (!found || !isImage(found.headers.get("content-type"), body?.byteLength ?? 0)) {
    // Значок объявляет страница. Читаем её и берём объявленный адрес —
    // это единственный способ узнать имя с хэшем внутри (`favicon.a1b2c3.png`)
    // и единственный, который работает у тех, кто `/favicon.ico` не держит.
    const page = await grab(`https://${host}/`);
    const href = page ? iconHref(await page.text(), page.url) : null;
    found = href ? await grab(href) : null;
    body = found ? await found.arrayBuffer() : null;
  }

  const type = found?.headers.get("content-type") ?? null;
  // Нечего показать — так и говорим: 204, а не битая картинка. Клиент
  // рисует глобус, и делает это по ответу, а не по догадке.
  if (!found || !body || !isImage(type, body.byteLength)) {
    return new NextResponse(null, { status: 204, headers: { "cache-control": CACHE } });
  }

  return new NextResponse(body, {
    headers: { "content-type": type!, "cache-control": CACHE },
  });
}
