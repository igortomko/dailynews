import { CrownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cheapestWith, type Gated, type Plan } from "@/lib/plans";
import { getDict } from "@/lib/i18n/server";

/**
 * Заглушка вместо закрытого раздела.
 *
 * Не редирект и не пустая страница: читатель должен увидеть, что раздел
 * существует и чего стоит. Молча вернуть на ленту — это отказ, похожий
 * на поломку, а спрятать пункт целиком — значит никогда не показать,
 * за что предлагается платить.
 */
export async function PlanGate({
  section,
  plan,
  title,
  what,
}: {
  section: Gated;
  plan: Plan;
  /** Название раздела так, как оно стоит в меню. */
  title: string;
  /** Одна фраза: что читатель получит, открыв раздел. */
  what: string;
}) {
  const needed = cheapestWith(section);
  const t = await getDict();
  const currentLabel = t.plans.label[plan.id];
  const neededLabel = t.plans.label[needed.id];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CrownIcon className="size-4 text-amber-500" aria-hidden />
          {t.plans.gate.titleWithPlan(title, neededLabel)}
        </CardTitle>
        <CardDescription>{what}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {t.plans.gate.nowOn(
            currentLabel, plan.maxTopics, t.plans.topicsWord(plan.maxTopics), plan.maxSources, plan.maxMinutes,
          )}{" "}
          {t.plans.gate.upgradeTo(
            neededLabel, needed.maxTopics, t.plans.topicsWord(needed.maxTopics), needed.maxSources,
            needed.maxMinutes, needed.price,
          )}
        </p>
        <Button size="sm" className="self-start" render={<a href="/settings/subscription" />}>
          {t.plans.moveTo(neededLabel)}
        </Button>
      </CardContent>
    </Card>
  );
}
