import { redirect } from "next/navigation";
import { getDigestDays, getFeed } from "@/lib/queries";
import { getReaderTopics } from "@/lib/readers";
import { currentReader } from "@/lib/session";
import { FeedTabs } from "@/components/feed-tabs";
import Link from "next/link";
import { SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  const [{ day: requested }, days, topics] = await Promise.all([
    searchParams,
    getDigestDays(reader.id),
    getReaderTopics(reader.id),
  ]);

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
      left={<DateNav day={day} days={days} />}
      right={
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
      }
    />
  );
}
