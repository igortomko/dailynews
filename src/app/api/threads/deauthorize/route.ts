import { NextResponse } from "next/server";
import { disconnectAccount } from "@/lib/readers";
import { parseSignedRequest } from "@/lib/social-connect";

/**
 * Uninstall Callback URL в настройках Threads API: читатель отозвал доступ
 * Reporta у себя в Threads. Подключения больше нет — гасим его и стираем
 * номер с именем, иначе в плитке висело бы «Подключено» к мёртвой связи.
 * Куки у Meta нет, поэтому адрес открыт в proxy, а подлинность решает
 * подпись секретом приложения.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const signed = parseSignedRequest(
    String(form?.get("signed_request") ?? ""),
    process.env.THREADS_CLIENT_SECRET?.trim() ?? "",
  );
  if (!signed) {
    console.error("threads deauthorize: подпись не сошлась");
    return new NextResponse("нет", { status: 400 });
  }
  const touched = await disconnectAccount("threads", signed.user_id);
  console.log(`threads deauthorize: отключено ${touched}`);
  return NextResponse.json({ ok: true });
}
