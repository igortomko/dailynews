import { redirect } from "next/navigation";
import { getDigestDays, getFeed, getStories } from "@/lib/queries";
import { isDay } from "@/lib/day";
import { CLICKBAIT_LABEL_NOUL } from "@/lib/types";
import { digestProgress, getChannels, getReaderTopics, readerSources } from "@/lib/readers";
import { currentReader } from "@/lib/session";
import { effectivePlan, effectiveVoice } from "@/lib/lemon";
import { sourcesForPlan } from "@/lib/plans";
import { minutesOf } from "@/lib/reading-time";
import { tabsOf } from "@/lib/networks";
import { FeedTabs } from "@/components/feed-tabs";
import Link from "next/link";
import { SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DateNav } from "@/components/date-nav";
import { CollectNow } from "@/components/collect-now";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export const dynamic = "force-dynamic";

export default async function FeedPage({
  searchParams,
}: {
  // Повторённый параметр приезжает массивом (урок поиска): объявить его
  // строкой значит отдать массив в запрос и получить 500 вместо ленты.
  searchParams: Promise<{ day?: string | string[] }>;
}) {
  // Чья это лента, решает подписанная кука и ничто другое.
  const reader = await currentReader();
  // Первый заход идёт своим путём: интересы, источники, первый выпуск.
  if (!reader.onboarded_at) redirect("/welcome");

  const { day: param } = await searchParams;
  // Похожее на день, но не день («2026-02-31», пустая строка, массив) —
  // это null, то есть последний выпуск: в запрос день уходит кастом к date,
  // и непроверенная строка из чужой ссылки роняла бы страницу.
  const requested = isDay(param) ? param : null;
  // Всё одним кругом до базы, включая сам выпуск: раньше лента ждала список
  // дней, чтобы проверить запрошенный, и только потом шла за выпуском —
  // лишний круг на каждом показе ради ссылки на день, которого нет. Теперь
  // выпуск спрашивается сразу за запрошенный день (null — за последний),
  // а день сверяется со списком уже по пришедшему: не сошёлся — второй
  // запрос, и платит за него только чужая ссылка на день без выпуска.
  //
  // Выпуск и заказ стоят первыми: соединений в пуле пять, запросов шесть,
  // и в очереди оказывается написанный последним — пусть это будет список
  // площадок, а не сама лента.
  const [asked, askedDigest, days, topics, sources, channels] = await Promise.all([
    getFeed(reader.id, requested),
    // Время и заказ — по самому выпуску, а не по тому, что осталось видимым:
    // лента прячет скрытое пальцем вниз, и выпуск, из которого читатель убрал
    // три карточки, объявлял бы себя недобранным. Заказ берётся того дня,
    // а не сегодняшний: лента листается на девяносто дней назад.
    digestProgress(reader.id, requested),
    getDigestDays(reader.id),
    getReaderTopics(reader.id),
    readerSources(reader.id),
    getChannels(reader.id),
  ]);
  // Действующий, а не купленный: у отменённой подписки оплаченный месяц
  // дочитывается, и кнопка обязана жить ровно столько же, сколько предел.
  const plan = effectivePlan(reader);
  const networks = tabsOf(channels.map((channel) => channel.network)).map((network) => network.id);

  if (days.length === 0) {
    return (
      <Empty className="mx-auto max-w-page">
        <EmptyHeader>
          <EmptyTitle>Первый выпуск придёт ночью</EmptyTitle>
          <EmptyDescription>
            {/* Читателю — когда ждать и чем занять это время. Команда
                в терминал — инструкция разработчику, и показывать её всем
                значит отвечать на вопрос «что делать» тем, чего человек
                сделать не может. Владельцу она остаётся: он-то может. */}
            Лента собирается раз в сутки, ночью. Пока можно{" "}
            <Link href="/settings/interests" className="underline underline-offset-4">
              поправить интересы
            </Link>{" "}
            или{" "}
            <Link href="/settings/sources" className="underline underline-offset-4">
              добавить источники
            </Link>
            .
            {reader.owner ? (
              <span className="mt-2 block">
                Собрать прямо сейчас:
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">npm run pipeline</code>
              </span>
            ) : null}
          </EmptyDescription>
        </EmptyHeader>
        {/* Ждать до ночи необязательно: сбор и оценка общие на всех
            и уже прошли, не хватает только письма описаний. Кнопка зовёт
            ту же догрузку, что и смена числа новостей, — и так же не умеет
            обойти ни потолок тарифа, ни дневной предел. */}
        <CollectNow />
      </Empty>
    );
  }

  // Запрошенный день принимается, только если выпуск за него есть:
  // иначе адрес из чужой ссылки открывает пустую страницу без объяснения.
  const known = requested === null || days.includes(requested);
  const day = known && requested ? requested : days[0];
  const [feed, digest] = known
    ? [asked, askedDigest]
    : await Promise.all([getFeed(reader.id, day), digestProgress(reader.id, day)]);
  const minutes = minutesOf(digest.chars, effectiveVoice(reader));

  // Сюжет карточки считается по тем же источникам, по которым собран выпуск:
  // тариф уже учтён, и «твои источники» в раскрытии значит ровно то же, что
  // в отборе. Список приезжает отдельным запросом и приклеивается здесь —
  // Map через границу сервера не уходит, а сорок карточек не должны
  // спрашивать базу по одной.
  //
  // Плюс источники самих показанных карточек. Выпуск написан раньше, а набор
  // источников с тех пор мог измениться — читатель убрал один или понизил
  // тариф, и `digest_items` от этого не чистится. Без объединения карточка
  // осталась бы в ленте, но выпала бы из собственного сюжета: раскрытие
  // показало бы только чужих и пометило бы чужой повтор первоисточником.
  // Ничего лишнего это не открывает — сама карточка уже на странице.
  //
  // Number: sources.id приезжает из bigint строкой, а сюжет считает числами.
  const mine = sourcesForPlan(sources, plan).map((source) => Number(source.id));
  const shown = feed.map((item) => item.source_id);
  const stories = await getStories([...new Set([...mine, ...shown])], feed.map((item) => item.id));
  // Оси остаются на сервере: карточке нужен один ответ — кликбейт ли это.
  const items = feed.map(({ axes, ...item }) => ({
    ...item,
    clickbait: (axes?.clickbait?.noul ?? 0) > CLICKBAIT_LABEL_NOUL,
    story: stories.get(item.id) ?? [],
  }));

  return (
    <FeedTabs
      topics={topics}
      items={items}
      plan={plan}
      networks={networks}
      // Заказ отдаём только для последнего выпуска: фраза недобора говорит
      // «сегодня больше действительно важного нет», и на выпуске недельной
      // давности она рассказывала бы про сегодня, глядя на позавчера.
      reading={{ minutes, target: day === days[0] ? digest.target : null }}
      // key на элементах, уезжающих в проп: шапка ленты ставит left и right
      // соседями, а элемент, приехавший сюда через полезную нагрузку сервера,
      // теряет пометку «детей ровно столько, сколько написано». React считает
      // пару списком и просит ключ — в консоли это выглядит как настоящая
      // ошибка в ленте и прячет собой те, что ошибки и есть.
      left={<DateNav key="date" day={day} days={days} />}
      right={
        // Тема и настройки — одна пара: и то и другое про то, как выглядит
        // и работает лента, а не про сам выпуск.
        <div key="actions" className="flex items-center gap-2">
        <ThemeToggle className="size-10 sm:size-8 [&_svg]:size-5 sm:[&_svg]:size-4" />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                nativeButton={false}
                variant="ghost"
                size="icon-sm"
                aria-label="Настройки"
                className="size-10 text-muted-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground sm:size-8 [&_svg]:size-5 sm:[&_svg]:size-4"
                // Настройки подгружаются заранее, пока читают ленту: страница
                // динамическая, и без этого каждое нажатие на шестерёнку ждало
                // бы сервер. Раскладка и первый раздел — это один запрос
                // о читателе, дёшево.
                render={<Link href="/settings/personalization" prefetch={true} />}
              />
            }
          >
            <SettingsIcon />
          </TooltipTrigger>
          <TooltipContent>Настройки: интересы, источники, доставка</TooltipContent>
        </Tooltip>
        </div>
      }
    />
  );
}
