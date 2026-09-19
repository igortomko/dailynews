import { redirect } from "next/navigation";
import { getDigestDays, getFeed, getProfile, getTopics } from "@/lib/queries";
import { FeedTabs } from "@/components/feed-tabs";
import Link from "next/link";
import { SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateNav } from "@/components/date-nav";
import { PageHeader } from "@/components/page-header";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export const dynamic = "force-dynamic";

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const profile = await getProfile();
  if (!profile?.onboarded_at) redirect("/settings/personalization");

  const [{ day: requested }, days, topics] = await Promise.all([
    searchParams,
    getDigestDays(),
    getTopics(),
  ]);

  if (days.length === 0) {
    return (
      <Empty className="mx-auto max-w-3xl">
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
  const items = await getFeed(day);

  return (
    <>
      <PageHeader
        left={<DateNav day={day} days={days} />}
        right={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Настройки"
            className="text-muted-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground"
            render={<Link href="/settings/personalization" />}
          >
            <SettingsIcon />
          </Button>
        }
      />
      <div className="mx-auto max-w-3xl px-4 py-4 sm:py-6">
        <div className="rounded-xl border bg-card px-4 py-2 sm:px-6">
          <FeedTabs topics={topics} items={items} />
        </div>
      </div>
    </>
  );
}
