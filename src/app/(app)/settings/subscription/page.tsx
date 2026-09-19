import { currentReader } from "@/lib/session";
import { allows, cheapestWith, planOf } from "@/lib/plans";
import { PlanTable } from "@/components/plan-table";
import { SubscriptionForm } from "./form";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LockIcon } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Страница открыта на любом тарифе: закрывается здесь не прайс, а форма
 * своего ключа. Прайс за замком — это предложение, которого не видит
 * ровно тот, кому оно адресовано.
 */
export default async function SubscriptionPage() {
  const reader = await currentReader();
  const plan = planOf(reader.plan);
  const llm = (reader.llm ?? {}) as { base_url?: string; model?: string; api_key?: string };

  return (
    <div className="flex flex-col gap-6">
      <PlanTable current={plan} />

      {allows(plan, "subscription") ? (
        <SubscriptionForm
          baseUrl={llm.base_url ?? ""}
          model={llm.model ?? ""}
          hasKey={Boolean(llm.api_key)}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LockIcon className="size-4 text-muted-foreground" aria-hidden />
              Свой провайдер — на тарифе «{cheapestWith("subscription").label}»
            </CardTitle>
            <CardDescription>
              Дайджест пишет своя модель по твоему ключу вместо той, что стоит по умолчанию.
              На остальных тарифах выпуск пишется общей моделью — она уже настроена и работает.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
