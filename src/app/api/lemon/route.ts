import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { readEvent, signatureValid } from "@/lib/lemon";

/**
 * Вебхук Lemon Squeezy: единственный путь, которым тариф меняется.
 *
 * Читателю тариф не выдаётся по возвращению с оплаты: редирект приходит
 * из браузера, и подделать его может кто угодно. Право на платный тариф
 * даёт только подписанное событие с их стороны.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Тело читаем строкой: подпись считается по байтам, и JSON.parse →
  // JSON.stringify меняет их так, что подпись перестаёт сходиться.
  const raw = await request.text();

  if (!signatureValid(raw, request.headers.get("x-signature"))) {
    // Адрес открыт всему интернету — отказ обязан быть тихим для чужого
    // и заметным в логе для нас.
    console.error("lemon: подпись не сошлась");
    return new NextResponse("нет", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("не JSON", { status: 400 });
  }

  const read = readEvent(payload as Parameters<typeof readEvent>[0]);
  if (!read.ok) {
    // 200, а не ошибка: Lemon Squeezy повторяет неуспешные доставки, и
    // событие, которое мы всё равно не применим, повторялось бы сутками.
    console.error(`lemon: событие пропущено — ${read.why}`);
    return NextResponse.json({ skipped: read.why });
  }

  const { readerId, update } = read;
  const updated = await sql<{ id: number }[]>`
    update dailynews.readers
       set plan = ${update.plan},
           subscription_id = ${update.subscriptionId || null},
           subscription_status = ${update.status || null},
           plan_renews_at = ${update.renewsAt},
           plan_ends_at = ${update.endsAt},
           -- Ссылку на портал не затираем пустотой: в части событий
           -- её нет, а без неё читателю некуда идти отменять.
           portal_url = coalesce(${update.portalUrl}, portal_url),
           updated_at = now()
     where id = ${readerId}
    returning id
  `;

  if (updated.length === 0) {
    console.error(`lemon: читатель ${readerId} не найден, тариф не выдан`);
    return NextResponse.json({ skipped: "нет такого читателя" });
  }

  console.log(`lemon: читатель ${readerId} → ${update.plan} (${update.status})`);
  return NextResponse.json({ ok: true });
}
