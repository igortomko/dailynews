"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ItemCard } from "@/components/item-card";
import type { FeedItem } from "@/lib/queries";
import type { Topic } from "@/lib/types";

export function FeedTabs({ topics, items }: { topics: Topic[]; items: FeedItem[] }) {
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
    <Tabs defaultValue="all" className="flex flex-col gap-2">
      {/* Вкладки как в Google News: подчёркивание вместо плашки. Плашка
          обводит каждую тему рамкой и превращает ряд в набор кнопок;
          подчёркивание отмечает одну, остальные оставляет текстом.
          Полоса выходит за колонку и растушёвана: семь тем по-русски
          не помещаются, а обрезанный край должен читаться как «есть ещё». */}
      {/* Вынос должен совпадать с отступами панели, иначе растушёвка
          обрывается не у края и полоса выглядит обрезанной, а не
          прокручиваемой. Полоса скроллится: семь тем по-русски не
          помещаются ни в какую ширину. */}
      <div className="-mx-4 overflow-x-auto border-b [scrollbar-width:none] sm:-mx-6 [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]">
        <TabsList className="h-auto w-max justify-start gap-1 rounded-none border-0 bg-transparent p-0 px-4 sm:px-6">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.slug}
              value={tab.slug}
              className="rounded-none border-0 border-b-2 border-transparent bg-transparent px-2 pb-2.5 text-[0.8125rem] whitespace-nowrap text-muted-foreground shadow-none data-[selected]:border-foreground data-[selected]:font-medium data-[selected]:text-foreground data-[state=active]:border-foreground data-[state=active]:font-medium data-[state=active]:text-foreground"
            >
              {tab.label}
              <span className="ml-1.5 text-muted-foreground/70">{tab.count}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

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
    </Tabs>
  );
}
