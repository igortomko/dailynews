import { cookies } from "next/headers";
import { denied, encodeSelection, json, readBody, SELECTION_COOKIE, validateSelection } from "@/lib/analytics/owner";

export const dynamic = "force-dynamic";

export async function PUT(request: Request): Promise<Response> {
  const refused = await denied(request, true);
  if (refused) return refused;
  try {
    const selection = validateSelection(await readBody(request));
    (await cookies()).set(SELECTION_COOKIE, await encodeSelection(selection), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 24 * 60 * 60,
    });
    return json({ selection });
  } catch { return json({ error: "Не удалось сохранить состав блоков" }, 400); }
}
