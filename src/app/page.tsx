import { redirect } from "next/navigation";
import { getFeed, getProfile, getTopics } from "@/lib/queries";
import { FeedTabs } from "@/components/feed-tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const profile = await getProfile();
  if (!profile?.onboarded_at) redirect("/interests");

  const [topics, items] = await Promise.all([getTopics(), getFeed()]);

  if (items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Ещё ни одного дайджеста</EmptyTitle>
          <EmptyDescription>
            Прогон идёт раз в сутки. Чтобы собрать ленту прямо сейчас, запусти
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">npm run pipeline</code>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return <FeedTabs topics={topics} items={items} />;
}
