"use client";

import { Fragment, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ItemCard } from "@/components/item-card";
import type { FeedItem } from "@/lib/queries";
import type { ReaderTopic } from "@/lib/types";
import type { Plan } from "@/lib/plans";
import type { NetworkId } from "@/lib/networks";

export function FeedTabs({
  topics,
  items,
  plan,
  networks,
  left,
  right,
}: {
  topics: ReaderTopic[];
  items: FeedItem[];
  /** Действующий тариф: от него зависят корона и кнопка «Своё мнение». */
  plan: Plan;
  networks: NetworkId[];
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

  const [tab, setTab] = useState("all");

  /**
   * Лента — список, который листают. j и k переводят фокус на соседний
   * заголовок, o открывает его; заголовки и так ссылки, поэтому Enter
   * работает сам собой.
   *
   * Смотрим на e.code, а не на e.key: в кириллической раскладке та же
   * клавиша отдаёт «о», «л» и «щ», и проверка по букве молча перестаёт
   * работать ровно у того, кто читает ленту по-русски.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      if (event.code !== "KeyJ" && event.code !== "KeyK" && event.code !== "KeyO") return;

      const panel = document.querySelector('[data-slot="tabs-content"]:not([hidden])');
      const links = [...(panel?.querySelectorAll<HTMLAnchorElement>("article h3 a") ?? [])];
      if (links.length === 0) return;
      const current = links.indexOf(document.activeElement as HTMLAnchorElement);

      if (event.code === "KeyO") {
        if (current === -1) return;
        event.preventDefault();
        links[current].click();
        return;
      }

      event.preventDefault();
      const step = event.code === "KeyJ" ? 1 : -1;
      const next =
        current === -1
          ? step > 0
            ? 0
            : links.length - 1
          : Math.min(links.length - 1, Math.max(0, current + step));
      // preventScroll, а потом свой scrollIntoView: браузер иначе подтягивает
      // заголовок под липкую шапку, и строка оказывается наполовину под ней.
      links[next].focus({ preventScroll: true });
      links[next].closest("article")?.scrollIntoView({ block: "center", behavior: "smooth" });
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const forTab = (slug: string) =>
    slug === "all"
      ? items
      : slug === "other"
        ? items.filter((item) => !item.topic_slug)
        : items.filter((item) => item.topic_slug === slug);

  return (
    <Tabs value={tab} onValueChange={setTab}>
      {/* Шапка живёт внутри Tabs: полоса вкладок и содержимое должны быть
          в одном корне, иначе переключение их не связывает.
          Дата и настройки — по краям экрана, а не по колонке текста:
          управление лентой относится ко всей странице. Вкладки под ними
          по центру; когда не помещаются, начинают прокручиваться —
          семь тем по-русски не влезают ни в какую ширину. */}
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        {/* На телефоне шапка выше, а кнопки в ней крупнее: 28 пикселей —
            это иконка, а не цель для пальца. На мыши лишняя высота ни к чему. */}
        <div className="flex h-14 items-center justify-between gap-3 px-4 sm:h-12">
          {left}
          {right}
        </div>
        {/* Родитель flex, полоса с margin: auto. Когда вкладки помещаются,
            поля разводят их по центру; когда шире — поля схлопываются в ноль,
            полоса прижимается к левому краю и прокручивается.
            justify-center здесь не годится: при переполнении он прячет
            левый край так, что до него не докрутить. */}
        <div className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]">
          {/* Штатный вариант line: подчёркивание в два пикселя через ::after.
              Самодельные рамки здесь не годились — состояние называется
              data-active, и перекрытия по data-[state=active] не совпадали,
              отчего под активной вкладкой оставалась плашка. */}
          <TabsList variant="line" className="mx-auto h-auto w-max justify-start p-0 px-4">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.slug}
                value={tab.slug}
                className="px-2.5 pt-1 pb-3 text-sm whitespace-nowrap text-muted-foreground sm:px-2 sm:pb-2.5 sm:text-[0.8125rem] data-active:font-medium data-active:text-foreground"
              >
                {tab.label}
                <span className="ml-1.5 text-muted-foreground/70">{tab.count}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </header>

      {/*
        w-full обязателен, хотя блок и так «во всю ширину». Корень Tabs —
        флекс-колонка, и без заданной ширины этот блок считает себя по самому
        длинному неразрывному содержимому: строка метаданных не переносится,
        и колонка раздувалась до неё. На телефоне это выглядело так, будто
        лента шире экрана — заголовок и текст обрезались справа, и добраться
        до обрезанного было нельзя, горизонтальной прокрутки нет.
      */}
      <div className="mx-auto w-full max-w-page px-4 py-4 sm:py-6">
        <div className="rounded-xl bg-card px-4 shadow-(--shadow-border) sm:px-6">
      {tabs.map((tab) => {
        const list = forTab(tab.slug);
        return (
          <TabsContent
            key={tab.slug}
            value={tab.slug}
            /* Наведённая карточка остаётся в полную силу, соседние гаснут:
               глазу не нужно удерживать, на какой он строке. Только на мыши —
               на тапе :hover залипает, и лента осталась бы приглушённой вся,
               кроме последней тронутой карточки. */
            className="flex flex-col [@media(hover:hover)]:[&:has(article:hover)>article:not(:hover)]:opacity-25"
          >
            {list.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Пока пусто</EmptyTitle>
                  <EmptyDescription>В этом выпуске по теме ничего не прошло отбор.</EmptyDescription>
                </EmptyHeader>
                {/* Выход обязателен: пустая вкладка без единой ссылки — это
                    тупик, из которого остаётся только кнопка «назад». */}
                <Button variant="outline" size="sm" onClick={() => setTab("all")}>
                  Показать весь выпуск
                </Button>
              </Empty>
            ) : (
              list.map((item, index) => (
                <Fragment key={`${item.day}-${item.id}`}>
                  <ItemCard
                    item={item}
                    showTopic={tab.slug === "all"}
                    plan={plan}
                    networks={networks}
                  />
                  {/* Граница прошлого захода. Виденное лежит подряд сверху:
                      ленту читают в том же порядке, в каком она нарисована.
                      Рисуется только между виденным и новым — в самом низу
                      она сообщала бы «ты дочитал до конца», что и так видно. */}
                  {item.seen && !list[index + 1]?.seen && index < list.length - 1 ? (
                    <div className="flex items-center gap-3 py-3 text-xs text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      досюда ты дочитал
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  ) : null}
                </Fragment>
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
