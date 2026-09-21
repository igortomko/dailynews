"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowUpIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ItemCard } from "@/components/item-card";
import { SearchButton, SearchField } from "@/components/feed-search";
import type { FeedItem } from "@/lib/queries";
import type { ReaderTopic } from "@/lib/types";
import type { Plan } from "@/lib/plans";
import type { NetworkId } from "@/lib/networks";

/**
 * Возврат к началу ленты.
 *
 * В выпуске бывает сто материалов, а управление лентой — даты и вкладки —
 * живёт только в шапке. Докручивать до неё пальцем через весь выпуск
 * означает не возвращаться вовсе.
 *
 * Появляется не сразу: кнопка «наверх», когда ты и так наверху, — это
 * лишний предмет на экране. Порог в восемь сотен пикселей — примерно
 * две карточки, то есть момент, когда шапка уже ушла.
 */
function ToTop() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > 800);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Наверх"
            aria-hidden={!shown}
            tabIndex={shown ? 0 : -1}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className={cn(
              "fixed right-4 bottom-4 z-20 flex size-10 cursor-pointer items-center justify-center",
              // Обратная странице, как тост и подсказка: всё, что лежит
              // поверх ленты, здесь выглядит одинаково. Светлый кружок
              // на светлой странице держался на одной тени и читался как
              // случайное пятно — кнопку было видно, только если знать,
              // что она там.
              "rounded-full bg-foreground text-background shadow-(--shadow-border)",
              "transition-[opacity,scale] duration-200 active:scale-[0.96] hover:opacity-90",
              shown ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0",
            )}
          />
        }
      >
        <ArrowUpIcon className="size-4" />
      </TooltipTrigger>
      <TooltipContent>Наверх, к датам и вкладкам</TooltipContent>
    </Tooltip>
  );
}

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
  // Поиск живёт здесь, потому что раскрытое поле занимает всю строку шапки,
  // а строку рисует эта же шапка. Поле поверх строки оставило бы под собой
  // живые стрелки дат: обратный Tab уходил бы на кнопки, которых не видно.
  const [searching, setSearching] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasSearching = useRef(false);

  // Закрытое поле возвращает фокус туда, откуда его открыли. Иначе Escape
  // роняет фокус в начало страницы, и клавиатурный читатель начинает путь
  // заново — при том что закрыть поле он попросил, а не уйти из шапки.
  useEffect(() => {
    if (!searching && wasSearching.current) trigger.current?.focus();
    wasSearching.current = searching;
  }, [searching]);

  /**
   * Лента — список, который листают. j и k переводят фокус на соседний
   * заголовок, o открывает его; заголовки и так ссылки, поэтому Enter
   * работает сам собой.
   *
   * Смотрим на e.code, а не на e.key: в кириллической раскладке та же
   * клавиша отдаёт «о», «л» и «щ», и проверка по букве молча перестаёт
   * работать ровно у того, кто читает ленту по-русски.
   *
   * «/» раскрывает поиск — как везде, где он есть. Правило «не перехватывать
   * набор текста» одно на все клавиши и живёт здесь же: вторая его копия
   * рядом с полем разъехалась бы с этой при первой правке любой из них.
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
      // «/» и по коду клавиши, и по символу: в кириллице та же клавиша
      // отдаёт «.», а «/» приезжает с другой.
      if (event.code === "Slash" || event.key === "/") {
        event.preventDefault();
        setSearching(true);
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
          {searching ? (
            // Вместо строки, а не поверх неё: между датой и шестерёнкой
            // на телефоне остаётся сантиметр, и поле там либо нечитаемо,
            // либо выдавливает дату за экран.
            <SearchField onClose={() => setSearching(false)} />
          ) : (
            <>
              {left}
              {/* Поиск рядом с датами: и то и другое — способ добраться
                  до прошлого выпуска. Стрелками к соседнему, календарём
                  к дальнему, поиском — когда помнишь слово, а не дату. */}
              <div className="flex items-center gap-2">
                <SearchButton ref={trigger} onOpen={() => setSearching(true)} />
                {right}
              </div>
            </>
          )}
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
                  <EmptyDescription>В этот выпуск по этой теме ничего не попало</EmptyDescription>
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

            {/* Клавиши есть, а узнать о них было неоткуда. Строка стоит
                в конце списка, а не в шапке: там она попадалась бы на глаза
                каждый раз, а нужна ровно однажды. Только на указателе —
                на телефоне клавиатуры под рукой нет. */}
            {list.length > 0 ? (
              <p className="hidden py-5 text-center text-xs text-muted-foreground [@media(hover:hover)]:block">
                <kbd className="rounded border px-1 py-0.5 font-mono text-[0.7rem]">j</kbd> и{" "}
                <kbd className="rounded border px-1 py-0.5 font-mono text-[0.7rem]">k</kbd> —
                между материалами,{" "}
                <kbd className="rounded border px-1 py-0.5 font-mono text-[0.7rem]">o</kbd> —
                открыть,{" "}
                <kbd className="rounded border px-1 py-0.5 font-mono text-[0.7rem]">/</kbd> —
                поиск по выпускам
              </p>
            ) : null}
          </TabsContent>
        );
      })}
        </div>
      </div>
      <ToTop />
    </Tabs>
  );
}
