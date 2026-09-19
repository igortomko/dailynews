import { currentReader } from "@/lib/session";
import { SubscriptionForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SubscriptionPage() {
  const reader = await currentReader();
  const llm = (reader.llm ?? {}) as { base_url?: string; model?: string; api_key?: string };
  return (
    <SubscriptionForm
      baseUrl={llm.base_url ?? ""}
      model={llm.model ?? ""}
      hasKey={Boolean(llm.api_key)}
    />
  );
}
