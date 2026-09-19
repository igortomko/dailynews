import { getProfile } from "@/lib/queries";
import { SubscriptionForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SubscriptionPage() {
  const profile = await getProfile();
  const llm = (profile.llm ?? {}) as { base_url?: string; model?: string; api_key?: string };
  return (
    <SubscriptionForm
      baseUrl={llm.base_url ?? ""}
      model={llm.model ?? ""}
      hasKey={Boolean(llm.api_key)}
    />
  );
}
