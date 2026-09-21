import { CheckIcon, CrownIcon, MinusIcon, SproutIcon, ZapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { checkoutUrl, endingAt } from "@/lib/lemon";
import { FEATURES, PLAN_IDS, PLANS, type FeatureId, type Plan, type PlanId } from "@/lib/plans";
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
  { feature: "digest", value: (plan) => `до ${plan.maxMinutes} мин` },
  { feature: "cadence", value: (plan) => (plan.everyDays <= 1 ? "каждый день" : "через день") },
  { feature: "delivery", value: (plan) => FEATURES.delivery.has(plan) },
  { feature: "posts", value: (plan) => FEATURES.posts.has(plan) },
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
        <CardTitle>Подписка</CardTitle>
        <CardDescription>
          От тарифа зависит, за сколькими источниками следит лента, сколько у тебя
          интересов и на сколько минут чтения выпуск.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-3 sm:grid-cols-3">
        {PLAN_IDS.map((id) => {
          const plan = PLANS[id];
          const Icon = ICONS[id];
          const mine = plan.id === current.id;
          const buy = plan.price > current.price ? checkoutUrl(id, reader.id) : null;
          // Понижение и смена карты живут у Lemon Squeezy: своего экрана
          // для них нет и не будет — это был бы второй набор состояний,
          // расходящийся с настоящим.
          const portal = reader.portal_url;
          // Состояние кнопки считается до разметки и именем: три вложенных
          // тернарника в JSX читаются только целиком, а состояний тут пять
          // и следующий тариф добавит шестое.
          const action: "manage" | "here" | "buy" | "unpaid" | "down" | "below" = mine
            ? portal ? "manage" : "here"
            : plan.price > current.price
              ? buy ? "buy" : "unpaid"
              : portal ? "down" : "below";

          return (
            <div
              key={id}
              className={cn(
                "flex flex-col gap-3 rounded-lg border p-4",
                // Свой тариф выделен тем же янтарным, каким помечено платное
                // по всему продукту: корона, замок и эта карточка — про одно.
                mine
                  ? "border-amber-400/70 bg-amber-50 dark:bg-amber-400/10"
                  : "border-border",
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
                {action === "manage" ? <Badge variant="secondary">Твой тариф</Badge> : null}
              </div>

              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-medium tabular-nums">${plan.price}</span>
                <span className="text-xs text-muted-foreground">в месяц</span>
              </div>

              {/* Зачем брать — над столбиком чисел: числа отвечают «сколько
                  дают», а решают по «зачем». */}
              <p className="text-sm font-medium">{plan.tagline}</p>

              <dl className="flex flex-col gap-1.5 text-sm">
                {ROWS.map(({ feature, value }) => (
                  <div key={feature} className="flex items-start justify-between gap-3">
                    <dt className="min-w-0">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              className="cursor-help text-left text-muted-foreground underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 hover:text-foreground"
                            />
                          }
                        >
                          {FEATURES[feature].title}
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">
                          {FEATURES[feature].what}
                        </TooltipContent>
                      </Tooltip>
                    </dt>
                    <dd className="shrink-0 whitespace-nowrap tabular-nums">
                      <Value value={value(plan)} />
                    </dd>
                  </div>
                ))}
              </dl>

              {/* Кнопка появляется только там, где ей есть куда вести:
                  «перейти» без настроенной оплаты — обещание без продукта. */}
              {action === "manage" ? (
                <Button size="sm" variant="outline" className="mt-auto" render={<a href={portal!} />}>
                  Управлять тарифом
                </Button>
              ) : action === "here" ? (
                <Button size="sm" variant="outline" className="mt-auto" disabled>
                  Твой тариф
                </Button>
              ) : action === "buy" ? (
                <Button size="sm" className="mt-auto" render={<a href={buy!} />}>
                  Перейти на «{plan.label}»
                </Button>
              ) : action === "unpaid" ? (
                // aria-disabled, а не disabled: выключенная кнопка
                // не показывает подсказку, и «не нажимается» остаётся
                // без причины — выглядит как поломка оплаты.
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="sm"
                        className="mt-auto cursor-default aria-disabled:opacity-50"
                        aria-disabled
                      />
                    }
                  >
                    Перейти на «{plan.label}»
                  </TooltipTrigger>
                  <TooltipContent>
                    Ссылка на оплату пока не настроена. Напиши боту
                  </TooltipContent>
                </Tooltip>
              ) : action === "down" ? (
                // Понижение — тоже переход, и вести ему есть куда: смену
                // тарифа принимает тот же портал. «Ниже твоего» сообщало
                // только, что кнопка не работает, и уйти с Pro было нечем.
                <div className="mt-auto flex flex-col gap-1.5">
                  <Button size="sm" variant="outline" render={<a href={portal!} />}>
                    Перейти на «{plan.label}»
                  </Button>
                  <span className="text-center text-[11px] leading-tight text-muted-foreground">
                    Изменится после оплаченного периода
                  </span>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="mt-auto" disabled>
                  Ниже твоего
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>

      {/* Технические пределы — мелким шрифтом и после цен: число карточек
          решает, сколько описаний мы напишем, а не сколько читатель получит
          времени. Обещание — минуты; штуки стоят здесь, чтобы «до 45 минут»
          не выглядело бездонным. Считаются из PLANS, как и всё выше. */}
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">
          Время считается по длине наших описаний, а не статей за ссылками.
          Технический предел выпуска —{" "}
          {PLAN_IDS.map((id) => PLANS[id].maxItems).join(" / ")} новостей
          соответственно: если важного за день меньше, выпуск будет короче
          заказанного, и лента скажет об этом прямо.
        </p>
      </CardContent>

      {/* Только состояние подписки: кнопка портала переехала в карточку
          своего тарифа — две одинаковые ссылки на одной странице заставляют
          выбирать между ними, хотя ведут они в одно место. */}
      {paying ? (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">
            {ends
              ? `Подписка отменена, тариф «${current.label}» работает до ${ends.toLocaleDateString("ru-RU")}.`
              : reader.subscription_status === "past_due"
                ? "Платёж не прошёл. Попробуем списать ещё раз"
                : reader.plan_renews_at
                  ? `Продлим ${new Date(reader.plan_renews_at).toLocaleDateString("ru-RU")}`
                  : "Смена карты, отмена и счета на странице управления"}
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}
