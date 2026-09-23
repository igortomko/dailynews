import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, appOrigin, verifySession } from "@/lib/auth";
import { getReader } from "@/lib/readers";
import { paddleApi } from "@/lib/billing";

/**
 * Портал клиента Paddle: смена карты, отмена, счета, смена тарифа.
 *
 * Постоянной ссылки, как у Lemon, у Paddle нет: сессия портала живёт минуты
 * и одноразовая, поэтому выдаётся на каждое нажатие, а кнопка ведёт сюда.
 *
 * Номер клиента берётся из подписки этого читателя, а не из запроса: иначе
 * любой вошедший мог бы открыть чужой кабинет оплаты, подставив чужой номер.
 * Хранить `ctm_…` отдельной колонкой не нужно — подписка его знает, а лишний
 * запрос к Paddle на нажатие раз в месяц ничего не стоит.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const back = new URL("/settings/subscription", appOrigin(request.nextUrl.origin));
  const readerId = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const reader = readerId ? await getReader(readerId) : undefined;
  const key = process.env.PADDLE_API_KEY;
  if (!reader?.subscription_id || !key) return NextResponse.redirect(back, 303);

  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  try {
    const sub = await fetch(`${paddleApi()}/subscriptions/${encodeURIComponent(reader.subscription_id)}`, { headers });
    if (!sub.ok) throw new Error(`подписка ${sub.status}`);
    const customerId: string = (await sub.json()).data.customer_id;

    const session = await fetch(`${paddleApi()}/customers/${encodeURIComponent(customerId)}/portal-sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subscription_ids: [reader.subscription_id] }),
    });
    if (!session.ok) throw new Error(`сессия портала ${session.status}`);
    const url: string = (await session.json()).data.urls.general.overview;
    return NextResponse.redirect(url, 303);
  } catch (error) {
    // Отказ называется в логе, а читатель возвращается к тарифам, а не
    // на пустую страницу с ошибкой: кнопку он нажмёт ещё раз.
    console.error(`paddle: портал для читателя ${reader.id} не открылся — ${(error as Error).message}`);
    return NextResponse.redirect(back, 303);
  }
}
