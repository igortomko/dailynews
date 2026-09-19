import { getProfile, getSources } from "@/lib/queries";
import { planOf } from "@/lib/plans";
import { SourcesManager } from "./manager";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const [sources, profile] = await Promise.all([getSources(), getProfile()]);
  return <SourcesManager sources={sources} plan={planOf(profile.plan)} />;
}
