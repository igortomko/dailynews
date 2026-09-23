import type { NextRequest } from "next/server";
import { appOrigin, equal } from "@/lib/auth";
import { landByEmail } from "@/lib/email-login";
import { GOOGLE_STATE_COOKIE, emailFromIdToken, exchangeCode, googleConfig } from "@/lib/google";

export async function GET(request: NextRequest) {
  const appUrl = appOrigin(request.nextUrl.origin);
  const config = googleConfig();
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const expected = request.cookies.get(GOOGLE_STATE_COOKIE)?.value ?? "";

  let email: string | null = null;
  if (config && code && expected && equal(state, expected)) {
    try {
      const idToken = await exchangeCode(code, config, appUrl);
      email = idToken ? emailFromIdToken(idToken, config.id) : null;
    } catch (error) {
      console.error(`google login: ${(error as Error).message}`);
    }
  }
  // Отказ — тот же экран, что у истёкшей ссылки: выход один, войти заново.
  const response = await landByEmail(request, email, "google");
  response.cookies.delete({ name: GOOGLE_STATE_COOKIE, path: "/auth/google" });
  return response;
}
