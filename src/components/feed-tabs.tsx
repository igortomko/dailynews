"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ItemCard } from "@/components/item-card";
import type { FeedItem } from "@/lib/queries";
import type { Topic } from "@/lib/types";

export function FeedTabs({
  topics,
  items,
  left,
  right,
}: {
  topics: Topic[];
  items: FeedItem[];
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  // «Прочее» показывается вкладкой, только если туда что-то попало: пустая
  // вкладка сообщает о системе, а не о новостях.
  const hasOther = items.some((item) => !item.topic_slug);
  const tabs = [
    { slug: "all", label: "Все", count: items.length },
    ...topics.map((topic) => ({
      slug: topic.slug,
      label: topic.label,
      count: items.filter((item) => item.topic_slug === topic.slug).length,
    })),
    ...(hasOther
      ? [{ slug: "other", label: "Прочее", count: items.filter((item) => !item.topic_slug).length }]
      : []),
  ];

  const forTab = (slug: string) =>
    slug === "all"
      ? items
      : slug === "other"
        ? items.filter((item) => !item.topic_slug)
        : items.filter((item) => item.topic_slug === slug);

  return (
    <Tabs defaultValue="all">
      {/* Шапка живёт внутри Tabs: полоса вкладок и содержимое должны быть
          в одном корне, иначе переключение их не связывает.
          Дата и настройки — по краям экрана, а не по колонке текста:
          управление лентой относится ко всей странице. Вкладки под ними
          по центру; когда не помещаются, начинают прокручиваться —
          семь тем по-русски не влезают ни в какую ширину. */}
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="flex h-12 items-center justify-between gap-3 px-4">
          {left}
          {right}
        </div>
        <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]">
          {/* Штатный вариант line: подчёркивание в два пикселя через ::after.
              Самодельные рамки здесь не годились — состояние называется
              data-active, и перекрытия по data-[state=active] не совпадали,
              отчего под активной вкладкой оставалась плашка. */}
          <TabsList variant="line" className="mx-auto h-auto w-max justify-start p-0 px-4">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.slug}
                value={tab.slug}
                className="px-2 pb-2.5 text-[0.8125rem] whitespace-nowrap text-muted-foreground data-active:font-medium data-active:text-foreground"
              >
                {tab.label}
                <span className="ml-1.5 text-muted-foreground/70">{tab.count}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-4 sm:py-6">
        <div className="rounded-xl border bg-card px-4 sm:px-6">
      {tabs.map((tab) => {
        const list = forTab(tab.slug);
        return (
          <TabsContent key={tab.slug} value={tab.slug} className="flex flex-col">
            {list.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Пока пусто</EmptyTitle>
                  <EmptyDescription>В этом выпуске по теме ничего не прошло отбор.</EmptyDescription>
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
        </div>
      </div>
    </Tabs>
  );
}
