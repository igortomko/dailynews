import { NextResponse, type NextRequest } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/auth";
import { setEmailDigest } from "@/lib/readers";

/**
 * Отписка от писем с выпуском.
 *
 * POST — отписка в один клик (RFC 8058): её шлёт сам почтовый клиент
 * по заголовку `List-Unsubscribe-Post`. GET только показывает кнопку:
 * почтовые сканеры открывают ссылки раньше человека, и отписка по GET
 * выключала бы письма тем, кто ничего не нажимал.
 *
 * Без входа: из письма сюда приходят и с чужого устройства. Токен —
 * подпись номера читателя, и выключить он может только письма.
 */
export async function POST(request: NextRequest) {
  const readerId = await verifyUnsubscribeToken(request.nextUrl.searchParams.get("token"));
  if (!readerId) return new NextResponse("Ссылка не подходит", { status: 400 });
  await setEmailDigest(readerId, false);
  return new NextResponse(page("Готово: выпуск больше не приходит письмом. Включить обратно можно в «Доставке».", null), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const ok = Boolean(await verifyUnsubscribeToken(token));
  return new NextResponse(
    ok ? page("Не присылать выпуск письмом? Лента и остальные направления останутся как есть.", token) : page("Ссылка не подходит.", null),
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function page(text: string, token: string | null): string {
  const form = token
    ? `<form method="post" action="/api/unsubscribe?token=${escape(encodeURIComponent(token))}"><button style="font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#111;color:#fff;cursor:pointer">Не присылать письмом</button></form>`
    : "";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporta</title></head><body style="font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;line-height:1.5"><h1 style="font-size:20px">Reporta</h1><p>${escape(text)}</p>${form}</body></html>`;
}
