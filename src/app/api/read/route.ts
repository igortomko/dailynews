import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

const EVENTS = new Set(["seen", "opened", "dwell", "outbound", "dismissed"]);

/**
 * Единственный сигнал калибровки. Пишется из браузера, а не из Telegram:
 * там пролистывание неотличимо от чтения, и любая статистика оттуда
 * завышена ровно на ту долю, которую читатель проматывает.
 *
 * score_snap и conf_snap — снимок на момент чтения: веса потом изменятся,
 * а сравнивать надо с тем, что было показано.
 */
export async function POST(request: NextRequest) {
  if (!(await verifySession(request.cookies.get(SESSION_COOKIE)?.value))) {
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
    insert into dailynews.reads (item_id, event, dwell_ms, score_snap, conf_snap)
    select ${itemId}, ${event}, ${dwell}, sc.total, sc.confidence
      from dailynews.scores sc
     where sc.item_id = ${itemId}
  `;
  return NextResponse.json({ ok: true });
}
