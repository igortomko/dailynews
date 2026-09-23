import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/auth";
import { disconnectAccount } from "@/lib/readers";
import { parseSignedRequest } from "@/lib/social-connect";

/**
 * Delete Callback URL в настройках Threads API: читатель просит удалить
 * данные, полученные из Threads. Получали мы из Threads только номер
 * и имя аккаунта — их и стираем сразу, поэтому ответ уже окончательный.
 * Meta ждёт в ответе адрес, где проверить статус, и код подтверждения.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const signed = parseSignedRequest(
    String(form?.get("signed_request") ?? ""),
    process.env.THREADS_CLIENT_SECRET?.trim() ?? "",
  );
  if (!signed) {
    console.error("threads delete: подпись не сошлась");
    return new NextResponse("нет", { status: 400 });
  }
  const touched = await disconnectAccount("threads", signed.user_id);
  const code = randomUUID();
  console.log(`threads delete: стёрто ${touched}, код ${code}`);
  return NextResponse.json({
    url: `${appOrigin(new URL(request.url).origin)}/privacy#delete`,
    confirmation_code: code,
  });
}
