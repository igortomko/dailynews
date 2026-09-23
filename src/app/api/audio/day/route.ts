import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { audioUrl } from "@/lib/telegram";
import { isDay } from "@/lib/day";

/**
 * Подкаст выпуска — ссылка «Слушать» из письма.
 *
 * Файл лежит в Telegram частями до 19 МБ (предел скачивания Bot API),
 * и отдаётся склеенным: кадры mp3 стыкуются встык. Адрес Telegram несёт
 * токен бота, поэтому браузеру отдаётся наш адрес, а не его.
 *
 * Перемотка работает у записи из одной части — Range передаётся как есть;
 * у многочастной отдаётся поток целиком.
 * ponytail: многочастная без Range — перемотка скачивает заново; нужна
 * будет — считать смещение по длинам частей.
 */
export async function GET(request: NextRequest) {
  const readerId = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!readerId) return new NextResponse(null, { status: 401 });
  const day = request.nextUrl.searchParams.get("day") ?? "";
  if (!isDay(day)) return new NextResponse(null, { status: 400 });

  // По читателю, а не только по дню: без reader_id чужой подкаст играл бы
  // вовремя, без ошибки и совершенно не тот.
  const [row] = await sql<{ file_ids: string[] }[]>`
    select pa.file_ids
      from dailynews.podcast_audio pa
      join dailynews.digests d on d.id = pa.digest_id
     where d.reader_id = ${readerId} and d.day = ${day}::date
  `;
  if (!row || row.file_ids.length === 0) return new NextResponse(null, { status: 404 });

  const headers = new Headers({ "content-type": "audio/mpeg", "cache-control": "private, max-age=3600" });
  if (row.file_ids.length === 1) {
    const range = request.headers.get("range");
    const upstream = await fetch(await audioUrl(row.file_ids[0]), {
      headers: range ? { range } : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (!upstream.ok || !upstream.body) return new NextResponse(null, { status: 502 });
    headers.set("accept-ranges", "bytes");
    for (const name of ["content-length", "content-range"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  }

  const fileIds = row.file_ids;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const fileId of fileIds) {
          const upstream = await fetch(await audioUrl(fileId), { signal: AbortSignal.timeout(120_000) });
          if (!upstream.ok || !upstream.body) throw new Error(`часть не скачалась: ${upstream.status}`);
          const reader = upstream.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new NextResponse(stream, { headers });
}
