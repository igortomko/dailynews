import { redirect } from "next/navigation";
import { getDigestDays, getFeed } from "@/lib/queries";
import { getChannels, getReaderTopics } from "@/lib/readers";
import { currentReader } from "@/lib/session";
import { effectivePlan, effectiveVoice } from "@/lib/lemon";
import { minutesCap } from "@/lib/plans";
import { digestMinutes } from "@/lib/reading-time";
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
  searchParams: Promise<{ day?: string }>;
}) {
  // Чья это лента, решает подписанная кука и ничто другое.
  const reader = await currentReader();
  // Первый заход идёт своим путём: интересы, источники, первый выпуск.
  if (!reader.onboarded_at) redirect("/welcome");

  const [{ day: requested }, days, topics, channels] = await Promise.all([
    searchParams,
    getDigestDays(reader.id),
    getReaderTopics(reader.id),
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
  const day = requested && days.includes(requested) ? requested : days[0];
  const items = await getFeed(reader.id, day);

  // Время считается по тому же тексту, который читатель и читает: заголовок
  // и описание из выпуска, а не статья за ссылкой. Потолок тарифа поверх
  // заказа — тот же, что применял прогон: иначе на экране стояло бы «19 из 45»
  // у читателя, которому положено двадцать.
  const minutes = digestMinutes(
    items.map((item) => ({ title: item.title_ru ?? item.title, summary: item.summary })),
    effectiveVoice(reader),
  );

  return (
    <FeedTabs
      topics={topics}
      items={items}
      plan={plan}
      networks={networks}
      reading={{ minutes, target: minutesCap(reader.digest_minutes, plan) }}
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
                render={<Link href="/settings/personalization" />}
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
