import { LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cheapestWith, type Gated, type Plan } from "@/lib/plans";

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
          <LockIcon className="size-4 text-muted-foreground" aria-hidden />
          {title} — на тарифе «{needed.label}»
        </CardTitle>
        <CardDescription>{what}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Сейчас у тебя «{plan.label}»: {plan.maxTopics}{" "}
          {plan.maxTopics === 1 ? "интерес" : plan.maxTopics < 5 ? "интереса" : "интересов"},{" "}
          {plan.maxSources} источников, до {plan.digestSizes[plan.digestSizes.length - 1]} новостей
          в выпуске. На «{needed.label}» — {needed.maxTopics} и {needed.maxSources}, ${needed.price}{" "}
          в месяц.
        </p>
        {/* Оплаты в проекте нет: кнопка, ведущая в никуда, хуже её отсутствия. */}
        <Button variant="outline" size="sm" disabled className="self-start">
          Переход на «{needed.label}» пока вручную
        </Button>
      </CardContent>
    </Card>
  );
}
