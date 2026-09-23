import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { currentReader } from "@/lib/session";
import { effectivePlan, effectiveVoice } from "@/lib/lemon";
import { getCollectedLast24h, getSources } from "@/lib/queries";
import { cardCharsOf } from "@/lib/readers";
import {
  cardMinutes, flowSplit, formatDuration, itemsForMinutes, savedMinutes, streamMinutes,
} from "@/lib/reading-time";
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
 * Фраза стоит до сетки, а не подписью под ней. Пока объяснение лежало ниже,
 * первые секунды на экране работала загадка: две строки точек, и разбор их
 * значения там, куда глаз доходит последним. Картинка иллюстрирует
 * утверждение, а не загадывает его.
 *
 * Названо при этом отброшенное, а не только дошедшее. «Вышло 89, заказал
 * 10 минут, это ~18» — три факта и ни одного вывода; работа, ради которой
 * карточка стоит на странице, — это ~71 прочитанная и отброшенная новость,
 * и без своего числа её на экране просто нет.
 *
 * Клеток рисуется не больше двухсот: триста точек по четыре пикселя — это
 * уже шум, в котором двенадцать ярких не найти. Масштаб при этом честный —
 * доля сохраняется, и фраза называет оба числа полностью.
 */
function FlowGrid({
  collected,
  chars,
  digest,
  minutes,
  saved,
  t,
  time,
}: {
  collected: number;
  chars: number;
  digest: number;
  minutes: number;
  /** Выигрыш дня в минутах. Считает страница — он же стоит в заголовке. */
  saved: number;
  t: Dict["plans"]["about"];
  time: Dict["feed"]["time"];
}) {
  const CELLS = 200;
  // Клетки — это то, что вышло, и только оно. Считать их от максимума
  // из двух чисел значило рисовать сто клеток на пять новостей в тихий день:
  // сетка показывала бы размер выпуска, выдавая его за размер потока.
  const cells = Math.min(CELLS, Math.max(collected, 1));
  // Деление считает общая функция, а не страница: ту же арифметику проверяет
  // `npm test`, и вторая её копия здесь разошлась бы с проверенной молча.
  const { kept, dropped } = flowSplit(collected, digest);
  // Зажжённых не больше, чем всего: когда выпуск вмещает больше, чем вышло,
  // доля переваливает за единицу — и это значит «помещается всё», то есть
  // сетка горит целиком, а не больше, чем целиком.
  let lit = 0;
  if (collected > 0) {
    lit = Math.min(cells, Math.round((kept / collected) * cells));
    if (kept > 0) lit = Math.max(1, lit);
  }

  const minutesText = `${minutes} ${t.minutesWord(minutes)}`;

  return (
    <div className="flex flex-col gap-4">
      {/* В обычный день текста перед сеткой нет вовсе: выигрыш стоит
          заголовком карточки, и повторять его строкой ниже — значит
          сказать одно и то же дважды на площади в две строки.

          Строка остаётся там, где заголовок о выигрыше молчит. Меньше
          минуты экономии вслух не называется: в тихий день поток короче
          заказа, и «сэкономили ~0» — отчёт о работе, которой не было;
          тогда говорится, что вышло и сколько это времени. */}
      {saved >= 1 ? null : (
        <p className="text-sm">
          {collected > 0
            ? t.flowBasis(
                `${collected} ${t.newsWord(collected)}`,
                formatDuration(streamMinutes(chars), time),
                minutesText,
              )
            // Пустые сутки — не ноль в той же фразе: «вышло 0, заняло бы ~0»
            // отчитывается о работе, которой не было, там, где сказать надо
            // ровно это.
            : t.flowLeadEmpty(`${digest} ${t.newsWord(digest)}`, minutesText)}
        </p>
      )}
      {/* В пустые сутки сетки нет совсем, а не сетка из одной серой клетки:
          рисовать нечего, и пустая группа оставила бы на её месте двойной
          зазор — пробел, который читается поломкой вёрстки. */}
      {collected > 0 ? (
        <div className="flex flex-col gap-2">
          <div
            className="grid grid-cols-[repeat(auto-fill,minmax(8px,1fr))] gap-[3px]"
            aria-hidden
          >
            {Array.from({ length: cells }, (_, index) => (
              <span
                key={index}
                className={
                  index < lit
                    ? "aspect-square rounded-[2px] bg-signal"
                    : "aspect-square rounded-[2px] bg-foreground/[0.07]"
                }
              />
            ))}
          </div>
          {/* Легенда клетками того же вида, что в сетке: сказать «красные —
              это твой выпуск» словами значит попросить читателя сопоставить
              цвет с описанием цвета. Стоит она под сеткой, потому что
              переводит уже увиденное, а не готовит к нему.

              Контур — только у легендной клетки. В сетке тусклая клетка
              видна массой соседей, а поодиночке тот же фон на карточке
              неразличим: подпись «~71 отброшено» стояла бы рядом с пустым
              местом. */}
          {dropped > 0 ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 shrink-0 rounded-[2px] bg-signal" />
                <b className="font-medium tabular-nums text-foreground">{kept}</b> {t.flowKept}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 shrink-0 rounded-[2px] bg-foreground/[0.07] ring-1 ring-inset ring-foreground/15" />
                <b className="font-medium tabular-nums text-foreground">~{dropped}</b>{" "}
                {t.flowDropped}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
      {/* Ручка рядом с числом, а не в памяти читателя: время чтения живёт
          в «Интересах», и без ссылки «мало» или «много» упирается в то,
          что менять его надо вспомнить куда пойти. */}
      <Link
        href="/settings/interests"
        className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        {t.flowTune}
      </Link>
    </div>
  );
}

export default async function AboutPage() {
  const reader = await currentReader();
  const plan = effectivePlan(reader);
  // Словарь, каталог и мерка читателя не зависят друг от друга — одним
  // кругом; за сутками ходим уже по каталогу, сузив его тарифом.
  const [t, catalog, chars] = await Promise.all([getDict(), getSources(), cardCharsOf(reader.id)]);
  // Те же источники, что опрашивает прогон: картинка обязана считать
  // по тому, что читателю на его тарифе и правда собирают.
  const mine = sourcesForPlan(catalog, plan).map((source) => source.id);
  const { count: collected, chars: streamChars } = await getCollectedLast24h(mine);
  // Потолок тарифа, а не сохранённое число: после понижения `digest_minutes`
  // остаётся от прежнего тарифа, и картинка обещала бы час там, где доходит
  // пять минут — споря с карточкой ниже на этом же экране.
  const minutes = minutesCap(reader.digest_minutes, plan);
  // Клетки считаются в материалах: поток меряется штуками, и рисовать его
  // минутами значило бы сравнивать несравнимое. Перевод тот же, что в прогоне.
  const inDigest = itemsForMinutes(
    minutes, cardMinutes(chars, effectiveVoice(reader)), plan.maxItems,
  );

  // Выигрыш дня — то, ради чего карточка стоит на странице, поэтому он
  // и есть её заголовок. Молчит он только тогда, когда его нет: в тихий
  // день поток короче заказа, и заголовок возвращается к общему.
  const saved = savedMinutes(streamChars, minutes);

  // Следующий тариф, если он есть. На Pro предложения нет: продавать
  // то, что уже куплено, — это шум в разделе, который читают один раз.
  const next = PLAN_IDS.map((id) => PLANS[id]).find((entry) => entry.price > plan.price);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        {/* Карточка идёт в две колонки, а не заголовком с картинкой в углу:
            сложная гравюра при 64 пикселях превращается в кляксу — бренд
            просит для таких сцен ширину от 240, — а поставленная крупной
            в шапку, она растягивала строку заголовка и оставляла под ним
            полосу пустоты в полсотни пикселей.

            На узком экране колонки складываются, и гравюра уходит вниз:
            первым на экране отвечает число, ради которого сюда заходят,
            а не украшение над ним. */}
        <div className="flex flex-col gap-(--card-spacing) sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 flex-col gap-(--card-spacing)">
            <CardHeader>
              {/* Заголовок называет сегодняшнее число, а не тему раздела:
                  «~1 час 16 минут ты сэкономил сегодня» отвечает на вопрос,
                  с которым сюда заходят, прямо в самой крупной строке экрана.
                  Описания у карточки нет по той же причине — оно пересказывало
                  бы заголовок без чисел. */}
              <CardTitle>
                {saved >= 1
                  ? t.plans.about.heroSaved(formatDuration(saved, t.feed.time))
                  : t.plans.about.heroTitle}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FlowGrid
                collected={collected}
                chars={streamChars}
                digest={inDigest}
                minutes={minutes}
                saved={saved}
                t={t.plans.about}
                time={t.feed.time}
              />
            </CardContent>
          </div>
          {/* Гравюра «Коротко о главном» из бренд-серии: поток газет
              пересыпается в песочных часах в одну. Она ничего не добавляет
              к числам, поэтому `alt` пуст — всё, что она говорит, уже сказано
              заголовком и сеткой, и озвучивать её второй раз значит читать
              вслух украшение.

              Пара файлов, а не инверсия одной картинки: тушь в тёмной теме
              белая, а красный в обеих один и тот же — так серия и
              экспортируется. Переключает их класс темы, как у логотипа
              в шапке: сервер темы не знает, её ставит скрипт next-themes. */}
          <div className="shrink-0 self-center px-(--card-spacing) sm:pl-0">
            {/* eslint-disable @next/next/no-img-element */}
            <img
              src="/brand/illustrations/web/time-light.webp"
              alt=""
              width="384"
              height="384"
              className="block size-40 dark:hidden sm:size-44"
            />
            <img
              src="/brand/illustrations/web/time-dark.webp"
              alt=""
              width="384"
              height="384"
              className="hidden size-40 dark:block sm:size-44"
            />
            {/* eslint-enable @next/next/no-img-element */}
          </div>
        </div>
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

      {/* Внизу раздела, мелко: документы нужны раз в жизни, но искать их
          будут именно здесь — «О проекте». */}
      <nav className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground hover:underline">
          {t.plans.about.privacyLink}
        </Link>
        <Link href="/terms" className="hover:text-foreground hover:underline">
          {t.plans.about.termsLink}
        </Link>
      </nav>
    </div>
  );
}
