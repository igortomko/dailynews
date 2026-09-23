import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, verifyConfirmToken } from "@/lib/auth";
import { confirmEmail } from "@/lib/readers";

/**
 * Клик по письму «подтверди почту». Сессия не нужна: письмо открывают
 * и на телефоне, где профиль не открыт, а привязку решает подписанный
 * номер читателя в самой ссылке.
 */
export async function GET(request: NextRequest) {
  const confirmed = await verifyConfirmToken(request.nextUrl.searchParams.get("token"));
  const result = confirmed ? await confirmEmail(confirmed.readerId, confirmed.email) : "expired";
  const back = new URL("/settings/delivery", appOrigin(request.nextUrl.origin));
  back.searchParams.set("email", result);
  return NextResponse.redirect(back);
}
