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
import { SearchHints } from "@/components/search-memory";
import { OverviewDialog, SelectionBar } from "@/components/overview";
import { blockOf, defaultTitle, reconcile, type Overview } from "@/lib/overview";
import type { FeedCard } from "@/lib/queries";
import type { ReaderTopic } from "@/lib/types";
import type { Plan } from "@/lib/plans";
import { formatMinutes, isShort, shortfallNote } from "@/lib/reading-time";
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
function ToTop({ lifted }: { lifted: boolean }) {
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
              "fixed right-4 z-20 flex size-10 cursor-pointer items-center justify-center",
              // Над плашкой выбора, пока она есть: обе живут у нижнего края,
              // и на узком экране кнопка ложилась бы на её правый край.
              lifted ? "bottom-20" : "bottom-4",
              // Обратная странице, как тост и подсказка: всё, что лежит
              // поверх ленты, здесь выглядит одинаково. Светлый кружок
              // на светлой странице держался на одной тени и читался как
              // случайное пятно — кнопку было видно, только если знать,
              // что она там.
              "rounded-full bg-foreground text-background shadow-(--shadow-border)",
              "transition-[opacity,scale,bottom] duration-200 active:scale-[0.96] hover:opacity-90",
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

/**
 * Слой шапки: видимый или ушедший. Оба лежат в одной клетке сетки, потому
 * что уходящий нельзя убрать из разметки, пока он уходит.
 *
 * Вся анимация — прозрачность и четыре пикселя: уходящий слой отступает
 * туда, откуда пришёл бы (`from`), встречный приходит с другой стороны.
 * Собирается это одной функцией на все четыре слоя: правка кроссфейда,
 * разложенная по четырём местам, доедет до трёх из них.
 *
 * В списке переходов `translate`, а не `transform`: у Tailwind
 * `translate-y-*` — это свойство `translate`, и в произвольном списке
 * его никто не подставит. С `transform` сдвиг не анимировался бы вовсе,
 * а прыгал в конце перехода — ровно та поломка, которую не видно,
 * потому что прозрачность-то менялась.
 *
 * `visibility` едет в переходе вместе с ними: без неё ушедший слой ловил бы
 * мышь поверх пришедшего. `motion-reduce` выключает переход целиком —
 * попросившему систему ничего не двигать поле открывается мгновенно.
 */
const layerClass = (shown: boolean, from: "above" | "below", extra?: string) =>
  cn(
    "col-start-1 row-start-1 transition-[opacity,translate,visibility] duration-150 ease-out",
    "motion-reduce:transition-none",
    shown
      ? "visible translate-y-0 opacity-100"
      : cn("invisible opacity-0", from === "above" ? "-translate-y-1" : "translate-y-1"),
    extra,
  );

/**
 * Выбор карточек и черновик обзора — одно состояние, привязанное к дню.
 *
 * `day` лежит внутри, а не снаружи: шапка одна на все даты, и React
 * сохраняет её состояние при переходе к другому выпуску. Выбор,
 * сделанный вчера, у сегодняшнего выпуска ничего не значит — карточек
 * с такими id здесь нет, а черновик говорил бы про другой день. Поэтому
 * состояние с чужой датой сбрасывается при первом же рендере нового дня.
 *
 * `ids` — порядок нажатий, и он ни на что не влияет: список выбранного
 * собирается фильтром по ленте, то есть порядком выпуска. Черновик
 * заводится при первом открытии редактора и дальше живёт с правками.
 */
type Picked = { day: string; ids: number[]; draft: Overview | null };

export function FeedTabs({
  day,
  topics,
  items,
  plan,
  networks,
  reading,
  left,
  right,
}: {
  /** День выпуска: к нему привязаны выбор карточек и черновик обзора. */
  day: string;
  topics: ReaderTopic[];
  items: FeedCard[];
  /** Действующий тариф: от него зависят корона и кнопка «Своё мнение». */
  plan: Plan;
  networks: NetworkId[];
  /**
   * Сколько времени займёт выпуск и сколько его заказывали в тот день.
   *
   * Обещание продукта — время, поэтому оно стоит в шапке рядом с датой,
   * а не считается читателем по числу карточек. Заказ — `null` у выпусков,
   * которые его не сохранили: о недоборе тогда молчим, а не считаем его
   * по сегодняшней настройке.
   */
  reading: { minutes: number; target: number | null };
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

  const blank = (): Picked => ({ day, ids: [], draft: null });
  const [picked, setPicked] = useState<Picked>(blank);
  const [editing, setEditing] = useState(false);
  // Сброс прямо в рендере, а не в эффекте: React перерисует до фиксации,
  // и ни один кадр с чужим выбором на экран не попадёт. Вернувшийся
  // на ту же дату начинает с чистого листа — «очищается» значит очищается,
  // а не «прячется до возвращения». Ниже по коду `picked` уже этого дня:
  // обработчики про чужую дату не знают и знать не должны.
  if (picked.day !== day) {
    setPicked(blank());
    setEditing(false);
  }
  // Только то, что есть в ленте сейчас: карточка, скрытая или ушедшая
  // с обновлением данных, из выбора выпадает сама — в порядке выпуска.
  const chosen = items.filter((item) => picked.ids.includes(item.id));
  const selectedIds = new Set(chosen.map((item) => item.id));

  const pick = (id: number, next: boolean) =>
    setPicked((prev) => ({
      ...prev,
      ids: next
        ? prev.ids.includes(id)
          ? prev.ids
          : [...prev.ids, id]
        : prev.ids.filter((entry) => entry !== id),
    }));

  // Очистка снимает выбор, но не стирает заголовок и вступление: набранное
  // руками дороже трёх галочек, и его нечем вернуть.
  const clear = () =>
    setPicked((prev) => ({
      ...prev,
      ids: [],
      draft: prev.draft && { ...prev.draft, blocks: [] },
    }));

  // Черновик сводится с выбором при открытии: оставшиеся блоки — со своими
  // правками и в своём порядке, новые — в конец, снятые — вон.
  const openEditor = () => {
    setPicked((prev) => {
      const blocks = reconcile(prev.draft?.blocks ?? [], chosen.map(blockOf));
      const draft = prev.draft
        ? { ...prev.draft, blocks }
        : { title: defaultTitle(day), intro: "", blocks };
      return { ...prev, ids: blocks.map((block) => block.id), draft };
    });
    setEditing(true);
  };

  // Пока редактор открыт, состав блоков — единственная правда о выборе:
  // убранный блок снимает галочку с карточки.
  const editDraft = (draft: Overview) =>
    setPicked((prev) => ({ ...prev, ids: draft.blocks.map((block) => block.id), draft }));

  const selecting = chosen.length > 0;
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
   * x отмечает материал под фокусом для обзора — та же клавиша, что
   * в почте выбирает письмо. Нажимается сам чекбокс карточки, а не
   * состояние напрямую: у него уже есть и подпись, и отчёт диктору.
   *
   * «/» раскрывает поиск — как везде, где он есть. Правило «не перехватывать
   * набор текста» одно на все клавиши и живёт здесь же: вторая его копия
   * рядом с полем разъехалась бы с этой при первой правке любой из них.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Пока открыт редактор обзора, лента за ним не слушает: j и k
      // прокручивали бы её под окном, а x отмечал бы карточку мимо черновика.
      if (editing) return;
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
      if (!["KeyJ", "KeyK", "KeyO", "KeyX"].includes(event.code)) return;

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
      if (event.code === "KeyX") {
        if (current === -1) return;
        event.preventDefault();
        links[current]
          .closest("article")
          ?.querySelector<HTMLElement>('[data-slot="checkbox"]')
          ?.click();
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
  }, [editing]);

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
        {/* Строка и поле лежат в одной клетке сетки и меняются местами
            прозрачностью: строка гаснет, поле проявляется там же, где была
            дата. Мгновенная подмена читалась как перерисовка страницы —
            глаз не успевал заметить, что именно сменилось. Полторы десятых
            секунды хватает, чтобы понять, и не хватает, чтобы надоесть
            на двадцатый поиск за день.
            Убрать уходящую строку из разметки нельзя, пока она уходит,
            поэтому обе висят всегда — а скрытая получает `inert`: без него
            обратный Tab уходит на стрелки дат, которых не видно. */}
        <div className="grid h-14 sm:h-12">
          <div
            inert={searching}
            className={layerClass(!searching, "above", "flex items-center justify-between gap-3 px-4")}
          >
              <div className="flex min-w-0 items-center gap-2">
                {left}
                {/* Время выпуска — рядом с его датой: это две вещи об одном
                    и том же выпуске. Число карточек осталось на вкладках,
                    где оно и отвечает на свой вопрос — «сколько в этой теме». */}
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                  {formatMinutes(reading.minutes)}
                </span>
              </div>
              {/* Поиск рядом с датами: и то и другое — способ добраться
                  до прошлого выпуска. Стрелками к соседнему, календарём
                  к дальнему, поиском — когда помнишь слово, а не дату. */}
              <div className="flex items-center gap-2">
                <SearchButton ref={trigger} onOpen={() => setSearching(true)} />
                {right}
              </div>
          </div>
          {/* Ширина ряда — по колонке текста, как на странице результатов:
              поле от края до края экрана и то же поле в колонке читались
              как два разных, а это одно и то же, до и после отправки.

              Само поле при этом шире, чем на выдаче, ровно на кнопку:
              крестик стоит справа, а стрелка назад там слева. Это решение
              владельца и не оплошность выравнивания — крестик закрывает
              поиск, стрелка уводит, и одинаковое место обещало бы
              одинаковое действие. */}
          {/* Приходит снизу, а строка уходит вверх: четыре пикселя навстречу
              друг другу читаются как смена, а не как общий сдвиг шапки. */}
          <div
            inert={!searching}
            className={layerClass(
              searching,
              "below",
              "mx-auto flex w-full max-w-page items-center gap-2 px-4",
            )}
          >
            <SearchField open={searching} onClose={() => setSearching(false)} />
          </div>
        </div>
        {/* Пока ищут, вкладки уступают место подсказкам: они разбирают
            сегодняшний выпуск по темам, а поиск идёт по всем сразу —
            нажатие на вкладку посреди набора означало бы уйти из поиска
            неизвестно куда. Меняются они тем же кроссфейдом, что и строка
            над ними: два перехода разной длины в одной шапке читаются
            как две разные поломки. */}
        <div className="grid">
        <div inert={searching} className={layerClass(!searching, "above")}>
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
                /* after:bottom-0 вместо штатных −5px: полоса вкладок
                   прокручивается, а прокрутка по горизонтали обрезает и по
                   вертикали — подчёркивание, вынесенное под нижний край
                   вкладки, не рисовалось вовсе, и активная вкладка
                   отличалась от соседних только насыщенностью текста.
                   h-full вместо штатных calc(100%-1px): вкладка на пиксель
                   ниже полосы да ещё по центру не доставала до низа, и между
                   подчёркиванием и границей шапки оставался уступ. */
                className="h-full px-2.5 pt-1 pb-3 text-sm whitespace-nowrap text-muted-foreground group-data-horizontal/tabs:after:bottom-0 sm:px-2 sm:pb-2.5 sm:text-[0.8125rem] data-active:font-medium data-active:text-foreground"
              >
                {tab.label}
                <span className="ml-1.5 text-muted-foreground/70">{tab.count}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        </div>
          <div inert={!searching} className={layerClass(searching, "below")}>
            <SearchHints />
          </div>
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
      {/* Снизу — место под плашку выбора, пока она есть: иначе последняя
          карточка выпуска лежала бы под ней, и дочитать её было бы нельзя. */}
      <div
        className={cn(
          "mx-auto w-full max-w-page px-4 pt-4 sm:pt-6",
          selecting ? "pb-24" : "pb-4 sm:pb-6",
        )}
      >
        {/* Недобор объясняется, а не заметается добором слабого материала.
            Короткий выпуск без единого слова читается как поломка отбора —
            и чинить его читатель пойдёт в настройки, где всё исправно.
            Строка появляется только при настоящем недоборе: тревога,
            горящая каждый день, ничем не отличается от выключенной. */}
        {reading.target !== null && isShort(reading.minutes, reading.target) ? (
          <p className="mb-3 text-sm text-muted-foreground">
            {shortfallNote(reading.minutes, reading.target)}.
          </p>
        ) : null}
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
               кроме последней тронутой карточки.
               Пока идёт выбор — не гаснут: отмеченные карточки надо видеть
               все разом и сравнивать, а не по одной под курсором. */
            className={cn(
              "flex flex-col",
              !selecting &&
                "[@media(hover:hover)]:[&:has(article:hover)>article:not(:hover)]:opacity-25",
            )}
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
                    selected={selectedIds.has(item.id)}
                    selecting={selecting}
                    onSelectedChange={(next) => pick(item.id, next)}
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
                <kbd className="rounded border px-1 py-0.5 font-mono text-[0.7rem]">x</kbd> —
                в обзор,{" "}
                <kbd className="rounded border px-1 py-0.5 font-mono text-[0.7rem]">/</kbd> —
                поиск по выпускам
              </p>
            ) : null}
          </TabsContent>
        );
      })}
        </div>
      </div>
      <SelectionBar count={chosen.length} onClear={clear} onOpen={openEditor} />
      {/* Монтируется только с черновиком: до первого «Собрать» ему нечего
          показывать, а состояние копирования не должно жить зря. */}
      {picked.draft ? (
        <OverviewDialog
          day={day}
          overview={picked.draft}
          open={editing}
          onOpenChange={setEditing}
          onChange={editDraft}
        />
      ) : null}
      <ToTop lifted={selecting} />
    </Tabs>
  );
}
