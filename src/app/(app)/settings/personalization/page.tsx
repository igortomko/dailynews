import { currentReader } from "@/lib/session";
import { allows, planOf } from "@/lib/plans";
import { PlanGate } from "@/components/plan-gate";
import { PersonalizationForm } from "./form";

export const dynamic = "force-dynamic";

export default async function PersonalizationPage() {
  const profile = await currentReader();
  const plan = planOf(profile.plan);
  // Проверка стоит на самой странице, а не только в меню: спрятанный пункт
  // обходится набранным адресом, и раздел открывался бы целиком.
  if (!allows(plan, "personalization")) {
    return (
      <PlanGate
        section="personalization"
        plan={plan}
        title="Персонализация"
        what="Язык выпуска, сложность языка и манера письма — чем и как с тобой разговаривает лента."
      />
    );
  }
  return <PersonalizationForm profile={profile} />;
}
