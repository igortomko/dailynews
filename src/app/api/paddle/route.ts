import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { readEvent, signatureValid } from "@/lib/billing";

/**
 * Вебхук Paddle: единственный путь, которым тариф меняется.
 *
 * Читателю тариф не выдаётся по закрытию окна оплаты: это событие приходит
 * из браузера, и подделать его может кто угодно. Право на платный тариф
 * даёт только подписанное событие с их стороны.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Тело читаем строкой: подпись считается по байтам, и JSON.parse →
  // JSON.stringify меняет их так, что подпись перестаёт сходиться.
  const raw = await request.text();

  if (!signatureValid(raw, request.headers.get("paddle-signature"))) {
    // Адрес открыт всему интернету — отказ обязан быть тихим для чужого
    // и заметным в логе для нас. Не-2xx Paddle повторит: если это наш
    // сменённый и ещё не развёрнутый секрет, событие доедет после деплоя.
    console.error("paddle: подпись не сошлась");
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
    // 200, а не ошибка: Paddle повторяет неуспешные доставки трое суток,
    // и событие, которое мы всё равно не применим, повторялось бы зря.
    console.error(`paddle: событие пропущено — ${read.why}`);
    return NextResponse.json({ skipped: read.why });
  }

  const { readerId, update } = read;
  // Условие на время события — защита от доставки не по порядку: старое
  // событие, пришедшее после нового, не перезаписывает то, что уже стало.
  // Повтор того же события проходит (<=) и записывает то же самое.
  const updated = await sql<{ id: number }[]>`
    update dailynews.readers
       set plan = ${update.plan},
           subscription_id = ${update.subscriptionId || null},
           subscription_status = ${update.status || null},
           plan_renews_at = ${update.renewsAt},
           plan_ends_at = ${update.endsAt},
           subscription_event_at = ${update.occurredAt},
           updated_at = now()
     where id = ${readerId}
       and (subscription_event_at is null or subscription_event_at <= ${update.occurredAt}::timestamptz)
    returning id
  `;

  if (updated.length === 0) {
    console.error(`paddle: читатель ${readerId} не найден или событие старше применённого — пропущено`);
    return NextResponse.json({ skipped: "нет читателя или событие устарело" });
  }

  console.log(`paddle: читатель ${readerId} → ${update.plan} (${update.status})`);
  return NextResponse.json({ ok: true });
}
