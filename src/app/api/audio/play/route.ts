import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { audioUrl } from "@/lib/telegram";

/**
 * Поток готовой озвучки для плеера на странице.
 *
 * Аудио лежит в Telegram, и адрес скачивания несёт токен бота — отдать
 * его браузеру значит отдать бота. Поэтому страница просит наш адрес,
 * а мы переливаем ответ.
 *
 * Строка ищется по читателю, а не только по номеру: без `reader_id`
 * чужая озвучка играет вовремя, без ошибки и совершенно не та.
 */
export async function GET(request: NextRequest) {
  const readerId = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!readerId) return new NextResponse(null, { status: 401 });

  const itemId = Number(request.nextUrl.searchParams.get("item_id"));
  if (!Number.isInteger(itemId) || itemId <= 0) return new NextResponse(null, { status: 400 });

  const [row] = await sql<{ file_id: string }[]>`
    select ca.file_id
      from dailynews.card_audio ca
      join dailynews.digests d on d.id = ca.digest_id
     where ca.item_id = ${itemId} and d.reader_id = ${readerId}
     order by d.day desc
     limit 1
  `;
  if (!row) return new NextResponse(null, { status: 404 });

  const upstream = await fetch(await audioUrl(row.file_id), {
    // Диапазон передаётся как есть: без него перемотка в плеере
    // скачивает файл заново с начала на каждый рывок ползунка.
    headers: request.headers.get("range") ? { range: request.headers.get("range")! } : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  if (!upstream.ok || !upstream.body) return new NextResponse(null, { status: 502 });

  const headers = new Headers({ "content-type": "audio/mpeg", "accept-ranges": "bytes" });
  for (const name of ["content-length", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Приватный кэш: это озвучка описания, написанного для одного человека.
  headers.set("cache-control", "private, max-age=3600");
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
