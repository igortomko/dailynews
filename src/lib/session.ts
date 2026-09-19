import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "./auth";
import { getReader } from "./readers";
import type { Reader } from "./types";

/**
 * Кто сейчас читает. Единственный источник ответа на этот вопрос в вебе —
 * подписанная кука: ни заголовок, ни параметр адреса, ни «последний
 * заведённый» не годятся.
 *
 * Отсутствие ответа — это вход, а не «покажем что-нибудь». В общей ленте
 * «что-нибудь» означает чужие новости, чужие интересы и чужую статистику.
 */
export async function currentReaderId(): Promise<number> {
  const id = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!id) redirect("/login");
  return id;
}

/** Читателя могли удалить, пока кука жива: сессия есть, строки нет. */
export async function currentReader(): Promise<Reader> {
  const reader = await getReader(await currentReaderId());
  if (!reader) redirect("/login");
  return reader;
}
