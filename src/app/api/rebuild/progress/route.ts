import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { progressOf } from "@/lib/rebuild-progress";

/** Ход догрузки для тоста: см. `src/lib/rebuild-progress.ts`. Только свой. */
export async function GET(request: NextRequest) {
  const readerId = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!readerId) return NextResponse.json({ error: "нет сессии" }, { status: 401 });
  return NextResponse.json(progressOf(readerId), { headers: { "cache-control": "no-store" } });
}
