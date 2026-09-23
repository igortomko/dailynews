import { denied, json, loadDataset, readBody } from "@/lib/analytics/owner";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const refused = await denied(request, true);
  if (refused) return refused;
  try {
    const body = await readBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) throw new Error("Expected empty object");
  } catch { return json({ error: "Некорректный запрос обновления" }, 400); }
  const fresh = loadDataset(true);
  if (!fresh) return json({ error: "Повторите обновление через 30 секунд" }, 429);
  try { return json({ generatedAt: (await fresh).generatedAt }); }
  catch (error) {
    console.error("analytics refresh:", error);
    return json({ error: "Не удалось обновить данные. Предыдущий результат остаётся на экране" }, 503);
  }
}
