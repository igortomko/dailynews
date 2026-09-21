/**
 * Подписанная кука вместо системы аккаунтов: Supabase Auth тут не при чём —
 * продуктовые схемы не экспонируются в PostgREST, поэтому клиентской сессии
 * Supabase всё равно не с чем работать.
 *
 * Кука и ссылка входа несут идентификатор читателя. Без него в общей ленте
 * любая сессия открывала бы данные того, кого сервер решит считать текущим, —
 * и выглядело бы это как работающий вход.
 *
 * Web Crypto, а не node:crypto: тот же код исполняется и в proxy, который
 * до Next 16 шёл по edge-рантайму, где node:crypto нет. Web Crypto есть
 * в обоих, и менять здесь нечего.
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
export function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Идентификатор читателя — часть подписываемой строки, а не приписка к ней.
 * Иначе подпись от чужой куки годилась бы с подменённым номером, и читатель
 * открыл бы ленту соседа, ничего не взломав.
 */
export async function issueSession(
  readerId: number,
): Promise<{ name: string; value: string; options: object }> {
  const issuedAt = String(Date.now());
  const payload = `${readerId}.${issuedAt}`;
  return {
    name: COOKIE,
    value: `${payload}.${await sign(`session:${payload}`)}`,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    },
  };
}

/** Номер читателя или null. Булев ответ здесь был бы приглашением забыть,
 *  чью именно ленту показывать. */
export async function verifySession(value: string | undefined): Promise<number | null> {
  if (!value) return null;
  const [readerId, issuedAt, signature] = value.split(".");
  if (!readerId || !issuedAt || !signature) return null;

  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_SECONDS * 1000) return null;

  if (!equal(signature, await sign(`session:${readerId}.${issuedAt}`))) return null;

  const id = Number(readerId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Сколько живёт ссылка входа. Она приходит в личный чат, но короткий срок
 *  всё равно дешевле, чем хранение одноразовых токенов в базе. */
const LINK_TTL_MS = 10 * 60 * 1000;

export async function issueLoginToken(readerId: number): Promise<string> {
  const expires = String(Date.now() + LINK_TTL_MS);
  const nonce = crypto.randomUUID();
  const payload = `${readerId}.${expires}.${nonce}`;
  return `${payload}.${await sign(`login:${payload}`)}`;
}

export async function verifyLoginToken(token: string | null): Promise<number | null> {
  if (!token) return null;
  const [readerId, expires, nonce, signature] = token.split(".");
  if (!readerId || !expires || !nonce || !signature) return null;
  if (Date.now() > Number(expires)) return null;
  if (!equal(signature, await sign(`login:${readerId}.${expires}.${nonce}`))) return null;

  const id = Number(readerId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error("APP_PASSWORD не задан");
  // Хэшируем обе стороны, чтобы сравнивать строки одинаковой длины.
  return equal(await sign(`pw:${candidate}`), await sign(`pw:${expected}`));
}

export const SESSION_COOKIE = COOKIE;

/**
 * Адрес, по которому ленту открывают снаружи.
 *
 * В standalone-сборке за обратным прокси `nextUrl.origin` — это адрес
 * прослушивания контейнера, и собранная из него ссылка ведёт на
 * https://0.0.0.0:3000. Ссылка входа приземлялась именно туда: кука
 * ставилась, переход выполнялся, страница не открывалась.
 *
 * Одна функция на оба места, где адрес собирается: бот шлёт ссылку,
 * /auth на неё приземляет, и разойтись они не должны.
 */
export const appOrigin = (fallback: string) => process.env.APP_URL?.trim() || fallback;
