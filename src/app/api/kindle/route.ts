import { dictOf } from "@/lib/i18n";
import { after, NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getReader } from "@/lib/readers";
import { queueArticleSend, runArticleSend } from "../../../../pipeline/kindle-article";

/**
 * Отправка статьи на читалку.
 *
 * Ответ уходит сразу, работа — в after(): забрать статью и перевести её
 * целиком это около минуты, и держать всё это время открытым запрос
 * значит потерять отправку, как только читатель закроет вкладку.
 *
 * Отправить можно только то, что было в собственном выпуске. Без этой
 * проверки чужой материал уезжает на читалку по подобранному id, а заодно
 * тратит потолок читателя на то, чего он не просил.
 */
export async function POST(request: NextRequest) {
  const readerId = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  // Язык отказа — язык читателя: ответ этого адреса показывается тостом
  // в ленте как есть, и русская строка в английском интерфейсе выглядела бы
  // не переводом, который забыли, а поломкой.
  const reader = readerId ? await getReader(readerId) : undefined;
  const t = dictOf(reader?.ui_language).errors;

  if (!readerId) {
    return NextResponse.json({ error: t.noSession }, { status: 401 });
  }

  let payload: { item_id?: number };
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: t.badRequest }, { status: 400 });
  }

  const itemId = Number(payload.item_id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ error: t.badRequest }, { status: 400 });
  }

  const [mine] = await sql<{ one: number }[]>`
    select 1 as one
      from dailynews.digest_items di
      join dailynews.digests d on d.id = di.digest_id
     where di.item_id = ${itemId} and d.reader_id = ${readerId}
     limit 1
  `;
  if (!mine) {
    return NextResponse.json({ error: t.itemNotYours }, { status: 404 });
  }

  if (!reader) return NextResponse.json({ error: t.noSession }, { status: 401 });

  const queued = await queueArticleSend(reader, itemId, t);
  if ("error" in queued) {
    return NextResponse.json({ error: queued.error }, { status: 409 });
  }

  after(async () => {
    await runArticleSend(queued.id, reader, itemId);
  });

  return NextResponse.json({ ok: true, send_id: queued.id });
}
