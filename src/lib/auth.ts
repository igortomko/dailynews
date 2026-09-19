/**
 * Одна кука вместо системы аккаунтов: читатель один, а Supabase Auth тут
 * не при чём — продуктовые схемы не экспонируются в PostgREST, поэтому
 * клиентской сессии Supabase всё равно не с чем работать.
 *
 * Web Crypto, а не node:crypto: тот же код должен исполняться в middleware,
 * а оно идёт по edge-рантайму.
 */
const COOKIE = "dn_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

async function key(): Promise<CryptoKey> {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("APP_SECRET не задан или короче 16 символов");
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(payload: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await key(), encoder.encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Сравнение за постоянное время: обычное === выдаёт подпись посимвольно. */
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueSession(): Promise<{ name: string; value: string; options: object }> {
  const issuedAt = String(Date.now());
  return {
    name: COOKIE,
    value: `${issuedAt}.${await sign(issuedAt)}`,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    },
  };
}

export async function verifySession(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const [issuedAt, signature] = value.split(".");
  if (!issuedAt || !signature) return false;

  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_SECONDS * 1000) return false;

  return equal(signature, await sign(issuedAt));
}

/** Сколько живёт ссылка входа. Она приходит в личный чат, но короткий срок
 *  всё равно дешевле, чем хранение одноразовых токенов в базе. */
const LINK_TTL_MS = 10 * 60 * 1000;

export async function issueLoginToken(): Promise<string> {
  const expires = String(Date.now() + LINK_TTL_MS);
  const nonce = crypto.randomUUID();
  return `${expires}.${nonce}.${await sign(`login:${expires}:${nonce}`)}`;
}

export async function verifyLoginToken(token: string | null): Promise<boolean> {
  if (!token) return false;
  const [expires, nonce, signature] = token.split(".");
  if (!expires || !nonce || !signature) return false;
  if (Date.now() > Number(expires)) return false;
  return equal(signature, await sign(`login:${expires}:${nonce}`));
}

export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error("APP_PASSWORD не задан");
  // Хэшируем обе стороны, чтобы сравнивать строки одинаковой длины.
  return equal(await sign(`pw:${candidate}`), await sign(`pw:${expected}`));
}

export const SESSION_COOKIE = COOKIE;
