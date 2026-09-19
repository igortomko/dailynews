import { CrownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cheapestWith, topicsWord, type Gated, type Plan } from "@/lib/plans";

/**
 * Заглушка вместо закрытого раздела.
 *
 * Не редирект и не пустая страница: читатель должен увидеть, что раздел
 * существует и чего стоит. Молча вернуть на ленту — это отказ, похожий
 * на поломку, а спрятать пункт целиком — значит никогда не показать,
 * за что предлагается платить.
 */
export function PlanGate({
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CrownIcon className="size-4 text-amber-500" aria-hidden />
          {title} — на тарифе «{needed.label}»
        </CardTitle>
        <CardDescription>{what}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Сейчас у тебя «{plan.label}»: {plan.maxTopics} {topicsWord(plan.maxTopics)},{" "}
          {plan.maxSources} источников, до {plan.digestSizes[plan.digestSizes.length - 1]} новостей
          в выпуске. На «{needed.label}» — {needed.maxTopics} и {needed.maxSources}, ${needed.price}{" "}
          в месяц.
        </p>
        <Button size="sm" className="self-start" render={<a href="/settings/subscription" />}>
          Перейти на «{needed.label}»
        </Button>
      </CardContent>
    </Card>
  );
}
