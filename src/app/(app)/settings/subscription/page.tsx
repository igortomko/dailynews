import { currentReader } from "@/lib/session";
import { allows, planOf } from "@/lib/plans";
import { PlanGate } from "@/components/plan-gate";
import { SubscriptionForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SubscriptionPage() {
  const profile = await currentReader();
  const plan = planOf(profile.plan);
  if (!allows(plan, "subscription")) {
    return (
      <PlanGate
        section="subscription"
        plan={plan}
        title="Подписка"
        what="Свой провайдер и своя модель для дайджеста вместо той, что стоит по умолчанию."
      />
    );
  }
  const llm = (profile.llm ?? {}) as { base_url?: string; model?: string; api_key?: string };
  return (
    <SubscriptionForm
      baseUrl={llm.base_url ?? ""}
      model={llm.model ?? ""}
      hasKey={Boolean(llm.api_key)}
    />
  );
}
