import { denied, json, loadDataset } from "@/lib/analytics/owner";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const refused = await denied(request);
  if (refused) return refused;
  try { return json(await loadDataset()); }
  catch (error) {
    console.error("analytics dataset:", error);
    return json({ error: "Не удалось прочитать данные. Повторите обновление" }, 503);
  }
}
