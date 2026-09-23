/**
 * Подключение площадки входом в саму сеть: «Подключить» уводит на экран
 * сети, читатель разрешает, и мы узнаём, чей это аккаунт.
 *
 * Берём только имя аккаунта. Токен выбрасывается сразу после запроса
 * профиля: публиковать за читателя мы не умеем, а ключ к его аккаунту,
 * лежащий без дела, — это только риск.
 *
 * Сеть без приложения (не заданы `<СЕТЬ>_CLIENT_ID` и `_SECRET`) подключается
 * без входа, как прежняя галочка: кнопка, уводящая на экран ошибки сети,
 * хуже кнопки, которая просто включает таб. Telegram входа не требует
 * вовсе — читатель уже вошёл через бота.
 */
import type { NetworkId } from "./networks";

type Provider = {
  env: string;
  authorize: string;
  token: string;
  scope: string;
  /** X требует PKCE и Basic-авторизацию клиента; LinkedIn и Threads — нет. */
  pkce: boolean;
  basic: boolean;
  profile: (token: string) => Promise<string | null>;
};

const getJson = async (url: string, token: string) => {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${new URL(url).host}: ${response.status}`);
  return response.json();
};

export const PROVIDERS: Partial<Record<NetworkId, Provider>> = {
  x: {
    env: "X",
    authorize: "https://x.com/i/oauth2/authorize",
    token: "https://api.x.com/2/oauth2/token",
    scope: "users.read tweet.read",
    pkce: true,
    basic: true,
    profile: async (token) => {
      const body = await getJson("https://api.x.com/2/users/me", token);
      return body?.data?.username ? `@${body.data.username}` : null;
    },
  },
  linkedin: {
    env: "LINKEDIN",
    authorize: "https://www.linkedin.com/oauth/v2/authorization",
    token: "https://www.linkedin.com/oauth/v2/accessToken",
    scope: "openid profile",
    pkce: false,
    basic: false,
    // Публичного ника у LinkedIn по OpenID нет — только имя.
    profile: async (token) => (await getJson("https://api.linkedin.com/v2/userinfo", token))?.name ?? null,
  },
  threads: {
    env: "THREADS",
    authorize: "https://threads.net/oauth/authorize",
    token: "https://graph.threads.net/oauth/access_token",
    scope: "threads_basic",
    pkce: false,
    basic: false,
    profile: async (token) => {
      const body = await getJson("https://graph.threads.net/v1.0/me?fields=username", token);
      return body?.username ? `@${body.username}` : null;
    },
  },
};

function credentials(network: NetworkId): { id: string; secret: string } | null {
  const provider = PROVIDERS[network];
  if (!provider) return null;
  const id = process.env[`${provider.env}_CLIENT_ID`]?.trim();
  const secret = process.env[`${provider.env}_CLIENT_SECRET`]?.trim();
  return id && secret ? { id, secret } : null;
}

/** Сети, где «Подключить» ведёт на вход в сеть. Остальные подключаются сразу. */
export const oauthNetworks = (): NetworkId[] =>
  (Object.keys(PROVIDERS) as NetworkId[]).filter((network) => credentials(network));

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

export function newState(): { state: string; verifier: string } {
  return {
    state: base64url(crypto.getRandomValues(new Uint8Array(16))),
    verifier: base64url(crypto.getRandomValues(new Uint8Array(32))),
  };
}

export async function authorizeUrl(
  network: NetworkId,
  redirectUri: string,
  state: string,
  verifier: string,
): Promise<string | null> {
  const provider = PROVIDERS[network];
  const creds = credentials(network);
  if (!provider || !creds) return null;
  const url = new URL(provider.authorize);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: creds.id,
    redirect_uri: redirectUri,
    scope: provider.scope,
    state,
  }).toString();
  if (provider.pkce) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    url.searchParams.set("code_challenge", base64url(new Uint8Array(digest)));
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

/** Код из возврата → имя аккаунта. Любой отказ — исключение с причиной. */
export async function accountFor(
  network: NetworkId,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<string> {
  const provider = PROVIDERS[network];
  const creds = credentials(network);
  if (!provider || !creds) throw new Error(`${network}: приложение не заведено`);

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    // Threads дописывает к коду «#_», и с ним обмен не проходит.
    code: code.replace(/#_$/, ""),
    redirect_uri: redirectUri,
    client_id: creds.id,
  });
  if (provider.pkce) form.set("code_verifier", verifier);
  if (!provider.basic) form.set("client_secret", creds.secret);

  const response = await fetch(provider.token, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(provider.basic
        ? { authorization: `Basic ${Buffer.from(`${creds.id}:${creds.secret}`).toString("base64")}` }
        : {}),
    },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) {
    throw new Error(`${network}: обмен кода ${response.status} ${JSON.stringify(body)?.slice(0, 200)}`);
  }
  const account = await provider.profile(body.access_token);
  if (!account) throw new Error(`${network}: профиль пришёл без имени`);
  return account;
}
