import { CheckIcon, CrownIcon, MinusIcon, SproutIcon, ZapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { checkoutUrl, endingAt } from "@/lib/lemon";
import { maxDigestOf, FEATURES, PLAN_IDS, PLANS, type FeatureId, type Plan, type PlanId } from "@/lib/plans";
import type { Reader } from "@/lib/types";

/**
 * Сравнение тарифов.
 *
 * Строки считаются из PLANS и FEATURES, а не переписаны руками: таблица,
 * где числа живут отдельно от кода, который их применяет, расходится с ним
 * молча — читатель видит одно обещание, а упирается в другое.
 *
 * Видна на любом тарифе, в том числе бесплатном: прайс за замком — это
 * предложение, которого не видит ровно тот, кому оно адресовано.
 */
const ICONS: Record<PlanId, typeof CrownIcon> = {
  free: SproutIcon,
  plus: ZapIcon,
  pro: CrownIcon,
};

/** Порядок строк — от того, что считается глазами, к тому, что включается. */
const ROWS: { feature: FeatureId; value: (plan: Plan) => string | boolean }[] = [
  { feature: "sources", value: (plan) => String(plan.maxSources) },
  { feature: "topics", value: (plan) => String(plan.maxTopics) },
  { feature: "digest", value: (plan) => `до ${maxDigestOf(plan)}` },
  { feature: "x", value: (plan) => plan.kinds.includes("x") },
  { feature: "personalization", value: (plan) => FEATURES.personalization.has(plan) },
];

function Value({ value }: { value: string | boolean }) {
  if (typeof value === "string") return <>{value}</>;
  return value ? (
    <CheckIcon className="size-4" aria-label="есть" />
  ) : (
    <MinusIcon className="size-4 text-muted-foreground/50" aria-label="нет" />
  );
}

export function PlanTable({ reader, current }: { reader: Reader; current: Plan }) {
  const ends = endingAt(reader);
  const paying = Boolean(reader.subscription_id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Тарифы</CardTitle>
        <CardDescription>
          Тариф решает, за сколькими источниками следит лента, сколько у тебя тем и какого
          размера выпуск приходит.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-3 sm:grid-cols-3">
        {PLAN_IDS.map((id) => {
          const plan = PLANS[id];
          const Icon = ICONS[id];
          const mine = plan.id === current.id;
          const buy = plan.price > current.price ? checkoutUrl(id, reader.id) : null;

          return (
            <div
              key={id}
              className={cn(
                "flex flex-col gap-3 rounded-lg border p-4",
                mine ? "border-foreground/30 bg-foreground/[0.03]" : "border-border",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon
                    className={cn("size-4", id === "pro" ? "text-amber-500" : "text-muted-foreground")}
                    aria-hidden
                  />
                  {plan.label}
                </span>
                {mine ? <Badge variant="secondary">твой</Badge> : null}
              </div>

              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-medium tabular-nums">${plan.price}</span>
                <span className="text-xs text-muted-foreground">в месяц</span>
              </div>

              <dl className="flex flex-col gap-1.5 text-sm">
                {ROWS.map(({ feature, value }) => (
                  <div key={feature} className="flex items-start justify-between gap-3">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <dt className="min-w-0 cursor-help text-left text-muted-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-4" />
                        }
                      >
                        {FEATURES[feature].title}
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64">{FEATURES[feature].what}</TooltipContent>
                    </Tooltip>
                    <dd className="shrink-0 whitespace-nowrap tabular-nums">
                      <Value value={value(plan)} />
                    </dd>
                  </div>
                ))}
              </dl>

              {/* Кнопка появляется только там, где ей есть куда вести:
                  «перейти» без настроенной оплаты — обещание без продукта. */}
              {buy ? (
                <Button size="sm" className="mt-auto" render={<a href={buy} />}>
                  Перейти на «{plan.label}»
                </Button>
              ) : null}
            </div>
          );
        })}
      </CardContent>

      {paying ? (
        <CardContent className="flex flex-wrap items-center gap-3 pt-0">
          {reader.portal_url ? (
            <Button variant="outline" size="sm" render={<a href={reader.portal_url} />}>
              Управлять подпиской
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {ends
              ? `Подписка отменена, тариф «${current.label}» работает до ${ends.toLocaleDateString("ru-RU")}.`
              : reader.subscription_status === "past_due"
                ? "Последний платёж не прошёл — Lemon Squeezy повторит списание."
                : reader.plan_renews_at
                  ? `Продлится ${new Date(reader.plan_renews_at).toLocaleDateString("ru-RU")}.`
                  : "Смена карты, отмена и счета — на странице управления."}
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}
