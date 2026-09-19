import { CheckIcon, MinusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { maxDigestOf, PLAN_IDS, PLANS, topicsWord, type Plan } from "@/lib/plans";

/**
 * Сравнение тарифов.
 *
 * Строки считаются из PLANS, а не переписаны руками: таблица, где числа
 * живут отдельно от кода, который их применяет, расходится с ним молча —
 * читатель видит одно обещание, а упирается в другое.
 *
 * Видна на любом тарифе, в том числе бесплатном. Прайс за замком — это
 * предложение, которого не видит ровно тот, кому оно адресовано.
 */
function rows(plan: Plan): { label: string; value: string | boolean }[] {
  return [
    { label: "Источников в выпуске", value: String(plan.maxSources) },
    { label: "Интересов", value: `${plan.maxTopics} ${topicsWord(plan.maxTopics)}` },
    { label: "Новостей в выпуске", value: `до ${maxDigestOf(plan)}` },
    { label: "X (Twitter)", value: plan.kinds.includes("x") },
    { label: "Язык, сложность, манера", value: plan.sections.includes("personalization") },
    { label: "Калибровка отбора", value: plan.sections.includes("calibration") },
    { label: "Свой провайдер и ключ", value: plan.sections.includes("subscription") },
  ];
}

export function PlanTable({ current }: { current: Plan }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Тарифы</CardTitle>
        <CardDescription>
          Тариф решает, сколько источников опрашивается для твоего выпуска, сколько у тебя
          интересов и какого он размера.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        {PLAN_IDS.map((id) => {
          const plan = PLANS[id];
          const mine = plan.id === current.id;
          return (
            <div
              key={id}
              className={cn(
                "flex flex-col gap-3 rounded-lg border p-4",
                mine ? "border-foreground/30 bg-foreground/[0.03]" : "border-border",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{plan.label}</span>
                {mine ? <Badge variant="secondary">твой</Badge> : null}
              </div>

              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-medium tabular-nums">${plan.price}</span>
                <span className="text-xs text-muted-foreground">в месяц</span>
              </div>

              <dl className="flex flex-col gap-1.5 text-sm">
                {rows(plan).map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="shrink-0 tabular-nums">
                      {typeof row.value === "string" ? (
                        row.value
                      ) : row.value ? (
                        <CheckIcon className="size-4" aria-label="есть" />
                      ) : (
                        <MinusIcon className="size-4 text-muted-foreground/50" aria-label="нет" />
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </CardContent>
      <CardContent className="pt-0">
        {/* Оплаты в Ленте нет, и делать вид, что есть, нельзя: кнопка,
            ведущая в никуда, обещает больше, чем продукт умеет. */}
        <p className="text-xs text-muted-foreground">
          Оплаты пока нет — тариф меняется вручную. Сбор общий на всех читателей, поэтому
          источники, которых нет в твоём тарифе, продолжают работать у тех, у кого они есть.
        </p>
      </CardContent>
    </Card>
  );
}
