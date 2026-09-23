import { after, NextResponse, type NextRequest } from "next/server";
import { dictOf } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getReader } from "@/lib/readers";
import { effectivePlan } from "@/lib/billing";
import { cheapestFor } from "@/lib/plans";
import { queueAudioSend, runAudioSend } from "../../../../pipeline/tts";

/**
 * Озвучка статьи.
 *
 * Ответ уходит сразу, работа — в after(): перевести статью и синтезировать
 * речь это минуты, и держать всё это время открытым запрос значит потерять
 * озвучку, как только читатель закроет вкладку.
 *
 * Прогресс спрашивается отдельным GET по тому же адресу. Проценты рисовать
 * нечем и незачем: шаги здесь разной длины — перевод минуту, синтез
 * десятки секунд, — и «43%» о них не говорит ничего, а «перевожу» говорит
 * всё.
 *
 * Озвучить можно только то, что было в собственном выпуске. Без этой
 * проверки чужой материал уезжает в Telegram по подобранному id, а заодно
 * тратит квоту читателя на то, чего он не просил.
 */
export async function POST(request: NextRequest) {
  const readerId = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  // Язык отказа — язык читателя: ответ этого адреса показывается тостом
  // в ленте как есть, и русская строка в английском интерфейсе выглядела бы
  // не переводом, который забыли, а поломкой.
  const reader = readerId ? await getReader(readerId) : undefined;
  const t = dictOf(reader?.ui_language).errors;

  if (!readerId) return NextResponse.json({ error: t.noSession }, { status: 401 });

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

  // Тариф считается, а не читается из колонки: в `plan` лежит купленное,
  // а работает ли оно сейчас — решают статус и `plan_ends_at`.
  const plan = effectivePlan(reader);
  const queued = await queueAudioSend(reader, plan, itemId, t, cheapestFor("audio").label);
  if ("error" in queued) {
    return NextResponse.json({ error: queued.error }, { status: 409 });
  }

  after(async () => {
    await runAudioSend(queued.id, reader, itemId);
  });

  return NextResponse.json({ ok: true, send_id: queued.id, seconds: queued.seconds });
}

/**
 * На каком шаге озвучка.
 *
 * Строка читателя, а не просто строка по номеру: без `reader_id` чужой
 * прогресс отдаётся вовремя, без ошибки и совершенно не тот.
 */
export async function GET(request: NextRequest) {
  const readerId = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const reader = readerId ? await getReader(readerId) : undefined;
  const t = dictOf(reader?.ui_language).errors;
  if (!readerId) return NextResponse.json({ error: t.noSession }, { status: 401 });

  // Пачкой, а не по одной: подкаст из десяти карточек иначе означал бы
  // десять запросов каждые две секунды ради десяти слов.
  const many = request.nextUrl.searchParams.get("send_ids");
  if (many) {
    const ids = many.split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length === 0) return NextResponse.json({ error: t.badRequest }, { status: 400 });
    const rows = await sql<
      { id: number; item_id: number; status: string; error: string | null }[]
    >`
      select id, item_id, status, error from dailynews.audio_sends
       where id = any(${ids}) and reader_id = ${readerId}
    `;
    return NextResponse.json({
      sends: rows.map((row) => ({
        id: Number(row.id),
        item_id: Number(row.item_id),
        status: row.status,
        error: row.error,
      })),
    });
  }

  const sendId = Number(request.nextUrl.searchParams.get("send_id"));
  if (!Number.isInteger(sendId) || sendId <= 0) {
    return NextResponse.json({ error: t.badRequest }, { status: 400 });
  }

  const [row] = await sql<{ status: string; error: string | null; seconds: number | null }[]>`
    select status, error, seconds from dailynews.audio_sends
     where id = ${sendId} and reader_id = ${readerId}
  `;
  if (!row) return NextResponse.json({ error: t.audioNotFound }, { status: 404 });

  return NextResponse.json({ status: row.status, error: row.error, seconds: row.seconds });
}
