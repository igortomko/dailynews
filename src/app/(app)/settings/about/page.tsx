import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { currentReader } from "@/lib/session";
import { effectivePlan, effectiveVoice } from "@/lib/lemon";
import { getCollectedLast24h, getSources } from "@/lib/queries";
import { cardCharsOf } from "@/lib/readers";
import { cardMinutes, itemsForMinutes } from "@/lib/reading-time";
import { minutesCap, sourcesForPlan, PLAN_IDS, PLANS } from "@/lib/plans";
import { getDict } from "@/lib/i18n/server";
import type { Dict } from "@/lib/i18n";

/**
 * Единственная страница настроек без своих данных — и единственная, которую
 * сборка пыталась отрендерить заранее. Раскладка настроек с тех пор читает
 * тариф из базы, а базы при сборке образа нет: пререндер падал, и падала
 * вся сборка. Раскладка общая, значит и режим у страниц под ней общий.
 */
export const dynamic = "force-dynamic";

/**
 * Сетка потока: сколько собрано за сутки и сколько из этого дошло до тебя.
 *
 * Картинка, а не абзац: «из трёхсот остаётся двенадцать» словами читается
 * как оборот речи, а клетками — как соотношение. Отношение настоящее,
 * числа приходят из базы.
 *
 * Клеток рисуется не больше двухсот: триста точек по четыре пикселя — это
 * уже шум, в котором двенадцать ярких не найти. Масштаб при этом честный —
 * доля сохраняется, и подпись называет оба числа полностью.
 */
function FlowGrid({
  collected,
  digest,
  minutes,
  t,
}: {
  collected: number;
  digest: number;
  minutes: number;
  t: Dict["plans"]["about"];
}) {
  const CELLS = 200;
  // Клетки — это то, что вышло, и только оно. Считать их от максимума
  // из двух чисел значило рисовать сто клеток на пять новостей в тихий день:
  // сетка показывала бы размер выпуска, выдавая его за размер потока.
  const cells = Math.min(CELLS, Math.max(collected, 1));
  // Зажжённых не больше, чем всего: когда выпуск вмещает больше, чем вышло,
  // доля переваливает за единицу — и это значит «помещается всё», то есть
  // сетка горит целиком, а не больше, чем целиком.
  let lit = 0;
  if (collected > 0) {
    lit = Math.min(cells, Math.round((digest / collected) * cells));
    if (digest > 0) lit = Math.max(1, lit);
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(8px,1fr))] gap-[3px]"
        aria-hidden
      >
        {Array.from({ length: cells }, (_, index) => (
          <span
            key={index}
            className={
              index < lit
                ? "aspect-square rounded-[2px] bg-primary"
                : "aspect-square rounded-[2px] bg-foreground/[0.07]"
            }
          />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        <b className="font-medium text-foreground">
          {collected} {t.newsWord(collected)}
        </b>{" "}
        {t.flowIntro}{" "}
        <b className="font-medium text-foreground">
          {minutes} {t.minutesWord(minutes)}
        </b>{" "}
        {t.flowMiddle}{digest} {t.newsWord(digest)}.
      </p>
    </div>
  );
}

export default async function AboutPage() {
  const reader = await currentReader();
  const plan = effectivePlan(reader);
  const t = await getDict();
  // Те же источники, что опрашивает прогон: картинка обязана считать
  // по тому, что читателю на его тарифе и правда собирают.
  const mine = sourcesForPlan(await getSources(), plan).map((source) => source.id);
  const collected = await getCollectedLast24h(mine);
  // Потолок тарифа, а не сохранённое число: после понижения `digest_minutes`
  // остаётся от прежнего тарифа, и картинка обещала бы час там, где доходит
  // пять минут — споря с карточкой ниже на этом же экране.
  const minutes = minutesCap(reader.digest_minutes, plan);
  // Клетки считаются в материалах: поток меряется штуками, и рисовать его
  // минутами значило бы сравнивать несравнимое. Перевод тот же, что в прогоне.
  const inDigest = itemsForMinutes(
    minutes, cardMinutes(await cardCharsOf(reader.id), effectiveVoice(reader)), plan.maxItems,
  );

  // Следующий тариф, если он есть. На Pro предложения нет: продавать
  // то, что уже куплено, — это шум в разделе, который читают один раз.
  const next = PLAN_IDS.map((id) => PLANS[id]).find((entry) => entry.price > plan.price);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.plans.about.heroTitle}</CardTitle>
          <CardDescription>{t.plans.about.heroDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <FlowGrid collected={collected} digest={inDigest} minutes={minutes} t={t.plans.about} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.plans.about.stepsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <ol className="flex flex-col gap-3">
            {t.plans.about.steps.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{index + 1}</span>
                <span>
                  <b className="font-medium">{step.title}.</b>{" "}
                  <span className="text-muted-foreground">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {next ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.plans.about.upgradeTitle(t.plans.label[next.id])}</CardTitle>
            <CardDescription>
              {t.plans.about.currentSummary(
                t.plans.label[plan.id], plan.maxSources, plan.maxTopics, t.plans.topicsWord(plan.maxTopics),
                plan.maxMinutes,
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Числа считаются из PLANS, а не написаны руками: таблица,
                живущая отдельно от кода, который её применяет, расходится
                с ним молча — читатель видит одно обещание, упирается
                в другое. */}
            <dl className="flex flex-col gap-2 text-sm">
              {[
                { ...t.plans.about.compareRows[0], from: plan.maxSources, to: next.maxSources },
                { ...t.plans.about.compareRows[1], from: plan.maxTopics, to: next.maxTopics },
                { ...t.plans.about.compareRows[2], from: plan.maxMinutes, to: next.maxMinutes },
              ].map(({ label, from, to, why }) => (
                <div key={label} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-medium">{label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {String(from)} → <b className="font-medium text-foreground">{String(to)}</b>
                  </span>
                  <span className="text-muted-foreground">{why}</span>
                </div>
              ))}
              {!plan.kinds.includes("x") && next.kinds.includes("x") ? (
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium">{t.plans.feature.x.title}</span>
                  <span className="text-muted-foreground">
                    {t.plans.about.xOnlyHere}
                  </span>
                </div>
              ) : null}
            </dl>

            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" render={<Link href="/settings/subscription" />}>
                {t.plans.about.viewPlans}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
              <span className="text-sm text-muted-foreground">
                {t.plans.about.priceLine(t.plans.label[next.id], next.price)}
              </span>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
