import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { currentReader } from "@/lib/session";
import { effectivePlan } from "@/lib/lemon";
import { getCollectedLast24h, getSources } from "@/lib/queries";
import { newsWord } from "@/lib/telegram";
import { digestCap, maxDigestOf, sourcesForPlan, topicsWord, PLAN_IDS, PLANS } from "@/lib/plans";

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
function FlowGrid({ collected, digest }: { collected: number; digest: number }) {
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
          {collected} {newsWord(collected)}
        </b>{" "}
        вышло за сутки у твоих источников. В выпуск помещается{" "}
        <b className="font-medium text-foreground">{digest}</b>.
      </p>
    </div>
  );
}

export default async function AboutPage() {
  const reader = await currentReader();
  const plan = effectivePlan(reader);
  // Те же источники, что опрашивает прогон: картинка обязана считать
  // по тому, что читателю на его тарифе и правда собирают.
  const mine = sourcesForPlan(await getSources(), plan).map((source) => source.id);
  const collected = await getCollectedLast24h(mine);
  // Потолок тарифа, а не сохранённое число: после понижения `digest_size`
  // остаётся от прежнего тарифа, и картинка обещала бы сотню там, где
  // доходит десяток — споря с карточкой ниже на этом же экране.
  const inDigest = digestCap(reader.digest_size, plan);

  // Следующий тариф, если он есть. На Pro предложения нет: продавать
  // то, что уже куплено, — это шум в разделе, который читают один раз.
  const next = PLAN_IDS.map((id) => PLANS[id]).find((entry) => entry.price > plan.price);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Каждое утро только то, что стоит прочитать</CardTitle>
          <CardDescription>
            Лента читает за тебя всё, что вышло у твоих источников, и оставляет
            столько новостей, сколько ты просил.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FlowGrid collected={collected} digest={inDigest} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Как выходит именно столько</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <ol className="flex flex-col gap-3">
            {[
              [
                "Читаем всё",
                "Каждый сайт, блог и канал из твоего списка, целиком и без пропусков. Популярное и обсуждаемое сюда не попадает: списки составляешь ты.",
              ],
              [
                "Спрашиваем про каждую новость одно и то же",
                "Событие это или пересказ старого. Есть ли цифры и названный источник. Надолго ли это. Честен ли заголовок. Вопросы у всех новостей одни и те же, поэтому ответы можно сравнивать.",
              ],
              [
                "Делим выпуск между твоими интересами",
                "Берём лучшее по каждому интересу, потом вторые по каждому. Иначе самая шумная тема забрала бы выпуск целиком: энергетика однажды взяла 8 мест из 12.",
              ],
              [
                "Пересказываем твоим языком",
                "Заголовок называет, что изменилось; описание начинается там, где заголовок закончил. Язык, сложность и манера такие, как ты выбрал.",
              ],
            ].map(([title, text], index) => (
              <li key={title} className="flex gap-3">
                <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{index + 1}</span>
                <span>
                  <b className="font-medium">{title}.</b>{" "}
                  <span className="text-muted-foreground">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {next ? (
        <Card>
          <CardHeader>
            <CardTitle>Что меняется на «{next.label}»</CardTitle>
            <CardDescription>
              Сейчас у тебя «{plan.label}»: {plan.maxSources} источников,{" "}
              {plan.maxTopics} {topicsWord(plan.maxTopics)}, до {maxDigestOf(plan)} новостей
              в выпуске.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Числа считаются из PLANS, а не написаны руками: таблица,
                живущая отдельно от кода, который её применяет, расходится
                с ним молча — читатель видит одно обещание, упирается
                в другое. */}
            <dl className="flex flex-col gap-2 text-sm">
              {[
                ["Источников", plan.maxSources, next.maxSources, "шире выбор, из которого собирается выпуск"],
                ["Интересов", plan.maxTopics, next.maxTopics, "больше тем, между которыми делится выпуск"],
                ["Новостей в выпуске", maxDigestOf(plan), maxDigestOf(next), "хватит и на кофе, и на весь день"],
              ].map(([label, from, to, why]) => (
                <div key={String(label)} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-medium">{label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {String(from)} → <b className="font-medium text-foreground">{String(to)}</b>
                  </span>
                  <span className="text-muted-foreground">— {why}</span>
                </div>
              ))}
              {!plan.kinds.includes("x") && next.kinds.includes("x") ? (
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium">Посты из X</span>
                  <span className="text-muted-foreground">
                    X берёт деньги за доступ, поэтому они только здесь
                  </span>
                </div>
              ) : null}
            </dl>

            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" render={<Link href="/settings/subscription" />}>
                Посмотреть тарифы
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
              <span className="text-sm text-muted-foreground">
                «{next.label}», ${next.price} в месяц
              </span>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
