import { denied, json, readBody, resetDataset } from "@/lib/analytics/owner";
import { createPlacement } from "@/lib/analytics/placements";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const refused = await denied(request, true);
  if (refused) return refused;
  try {
    const body = await readBody(request) as { name?: unknown; channel?: unknown; costMinor?: unknown };
    const cost = body.costMinor ?? 0;
    if (typeof body.name !== "string" || typeof body.channel !== "string" || !Number.isSafeInteger(cost) || (cost as number) < 0) throw new Error("bad");
    const code = await createPlacement({ name: body.name, channel: body.channel, cost: (cost as number) / 100 });
    resetDataset();
    return json({ placement: { code } }, 201);
  } catch (error) {
    return json({ error: error instanceof Error && error.message !== "bad" ? error.message : "Нужны название, канал латиницей и неотрицательная цена" }, 400);
  }
}
