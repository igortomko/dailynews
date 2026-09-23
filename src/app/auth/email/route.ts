import type { NextRequest } from "next/server";
import { verifyEmailToken } from "@/lib/auth";
import { landByEmail } from "@/lib/email-login";

/**
 * Ссылка из письма. Токен не одноразовый намеренно: почтовые сканеры
 * (Outlook, корпоративные фильтры) открывают ссылку раньше человека,
 * и одноразовая сгорала бы у них.
 */
export async function GET(request: NextRequest) {
  return landByEmail(request, await verifyEmailToken(request.nextUrl.searchParams.get("token")), "email");
}
