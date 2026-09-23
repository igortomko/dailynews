import profile from "@/lib/analytics/profile.json";
import { catalog, csrfToken, denied, json, ownerSelection } from "@/lib/analytics/owner";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const refused = await denied(request);
  if (refused) return refused;
  return json({
    product: profile.product, selection: await ownerSelection(), catalog, csrfToken: await csrfToken(),
    mode: "local", refresh: { available: true, minimumIntervalSeconds: 30 },
  });
}
