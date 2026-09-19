import { getSources } from "@/lib/queries";
import { SourcesManager } from "./manager";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  return <SourcesManager sources={await getSources()} />;
}
