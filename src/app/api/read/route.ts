import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

const EVENTS = new Set(["seen", "opened", "dwell", "outbound", "dismissed", "up", "down"]);

/**
 * Единственный сигнал калибровки. Пишется из браузера, а не из Telegram:
 * там пролистывание неотличимо от чтения, и любая статистика оттуда
 * завышена ровно на ту долю, которую читатель проматывает.
 *
 * score_snap и conf_snap — снимок на момент чтения: веса потом изменятся,
 * а сравнивать надо с тем, что было показано. Скор берётся из выпуска
 * этого читателя: у того же материала у соседа он другой.
 *
 * Запись идёт select-ом из собственного выпуска, а не значениями из тела
 * запроса. Поэтому событие о чужом материале не запишется вовсе: чужие
 * события чтения ломают калибровку тише, чем что угодно другое.
 */
export async function POST(request: NextRequest) {
  const readerId = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!readerId) {
    return NextResponse.json({ error: "нет сессии" }, { status: 401 });
  }

  let payload: { item_id?: number; event?: string; dwell_ms?: number };
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: "не JSON" }, { status: 400 });
  }

  const itemId = Number(payload.item_id);
  const event = String(payload.event ?? "");
  if (!Number.isInteger(itemId) || !EVENTS.has(event)) {
    return NextResponse.json({ error: "плохие поля" }, { status: 400 });
  }

  const dwell = Number.isFinite(payload.dwell_ms) ? Math.min(3_600_000, Math.max(0, Number(payload.dwell_ms))) : null;

  await sql`
    insert into dailynews.reads (reader_id, item_id, event, dwell_ms, score_snap, conf_snap)
    select ${readerId}, ${itemId}, ${event}, ${dwell}, di.total, sc.confidence
      from dailynews.digest_items di
      join dailynews.digests d on d.id = di.digest_id
      join dailynews.scores sc on sc.item_id = di.item_id
     where di.item_id = ${itemId} and d.reader_id = ${readerId}
     order by d.day desc
     limit 1
  `;
  return NextResponse.json({ ok: true });
}
