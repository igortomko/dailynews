import { currentReader } from "@/lib/session";
import { effectivePlan } from "@/lib/billing";
import { PersonalizationForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * Тарифом не закрывается: язык, сложность и манера не стоят ни одного
 * лишнего токена — тот же вызов модели, другой промпт. Держать их
 * за тарифом значило бы ухудшать бесплатный выпуск без причины.
 */
export default async function PersonalizationPage() {
  const reader = await currentReader();
  return <PersonalizationForm profile={reader} plan={effectivePlan(reader)} />;
}
