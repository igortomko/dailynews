import { redirect } from "next/navigation";
import { getDigestDays, getFeed } from "@/lib/queries";
import { getChannels, getReaderTopics } from "@/lib/readers";
import { currentReader } from "@/lib/session";
import { effectivePlan } from "@/lib/lemon";
import { tabsOf } from "@/lib/networks";
import { FeedTabs } from "@/components/feed-tabs";
import Link from "next/link";
import { SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DateNav } from "@/components/date-nav";
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
          <EmptyTitle>Ещё ни одного выпуска</EmptyTitle>
          <EmptyDescription>
            Прогон идёт раз в сутки. Собрать прямо сейчас:
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">npm run pipeline</code>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // Запрошенный день принимается, только если выпуск за него есть:
  // иначе адрес из чужой ссылки открывает пустую страницу без объяснения.
  const day = requested && days.includes(requested) ? requested : days[0];
  const items = await getFeed(reader.id, day);

  return (
    <FeedTabs
      topics={topics}
      items={items}
      plan={plan}
      networks={networks}
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
