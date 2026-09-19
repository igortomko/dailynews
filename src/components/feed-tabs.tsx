"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ItemCard } from "@/components/item-card";
import type { FeedItem } from "@/lib/queries";
import type { Topic } from "@/lib/types";

export function FeedTabs({ topics, items }: { topics: Topic[]; items: FeedItem[] }) {
  // «Прочее» показывается вкладкой только если туда что-то попало: пустая
  // вкладка сообщает о системе, а не о новостях.
  const hasOther = items.some((item) => !item.topic_slug);
  const tabs = [
    { slug: "all", label: "Все", count: items.length },
    ...topics.map((topic) => ({
      slug: topic.slug,
      label: topic.label,
      count: items.filter((item) => item.topic_slug === topic.slug).length,
    })),
    ...(hasOther ? [{ slug: "other", label: "Прочее", count: items.filter((i) => !i.topic_slug).length }] : []),
  ];

  const forTab = (slug: string) =>
    slug === "all"
      ? items
      : slug === "other"
        ? items.filter((item) => !item.topic_slug)
        : items.filter((item) => item.topic_slug === slug);

  return (
    <Tabs defaultValue="all" className="flex flex-col gap-4">
      <TabsList className="w-full justify-start overflow-x-auto">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.slug} value={tab.slug}>
            {tab.label}
            <span className="ml-1.5 text-xs text-muted-foreground">{tab.count}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => {
        const list = forTab(tab.slug);
        return (
          <TabsContent key={tab.slug} value={tab.slug} className="flex flex-col">
            {list.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Пока пусто</EmptyTitle>
                  <EmptyDescription>
                    По этой теме за последние две недели ничего не прошло отбор.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              list.map((item) => (
                <ItemCard key={`${item.day}-${item.id}`} item={item} showTopic={tab.slug === "all"} />
              ))
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
