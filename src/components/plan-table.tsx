import { CheckIcon, CrownIcon, MinusIcon, SproutIcon, ZapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { checkoutUrl, endingAt, trialDaysFor, yearlyReady, type Cycle } from "@/lib/billing";
import { FEATURES, PLAN_IDS, PLANS, type FeatureId, type Plan, type PlanId } from "@/lib/plans";
import type { Reader } from "@/lib/types";
import { changePlanAction } from "@/lib/actions";
import { currentLocale, getDict } from "@/lib/i18n/server";
import { featureWhat, type Dict } from "@/lib/i18n";

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

export function Value({ value, yes, no }: { value: string | boolean; yes: string; no: string }) {
  if (typeof value === "string") return <>{value}</>;
  return value ? (
    <CheckIcon className="size-4" aria-label={yes} />
  ) : (
    <MinusIcon className="size-4 text-muted-foreground/50" aria-label={no} />
  );
}

/**
 * Строки сравнения: одна формула на «Подписку» и на открытую страницу цен.
 * Порядок — от того, что считается глазами, к тому, что включается.
 */
export const planRows = (t: Dict): { feature: FeatureId; value: (plan: Plan) => string | boolean }[] => [
  { feature: "sources", value: (plan) => String(plan.maxSources) },
  { feature: "topics", value: (plan) => String(plan.maxTopics) },
  { feature: "digest", value: (plan) => t.plans.table.upToMinutes(plan.maxMinutes) },
  {
    // Числом, а не галочкой: между тарифами разница количественная,
    // и «да» одинаково выглядело бы у двух карточек и у десяти.
    feature: "rich",
    value: (plan) => (plan.richCards > 0 ? t.plans.table.richCards(plan.richCards) : false),
  },
  {
    feature: "cadence",
    value: (plan) => (plan.everyDays <= 1 ? t.plans.table.dailyCadence : t.plans.table.everyOtherCadence),
  },
  {
    feature: "audio",
    // Минутами, а не галочкой: разница между тарифами здесь
    // количественная, и «да/нет» о ней не говорит.
    value: (plan) =>
      plan.audioSecondsPerDay > 0
        ? t.plans.table.audioPerDay(Math.floor(plan.audioSecondsPerDay / 60))
        : false,
  },
  { feature: "delivery", value: (plan) => FEATURES.delivery.has(plan) },
  { feature: "posts", value: (plan) => FEATURES.posts.has(plan) },
  { feature: "x", value: (plan) => plan.kinds.includes("x") },
  { feature: "personalization", value: (plan) => FEATURES.personalization.has(plan) },
];

export async function PlanTable({
  reader, current, cycle = "month",
}: {
  reader: Reader;
  current: Plan;
  /** Период из адреса (`?cycle=year`): таблица серверная, и переключатель — ссылки. */
  cycle?: Cycle;
}) {
  const t = await getDict();
  // Дата отмены/продления форматируется под язык интерфейса, а не всегда
  // по-русски: иначе на английском экране число выглядело бы чужим форматом
  // рядом со своим текстом.
  const dateLocale = (await currentLocale()) === "ru" ? "ru-RU" : "en-US";
  const ends = endingAt(reader);
  const paying = Boolean(reader.subscription_id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.plans.table.title}</CardTitle>
        <CardDescription>{t.plans.table.description}</CardDescription>
      </CardHeader>

      <CardContent>
        <PlanCards t={t} reader={reader} current={current} cycle={cycle} cycleHref={{ month: "?", year: "?cycle=year" }} />
      </CardContent>

      {/* Только состояние подписки: кнопка портала переехала в карточку
          своего тарифа — две одинаковые ссылки на одной странице заставляют
          выбирать между ними, хотя ведут они в одно место. */}
      {paying ? (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">
            {ends
              ? t.plans.table.cancelledUntil(t.plans.label[current.id], ends.toLocaleDateString(dateLocale))
              : reader.subscription_status === "past_due"
                ? t.plans.table.pastDue
                : reader.plan_renews_at
                  ? t.plans.table.renews(new Date(reader.plan_renews_at).toLocaleDateString(dateLocale))
                  : t.plans.table.manageElsewhere}
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

/**
 * Переключатель периода, карточки тарифов и технический предел — одни
 * на «Подписку» и на открытую страницу цен. Две разметки одних и тех же
 * тарифов разошлись бы на первой же правке: цена, триал или строка
 * поменялись бы в одной и остались прежними в другой.
 *
 * Серверный компонент, и переключатель — ссылки (`cycleHref`): период
 * живёт в адресе, и выбранный «за год» переживает перезагрузку.
 */
export function PlanCards({
  t, reader, current, cycle, cycleHref,
}: {
  t: Dict;
  /** Нет — гость: кнопки ведут во вход и в оплату, своего тарифа не отмечено. */
  reader: Reader | null;
  current: Plan | null;
  cycle: Cycle;
  cycleHref: Record<Cycle, string>;
}) {
  const ROWS = planRows(t);
  const paid = PLAN_IDS.filter((id) => PLANS[id].price > 0);
  // Наименьшая скидка: «−25%» на переключателе обещал бы Pro больше,
  // чем у него выходит.
  const save = Math.min(...paid.map((id) => Math.round((1 - PLANS[id].yearPrice / (PLANS[id].price * 12)) * 100)));

  return (
    <div className="flex flex-col gap-4">
      {yearlyReady() ? (
          <div role="radiogroup" className="flex w-fit gap-1 rounded-lg border bg-muted p-1 text-sm">
            {(["month", "year"] as const).map((value) => (
              <Link
                key={value}
                href={cycleHref[value]}
                scroll={false}
                replace
                role="radio"
                aria-checked={cycle === value}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors",
                  cycle === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {value === "month" ? t.plans.pricing.monthly : t.plans.pricing.yearly}
                {value === "year" ? (
                  <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-400/20 dark:text-amber-200">
                    {t.plans.pricing.save(save)}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {PLAN_IDS.map((id) => {
          const plan = PLANS[id];
          const Icon = ICONS[id];
          const label = t.plans.label[id];
          // Гость (страница цен без входа) своего тарифа не имеет: бесплатный
          // зовёт войти, платные — в оплату, а proxy уведёт на вход сам.
          const guest = !reader || !current;
          const mine = !guest && plan.id === current.id;
          const buy = guest
            ? plan.price > 0 ? checkoutUrl(id, cycle) ?? "/login" : null
            : plan.price > current.price ? checkoutUrl(id, cycle) : null;
          const year = cycle === "year" && plan.price > 0;
          // Понижение и смена карты живут в портале Paddle: своего экрана
          // для них нет и не будет — это был бы второй набор состояний,
          // расходящийся с настоящим. Ссылка портала одноразовая, поэтому
          // кнопка ведёт на наш адрес, который выдаёт свежую на нажатие.
          const portal = reader?.subscription_id ? "/api/billing/portal" : null;
          // Уже платит — любой переход правит ту же подписку (`changePlan`):
          // новое окно оплаты завело бы вторую, и списывались бы обе.
          const live = !guest && ["active", "trialing", "past_due"].includes(reader.subscription_status ?? "");
          const ending = live && endingAt(reader) !== null;
          // Состояние кнопки считается до разметки и именем: три вложенных
          // тернарника в JSX читаются только целиком, а состояний тут семь.
          const action: "start" | "manage" | "resume" | "here" | "switch" | "buy" | "unpaid" | "below" = guest
            ? plan.price > 0 ? "buy" : "start"
            : mine
            ? ending ? "resume" : portal ? "manage" : "here"
            : live
              ? "switch"
              : plan.price > current.price
                ? buy ? "buy" : "unpaid"
                : "below";
          // Что случится с деньгами — строкой под кнопкой смены, до нажатия.
          const switchNote = !live || mine ? null
            : plan.price <= 0 ? t.plans.table.toFreeNote
            : plan.price > current.price
              ? reader.subscription_status === "trialing" ? t.plans.table.upgradeTrialNote : t.plans.table.upgradeNote
              : t.plans.table.downgradeNote;

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
                  {label}
                </span>
                {action === "manage" ? <Badge variant="secondary">{t.plans.table.yourPlan}</Badge> : null}
              </div>

              {/* За год крупно — цена в месяц, строкой под ней — сумма раз в год,
                  как на странице цен: платят раз в год, а сравнивают помесячно. */}
              <div className="flex flex-col">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-medium tabular-nums">
                    ${year ? (plan.yearPrice / 12).toFixed(2) : plan.price}
                  </span>
                  <span className="text-xs text-muted-foreground">{t.plans.table.perMonth}</span>
                </div>
                {cycle === "year" ? (
                  <span className={cn("text-xs text-muted-foreground", !year && "invisible")}>
                    {year ? t.plans.pricing.billedYearly(plan.yearPrice) : "\u00a0"}
                  </span>
                ) : null}
              </div>

              {/* Зачем брать — над столбиком чисел: числа отвечают «сколько
                  дают», а решают по «зачем». */}
              <p className="text-sm font-medium">{t.plans.tagline[id]}</p>

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
                          {t.plans.feature[feature].title}
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">
                          {featureWhat(t, feature)}
                        </TooltipContent>
                      </Tooltip>
                    </dt>
                    <dd className="shrink-0 whitespace-nowrap tabular-nums">
                      <Value value={value(plan)} yes={t.plans.table.hasFeature} no={t.plans.table.noFeature} />
                    </dd>
                  </div>
                ))}
              </dl>

              {/* Кнопка появляется только там, где ей есть куда вести:
                  «перейти» без настроенной оплаты — обещание без продукта. */}
              {action === "start" ? (
                <Button size="sm" variant="outline" className="mt-auto" render={<a href="/login" />}>
                  {t.plans.pricing.start}
                </Button>
              ) : action === "manage" ? (
                <Button size="sm" variant="outline" className="mt-auto" render={<a href={portal!} />}>
                  {t.plans.table.manage}
                </Button>
              ) : action === "here" ? (
                <Button size="sm" variant="outline" className="mt-auto" disabled>
                  {t.plans.table.yourPlan}
                </Button>
              ) : action === "buy" ? (
                // Триал называется на кнопке, а цена — строкой под ней:
                // на вопрос «сколько это стоит» отвечает сначала «нисколько
                // неделю», и только потом настоящая цена. Молчащий триал
                // не существует — по нему некому нажать. А если его
                // у этого варианта не завели, надписи нет вовсе: обещать
                // бесплатную неделю там, где Paddle сразу попросит денег,
                // значит соврать ровно тому, кто поверил.
                <div className="mt-auto flex flex-col gap-1.5">
                  <Button size="sm" render={<a href={buy!} />}>
                    {trialDaysFor(id) > 0
                      ? t.plans.table.tryFree(trialDaysFor(id))
                      : t.plans.moveTo(label)}
                  </Button>
                  {trialDaysFor(id) > 0 ? (
                    <span className="text-center text-[11px] leading-tight text-muted-foreground">
                      {year ? t.plans.pricing.thenPerYear(plan.yearPrice) : t.plans.table.thenPerMonth(plan.price)}
                    </span>
                  ) : null}
                </div>
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
                    {t.plans.moveTo(label)}
                  </TooltipTrigger>
                  <TooltipContent>
                    {t.plans.table.checkoutNotReady}
                  </TooltipContent>
                </Tooltip>
              ) : action === "switch" || action === "resume" ? (
                // Форма, а не ссылка: смена тарифа — действие на сервере
                // над подпиской этого читателя, номер подписки из формы не берётся.
                <form action={changePlanAction} className="mt-auto flex flex-col gap-1.5">
                  <input type="hidden" name="plan" value={id} />
                  <input type="hidden" name="cycle" value={cycle} />
                  <Button type="submit" size="sm" variant={action === "resume" || plan.price > current!.price ? "default" : "outline"}>
                    {action === "resume" ? t.plans.table.resume : t.plans.moveTo(label)}
                  </Button>
                  {switchNote ? (
                    <span className="text-center text-[11px] leading-tight text-muted-foreground">{switchNote}</span>
                  ) : null}
                </form>
              ) : (
                <Button size="sm" variant="outline" className="mt-auto" disabled>
                  {t.plans.table.belowYours}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
