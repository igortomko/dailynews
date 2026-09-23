/**
 * Вход через Google: OAuth 2.0 с кодом, без библиотеки — это два запроса.
 *
 * Подпись id_token не проверяется, и это разрешено самим Google: токен
 * пришёл ответом на наш запрос к его token endpoint по TLS с нашим
 * секретом, подменить его по дороге нечем. Проверяются aud, iss
 * и подтверждённость адреса: неподтверждённый адрес Google отдал бы
 * чужой ящик в руки того, кто его набрал.
 *
 * Не заданы GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET — кнопки нет вовсе.
 */
export const GOOGLE_STATE_COOKIE = "dn_google_state";

export function googleConfig() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

export const googleRedirectUri = (appUrl: string) => `${appUrl.replace(/\/$/, "")}/auth/google/callback`;

export function googleAuthUrl(clientId: string, appUrl: string, state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", googleRedirectUri(appUrl));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/** Адрес из id_token, если он годится для входа, иначе null. */
export function emailFromIdToken(idToken: string, clientId: string): string | null {
  const body = idToken.split(".")[1];
  if (!body) return null;
  let claims: { aud?: unknown; iss?: unknown; email?: unknown; email_verified?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims.aud !== clientId) return null;
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
  // Строго true: Google отдаёт булево, а строку "false" нельзя принять за да.
  if (claims.email_verified !== true || typeof claims.email !== "string") return null;
  return claims.email;
}

export async function exchangeCode(code: string, config: { id: string; secret: string }, appUrl: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.id,
      client_secret: config.secret,
      redirect_uri: googleRedirectUri(appUrl),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google token HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { id_token?: unknown };
  return typeof json.id_token === "string" ? json.id_token : null;
}
