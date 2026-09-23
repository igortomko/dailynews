import { NextResponse, type NextRequest } from "next/server";
import { appOrigin } from "@/lib/auth";
import { GOOGLE_STATE_COOKIE, googleAuthUrl, googleConfig } from "@/lib/google";

/**
 * Уход к Google. `state` лежит в куке и сверяется на возврате: без него
 * чужая страница могла бы прислать нам свой код и войти читателем в свой
 * аккаунт на его компьютере.
 */
export async function GET(request: NextRequest) {
  const appUrl = appOrigin(request.nextUrl.origin);
  const config = googleConfig();
  if (!config) return NextResponse.redirect(new URL("/login", appUrl));

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(googleAuthUrl(config.id, appUrl, state));
  response.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/auth/google",
    maxAge: 600,
  });
  return response;
}
