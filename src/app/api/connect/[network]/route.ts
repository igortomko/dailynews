import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, equal, sign } from "@/lib/auth";
import { currentReader } from "@/lib/session";
import { connectChannel } from "@/lib/readers";
import { effectivePlan } from "@/lib/billing";
import { allows } from "@/lib/plans";
import { accountFor, authorizeUrl, newState, PROVIDERS } from "@/lib/social-connect";
import type { NetworkId } from "@/lib/networks";

/**
 * Вход в сеть ради подключения площадки. Один адрес на оба конца:
 * без `code` уводим на экран сети, с `code` — она вернула читателя.
 *
 * `state` лежит в подписанной куке рядом с номером сети и верификатором
 * PKCE: чужая ссылка возврата с подставленным кодом подключила бы
 * читателю чужой аккаунт.
 */
export const dynamic = "force-dynamic";

const COOKIE = "dn_connect";

export async function GET(request: NextRequest, { params }: { params: Promise<{ network: string }> }) {
  const { network: raw } = await params;
  const network = raw as NetworkId;
  const origin = appOrigin(request.nextUrl.origin);
  const redirectUri = `${origin}/api/connect/${network}`;
  const query = request.nextUrl.searchParams;

  const reader = await currentReader();
  if (!PROVIDERS[network] || !allows(effectivePlan(reader), "posts")) {
    return NextResponse.redirect(`${origin}/settings/channels`);
  }

  if (!query.has("code") && !query.has("error")) {
    const { state, verifier } = newState();
    const url = await authorizeUrl(network, redirectUri, state, verifier);
    if (!url) return NextResponse.redirect(`${origin}/settings/channels`);
    const payload = [reader.id, network, state, verifier, query.get("first") === "1" ? 1 : 0].join(".");
    const response = NextResponse.redirect(url);
    response.cookies.set(COOKIE, `${payload}.${await sign(`connect:${payload}`)}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/connect",
      maxAge: 600,
    });
    return response;
  }

  const [readerId, cookieNetwork, state, verifier, first, signature] =
    request.cookies.get(COOKIE)?.value.split(".") ?? [];
  const payload = [readerId, cookieNetwork, state, verifier, first].join(".");
  const valid =
    signature &&
    equal(signature, await sign(`connect:${payload}`)) &&
    Number(readerId) === reader.id &&
    cookieNetwork === network &&
    equal(state, query.get("state") ?? "");

  const back = new URL(`${origin}/settings/channels`);
  if (first === "1") back.searchParams.set("first", "1");

  const code = query.get("code");
  if (valid && code) {
    try {
      const account = await accountFor(network, code, redirectUri, verifier);
      await connectChannel(reader.id, network, account.name, account.id);
    } catch (error) {
      console.error("connect:", error instanceof Error ? error.message : error);
      back.searchParams.set("failed", network);
    }
  } else if (query.get("error") !== "access_denied") {
    // Отказ читателя на экране сети — его решение, а не поломка: молча
    // возвращаем. Всё остальное называем.
    console.error(`connect: ${network} вернулась без кода или с чужим state`);
    back.searchParams.set("failed", network);
  }

  const response = NextResponse.redirect(back);
  response.cookies.delete({ name: COOKIE, path: "/api/connect" });
  return response;
}
