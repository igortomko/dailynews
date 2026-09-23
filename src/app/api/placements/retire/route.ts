import { denied, json, readBody, resetDataset } from "@/lib/analytics/owner";
import { retirePlacement } from "@/lib/analytics/placements";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const refused = await denied(request, true);
  if (refused) return refused;
  try {
    const body = await readBody(request) as { code?: unknown };
    if (typeof body.code !== "string" || !/^[a-z0-9]{4,32}$/.test(body.code)) throw new Error("bad");
    await retirePlacement(body.code);
    resetDataset();
    return json({ retired: body.code });
  } catch { return json({ error: "Неизвестный код" }, 400); }
}
