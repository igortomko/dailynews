import { getSourceHealth, getSources } from "@/lib/queries";
import { SourcesManager } from "./manager";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const [sources, health] = await Promise.all([getSources(), getSourceHealth()]);
  return <SourcesManager sources={sources} health={health} />;
}
