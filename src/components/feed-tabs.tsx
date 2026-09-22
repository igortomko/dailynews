"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { typingOrModified } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { AUDIO_POLL_MS, AUDIO_POLL_TIMES, ItemCard } from "@/components/item-card";
import { SearchButton, SearchField } from "@/components/feed-search";
import { SearchHints } from "@/components/search-memory";
import { HeadphonesIcon } from "lucide-react";
import { toast } from "sonner";
import { OverviewDialog, SelectionBar } from "@/components/overview";
import { useLocale, useT } from "@/components/i18n-provider";
import { blockOf, reconcile, type Overview } from "@/lib/overview";
import { formatDay } from "@/lib/relative-time";
import { feedHref } from "@/lib/day";
import type { FeedCard } from "@/lib/queries";
import type { ReaderTopic } from "@/lib/types";
import type { Plan } from "@/lib/plans";
import type { UpgradeNote } from "@/lib/upgrade";
import { UpgradeLine } from "@/components/upgrade-note";
import { isShort, shortfallNote } from "@/lib/reading-time";
import { MinutesSelect } from "@/components/minutes-select";
import { FeedMenu } from "@/components/feed-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { SettingsIcon } from "lucide-react";
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
  const t = useT();
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
            aria-label={t.feed.tabs.toTopAria}
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
      <TooltipContent>{t.feed.tabs.toTopTooltip}</TooltipContent>
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
 *
 * `min-w-0` обязателен: слой — элемент сетки, а у него минимальная ширина
 * по умолчанию равна содержимому. Полоса вкладок внутри прокручивается,
 * но её собственная ширина — все вкладки в ряд, и слой растягивался под
 * неё: на телефоне шапка выходила за экран вдвое, страница отдалялась,
 * чтобы вместить её, а над шапкой оставалась полоса, сквозь которую
 * просвечивал текст.
 */
const layerClass = (shown: boolean, from: "above" | "below", extra?: string) =>
  cn(
    "col-start-1 row-start-1 min-w-0 transition-[opacity,translate,visibility] duration-150 ease-out",
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
  days,
  minutes,
  topics,
  items,
  hidden,
  plan,
  networks,
  reading,
  upgrade,
  textLang,
  left,
}: {
  /** Якорь окна: к нему привязаны выбор карточек и черновик обзора. */
  day: string;
  /**
   * Длина окна в днях. Больше единицы — на экране несколько выпусков сразу,
   * и тогда каждая карточка называет свой день: без подписи вчерашнее
   * читалось бы как сегодняшнее.
   */
  days: number;
  /** Заказанные минуты или null — «всё время». Уходит в адрес вместе с окном. */
  minutes: number | null;
  topics: ReaderTopic[];
  items: FeedCard[];
  /**
   * Сколько карточек выпуска спрятано личными исключениями. Число, а не
   * молчание: карточки на вкладках считаются по видимому, и «8» при
   * выпуске на двенадцать без единого слова читалось бы как недобор.
   */
  hidden: number;
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
  reading: { minutes: number; target: number | null; cut: number };
  /**
   * Предел, в который читатель упёрся сегодня, или null. Считает сервер
   * (`upgradeReason`) — тем же правилом, каким про тариф говорит бот.
   */
  upgrade: UpgradeNote | null;
  /** Тег языка текста выпуска, null — если выпуск не переводится. */
  textLang: string | null;
  /**
   * Стрелки дат и календарь. Пропом, а не своим импортом: списком дней
   * с выпусками владеет страница, и клиенту его отдаёт она.
   *
   * Правая половина шапки пропом больше не приходит: тема, поиск
   * и настройки ничего серверного не знают, а на телефоне они прячутся
   * под одну кнопку — развилка по ширине не может жить в серверном
   * компоненте, который о ширине не знает ничего.
   */
  left: React.ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  // «Прочее» показывается вкладкой, только если туда что-то попало: пустая
  // вкладка сообщает о системе, а не о новостях.
  const hasOther = items.some((item) => !item.topic_slug);
  const tabs = [
    { slug: "all", label: t.feed.tabs.all, count: items.length },
    ...topics.map((topic) => ({
      slug: topic.slug,
      label: topic.label,
      count: items.filter((item) => item.topic_slug === topic.slug).length,
    })),
    ...(hasOther
      ? [{ slug: "other", label: t.feed.tabs.other, count: items.filter((item) => !item.topic_slug).length }]
      : []),
  ];

  const [tab, setTab] = useState("all");
  // Открытые вкладки остаются в разметке скрытыми: возврат на вкладку
  // не пересобирает полсотни карточек. Только открытые, а не все разом —
  // иначе каждое переключение дня собирало бы все вкладки сразу и длилось
  // бы вдвое дольше ради тех, до которых не дойдут.
  const [visited, setVisited] = useState(() => new Set(["all"]));
  const openTab = (value: string) => {
    setTab(value);
    setVisited((prev) => (prev.has(value) ? prev : new Set(prev).add(value)));
  };
  // Поиск живёт здесь, потому что раскрытое поле занимает всю строку шапки,
  // а строку рисует эта же шапка. Поле поверх строки оставило бы под собой
  // живые стрелки дат: обратный Tab уходил бы на кнопки, которых не видно.
  const [searching, setSearching] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasSearching = useRef(false);

  /**
   * Прокрутка к карточке из ссылки бота (`#item-<id>`).
   *
   * Браузер прокручивает по якорю и сам, но мимо: карточки за краем экрана
   * разложены оценкой в 220 пикселей (`content-visibility: auto`), а настоящий
   * размер получают, только когда до них докрутили. На сороковой карточке
   * разница набегает в экраны. Поэтому прокрутка повторяется, когда размеры
   * уже настоящие; промах стоит один вызов, а не попадание — «ссылка
   * открывает не ту новость».
   *
   * Отступ читается у самой шапки, а не записан числом. Число пришлось бы
   * держать в двух видах — шапка на телефоне 141 пиксель, на широком
   * экране 85, — и замер показал, чем это кончается: при отступе в 96
   * карточка приезжала ровно под шапку. Высота спрашивается у элемента,
   * и тогда правка шапки не может разойтись с прокруткой.
   */
  const head = useRef<HTMLElement>(null);
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!/^item-\d+$/.test(id)) return;
    const go = () => {
      const card = document.getElementById(id);
      if (!card) return;
      const under = head.current?.getBoundingClientRect().height ?? 0;
      // Восемь пикселей воздуха: заголовок, прижатый к шапке вплотную,
      // читается её продолжением.
      window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - under - 8 });
    };
    go();
    const timers = [0, 150].map((delay) => window.setTimeout(go, delay));
    return () => timers.forEach(clearTimeout);
  }, [day]);

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
        : { title: t.feed.overview.defaultTitle(formatDay(day, locale)), intro: "", blocks };
      return { ...prev, ids: blocks.map((block) => block.id), draft };
    });
    setEditing(true);
  };

  // Пока редактор открыт, состав блоков — единственная правда о выборе:
  // убранный блок снимает галочку с карточки.
  const editDraft = (draft: Overview) =>
    setPicked((prev) => ({ ...prev, ids: draft.blocks.map((block) => block.id), draft }));

  const selecting = chosen.length > 0;

  const [podcasting, setPodcasting] = useState(false);
  /**
   * Какие карточки сейчас озвучивает подкаст и на каком они шаге.
   *
   * Работа идёт после ответа сервера, в `after()`, поэтому «собираю»
   * на кнопке гаснет через секунду, а озвучка ещё минуту. Без этой карты
   * кнопка на карточке выглядела бы бездействующей ровно пока работает.
   */
  const [voicing, setVoicing] = useState<Map<number, string>>(new Map());

  /**
   * Подкаст из отмеченных карточек.
   *
   * Отвечаем сразу и сообщаем словами, а не процентами: карточка, которую
   * уже слушали, достаётся даром, а новая синтезируется десятки секунд, —
   * доля готового о времени не говорит ничего.
   */
  /**
   * Следить за озвучкой подкаста и гасить загрузку по карточкам.
   *
   * Спрашивается пачкой: десять карточек иначе означали бы десять
   * запросов каждые две секунды ради десяти слов.
   */
  const followPodcast = async (sendIds: number[]) => {
    if (sendIds.length === 0) return;
    for (let i = 0; i < AUDIO_POLL_TIMES; i++) {
      await new Promise((done) => setTimeout(done, AUDIO_POLL_MS));
      const res = await fetch(`/api/audio?send_ids=${sendIds.join(",")}`).catch(() => null);
      if (!res?.ok) break;
      const body = await res.json().catch(() => ({}));
      const live = new Map<number, string>();
      for (const send of body.sends ?? []) {
        if (send.status !== "sent" && send.status !== "failed") live.set(send.item_id, send.status);
      }
      setVoicing(live);
      if (live.size === 0) return;
    }
    // Перестали ждать — гасим загрузку: вечный спиннер читается поломкой,
    // а работа при этом идёт и придёт в Telegram.
    setVoicing(new Map());
  };

  const buildPodcast = async () => {
    setPodcasting(true);
    const toastId = toast.loading(t.feed.overview.podcastWorking, {
      duration: Infinity,
      icon: <HeadphonesIcon className="size-4" />,
    });
    try {
      const res = await fetch("/api/audio/podcast", {
        method: "POST",
        body: JSON.stringify({ item_ids: chosen.map((item) => item.id) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? t.feed.item.audioError);
      // Частичный сбор называется вслух: отметил пять, услышит три —
      // узнать об этом надо сейчас, а не по длине файла.
      // Карточки уходят в работу до того, как мы о ней узнаем из опроса:
      // первый шаг ставится сразу, иначе между ответом и первым тиком
      // кнопка успевает мигнуть покоем.
      setVoicing(new Map(body.included_ids?.map((id: number) => [id, "queued"]) ?? []));
      void followPodcast(body.send_ids ?? []);

      if (body.partial) {
        toast.warning(t.feed.overview.podcastPartial(body.included, body.asked), {
          id: toastId,
          duration: 8000,
          closeButton: true,
          icon: <HeadphonesIcon className="size-4" />,
          description: body.partial,
        });
      } else {
        toast.success(t.feed.overview.podcastQueued(body.included), {
          id: toastId,
          duration: 8000,
          closeButton: true,
          icon: <HeadphonesIcon className="size-4" />,
          description: t.feed.overview.podcastQueuedNote,
        });
      }
      clear();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.feed.item.audioError, {
        id: toastId,
        duration: 8000,
        closeButton: true,
      });
    } finally {
      setPodcasting(false);
    }
  };

  // Закрытое поле возвращает фокус туда, откуда его открыли. Иначе Escape
  // роняет фокус в начало страницы, и клавиатурный читатель начинает путь
  // заново — при том что закрыть поле он попросил, а не уйти из шапки.
  useEffect(() => {
    if (!searching && wasSearching.current) trigger.current?.focus();
    wasSearching.current = searching;
  }, [searching]);

  /**
   * Лента — список, который листают. Стрелки вверх и вниз переводят фокус
   * на соседний заголовок; заголовки и так ссылки, поэтому Enter открывает
   * сам собой, и своей ветки под него здесь нет. Прокрутка стрелками
   * на ленте этим отдана списку: колесо, пробел и PgUp/PgDn остаются.
   *
   * Смотрим на e.code, а не на e.key: в кириллической раскладке та же
   * клавиша отдаёт «щ», и проверка по букве молча перестаёт работать
   * ровно у того, кто читает ленту по-русски.
   *
   * x отмечает материал под фокусом для обзора — та же клавиша, что
   * в почте выбирает письмо, — а a озвучивает его. Нажимается сама кнопка
   * карточки, а не состояние напрямую: у неё уже есть и подпись, и отчёт
   * диктору, и пейвол для тарифа без озвучки.
   *
   * «/» раскрывает поиск — как везде, где он есть. Правило «не перехватывать
   * набор текста» одно на все клавиши и живёт здесь же: вторая его копия
   * рядом с полем разъехалась бы с этой при первой правке любой из них.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Пока открыт редактор обзора, лента за ним не слушает: стрелки
      // прокручивали бы её под окном, а x отмечал бы карточку мимо черновика.
      if (editing) return;
      if (typingOrModified(event)) return;
      // «/» и по коду клавиши, и по символу: в кириллице та же клавиша
      // отдаёт «.», а «/» приезжает с другой.
      if (event.code === "Slash" || event.key === "/") {
        event.preventDefault();
        setSearching(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "KeyX", "KeyA"].includes(event.code)) return;

      const panel = document.querySelector('[data-slot="tabs-content"]:not([hidden])');
      const links = [...(panel?.querySelectorAll<HTMLAnchorElement>("article h3 a") ?? [])];
      if (links.length === 0) return;
      const current = links.indexOf(document.activeElement as HTMLAnchorElement);

      // x отмечает материал, a озвучивает его — обе нажимают ту же кнопку
      // карточки, что и палец: у неё уже есть и пейвол, и подпись диктору.
      // Нет фокуса — берём карточку под курсором: подсказки на самих кнопках
      // обещают клавишу тому, кто дотянулся до них мышью, а он до этого
      // ничего не нажимал и фокуса в ленте не имеет.
      const slot = event.code === "KeyX" ? "checkbox" : event.code === "KeyA" ? "listen" : null;
      if (slot) {
        const article =
          current === -1
            ? panel?.querySelector<HTMLElement>("article:hover")
            : links[current].closest("article");
        if (!article) return;
        event.preventDefault();
        article.querySelector<HTMLElement>(`[data-slot="${slot}"]`)?.click();
        return;
      }

      event.preventDefault();
      const step = event.code === "ArrowDown" ? 1 : -1;
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
    // На телефоне белым становится весь корень ленты на высоту экрана,
    // а не колонка текста: у короткой вкладки колонка кончалась бы
    // посреди экрана, и под ней лежал серый край страницы — та же рамка,
    // только снизу. На широком экране корень прозрачный: там белая
    // колонка на сером и есть место для чтения.
    <Tabs value={tab} onValueChange={openTab} className="max-sm:min-h-svh max-sm:bg-card">
      {/* Шапка живёт внутри Tabs: полоса вкладок и содержимое должны быть
          в одном корне, иначе переключение их не связывает.
          Дата и настройки — по краям экрана, а не по колонке текста:
          управление лентой относится ко всей странице. Вкладки под ними
          по центру; когда не помещаются, начинают прокручиваться —
          семь тем по-русски не влезают ни в какую ширину. */}
      <header ref={head} className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur touch:bg-background touch:backdrop-blur-none">
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
        <div className="grid h-26 lg:h-12">
          <div
            inert={searching}
            className={layerClass(!searching, "above", "grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[48px_56px] items-center gap-x-1 px-2 sm:gap-x-3 sm:px-4 lg:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)] lg:grid-rows-1")}
          >
              <div className="col-start-1 row-start-2 flex min-w-0 items-center gap-2 [&>div]:gap-0 sm:[&>div]:gap-2 lg:row-start-1">
                {left}
                {/* Время — рядом с датой: это две вещи об одном и том же.
                    И это же ручка: «сколько это читать» и «сколько у меня
                    есть» спрашивают в одном месте. Число карточек осталось
                    на вкладках, где отвечает на свой вопрос — «сколько
                    в этой теме». */}
                <MinutesSelect day={day} days={days} minutes={minutes} shown={reading.minutes} />
              </div>
              <Link
                href="/"
                aria-label="Reporta"
                className="col-span-2 col-start-1 row-start-1 w-35 translate-y-1 justify-self-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:col-span-1 lg:col-start-2"
              >
                {/* Both themes use the approved vector, retaining the red snake. */}
                {/* eslint-disable @next/next/no-img-element */}
                <img src="/brand/logo-reporta.svg" alt="" width="760" height="216" className="block h-auto w-full dark:hidden" />
                <img src="/brand/logo-reporta-dark.svg" alt="" width="760" height="216" className="hidden h-auto w-full dark:block" />
                {/* eslint-enable @next/next/no-img-element */}
              </Link>
              {/* Поиск рядом с датами: и то и другое — способ добраться
                  до прошлого выпуска. Стрелками к соседнему, календарём
                  к дальнему, поиском — когда помнишь слово, а не дату. */}
              <div className="col-start-2 row-start-2 flex items-center justify-self-end gap-2 lg:col-start-3 lg:row-start-1">
                {/* На телефоне три кнопки подряд отнимали у строки около ста
                    двадцати пикселей из трёхсот семидесяти пяти, и дате
                    не оставалось места даже на «22 сент.». Из трёх нажимают
                    по одной за раз, поэтому там они под «⋯», а на широком
                    экране стоят как стояли: лишнее нажатие ради того,
                    что и так видно, — плата без покупки. */}
                <div className="hidden items-center gap-2 sm:flex">
                  <SearchButton ref={trigger} onOpen={() => setSearching(true)} />
                  <ThemeToggle className="size-10 sm:size-8 [&_svg]:size-5 sm:[&_svg]:size-4" />
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          nativeButton={false}
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t.nav.settings}
                          className="size-10 text-muted-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground sm:size-8 [&_svg]:size-5 sm:[&_svg]:size-4"
                          // Настройки подгружаются заранее, пока читают ленту:
                          // страница динамическая, и без этого каждое нажатие
                          // на шестерёнку ждало бы сервер. Раскладка и первый
                          // раздел — это один запрос о читателе, дёшево.
                          render={<Link href="/settings/personalization" prefetch={true} />}
                        />
                      }
                    >
                      <SettingsIcon />
                    </TooltipTrigger>
                    <TooltipContent>{t.feed.page.settingsHint}</TooltipContent>
                  </Tooltip>
                </div>
                <FeedMenu className="sm:hidden" onSearch={() => setSearching(true)} />
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
        {/* overflow-y-hidden обязателен рядом с overflow-x-auto, и это
            не перестраховка: по спеке `visible` по одной оси рядом
            с `auto` по другой вычисляется в `auto`, то есть полоса вкладок
            получала вертикальную прокрутку, которой у неё нет содержимого.
            На iOS это значит, что полосу можно оттянуть пальцем вверх —
            вкладки уезжали под строку даты и срезались наполовину,
            а вернуть их можно было только тем же жестом обратно. */}
        <div className="flex overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]">
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
                className="h-full px-2.5 pt-1 pb-3 text-sm whitespace-nowrap text-muted-foreground touch:min-h-11 group-data-horizontal/tabs:after:bottom-0 sm:px-2 sm:pb-2.5 sm:text-[0.8125rem] data-active:font-medium data-active:text-foreground"
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
          карточка выпуска лежала бы под ней, и дочитать её было бы нельзя.

          На телефоне карточки нет: белая колонка со скруглением и тенью
          на экране в 390 пикселей — это рамка вокруг текста, отнимающая
          у него ширину. Белым становится сама страница под шапкой,
          а текст идёт от края до края с обычным полем. */}
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
            {shortfallNote(reading.minutes, reading.target, t.feed.time)}.
          </p>
        ) : null}
        {/* Отрезанное заказом названо так же, как скрытое правилами: молча
            показать шесть карточек из сорока — значит выдать часть выпуска
            за выпуск. Выход стоит тут же: «Всё» снимает предел, не уводя
            со страницы. */}
        {reading.cut > 0 ? (
          <p className="mb-3 text-sm text-muted-foreground">
            {t.feed.minutes.cut(reading.cut)}{" "}
            <Link href={feedHref(day, days, null)} className="underline underline-offset-4">
              {t.feed.minutes.cutLink}
            </Link>
            .
          </p>
        ) : null}
        {/* Скрытое исключениями названо, а не заметено: правило работает
            молча, и без строки читатель видел бы выпуск короче заказанного
            и шёл бы чинить отбор, где всё исправно. Только когда есть что
            называть — строка на каждом выпуске перестала бы что-либо значить. */}
        {hidden > 0 && items.length > 0 ? (
          <p className="mb-3 text-sm text-muted-foreground">
            {t.feed.rules.hiddenBefore(hidden)}{" "}
            <Link href="/settings/interests" className="underline underline-offset-4">
              {t.feed.rules.hiddenLink}
            </Link>
            .
          </p>
        ) : null}
        <div className="sm:rounded-xl sm:bg-card sm:px-6 sm:shadow-(--shadow-border)">
      {items.length === 0 && hidden > 0 ? (
        // Выпуск есть, но исключения закрыли его целиком. Спокойно и с выходом:
        // пустая лента без причины и без ссылки — тупик, и чинить её пошли бы
        // в источники. Один раз на всю ленту, а не в каждой вкладке: условие
        // про весь выпуск, а панели вкладок остаются смонтированными все.
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t.feed.rules.allHiddenTitle}</EmptyTitle>
            <EmptyDescription>{t.feed.rules.allHiddenDescription(hidden)}</EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/settings/interests" />}>
            {t.feed.rules.fixExclusions}
          </Button>
        </Empty>
      ) : tabs.map((tab) => {
        const list = forTab(tab.slug);
        return (
          <TabsContent
            key={tab.slug}
            value={tab.slug}
            keepMounted={visited.has(tab.slug)}
            /* Наведённая карточка остаётся в полную силу, соседние гаснут:
               глазу не нужно удерживать, на какой он строке. Наведение только
               на мыши — на тапе :hover залипает, и лента осталась бы
               приглушённой вся, кроме последней тронутой карточки.
               Фокус гасит соседей так же и без этой оговорки: это то же
               «вот эта», сказанное клавиатурой, и второй способ показать
               выбранное (рамка вокруг заголовка) читался бы как другое
               состояние. Обе строки исключают и :hover, и :focus-within:
               иначе наведение на одну карточку при фокусе на другой гасит
               обе — каждая подходит под условие соседней.
               Пока идёт выбор — не гаснут: отмеченные карточки надо видеть
               все разом и сравнивать, а не по одной под курсором. */
            className={cn(
              "flex flex-col",
              !selecting &&
                "[&:has(article:focus-within)>article:not(:hover):not(:focus-within)]:opacity-25 [@media(hover:hover)]:[&:has(article:hover)>article:not(:hover):not(:focus-within)]:opacity-25",
            )}
          >
            {list.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t.feed.tabs.emptyTitle}</EmptyTitle>
                  <EmptyDescription>{t.feed.tabs.emptyDescription}</EmptyDescription>
                </EmptyHeader>
                {/* Выход обязателен: пустая вкладка без единой ссылки — это
                    тупик, из которого остаётся только кнопка «назад». */}
                <Button variant="outline" size="sm" onClick={() => setTab("all")}>
                  {t.feed.tabs.showAll}
                </Button>
              </Empty>
            ) : (
              list.map((item, index) => (
                <Fragment key={`${item.day}-${item.id}`}>
                  <ItemCard
                    textLang={textLang}
                    item={item}
                    showDay={days > 1}
                    showTopic={tab.slug === "all"}
                    plan={plan}
                    networks={networks}
                    selected={selectedIds.has(item.id)}
                    voicing={voicing.get(item.id)}
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
                      {t.feed.tabs.readUpToHere}
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
        {/* Клавиши есть, а узнать о них было неоткуда. Строка стоит под
            лентой, а не в шапке: там она попадалась бы на глаза каждый раз,
            а нужна ровно однажды. И за карточкой, а не в ней: это подпись
            к списку, а не его последняя строка. Только на указателе —
            на телефоне клавиатуры под рукой нет. */}
        {forTab(tab).length > 0 ? (
          <p className="hidden pt-5 text-center text-xs text-muted-foreground [@media(hover:hover)]:block">
            <Kbd>↑</Kbd> {t.feed.tabs.kbdAnd} <Kbd>↓</Kbd> {t.feed.tabs.kbdBetween},{" "}
            <Kbd>Enter</Kbd> {t.feed.tabs.kbdOpen}, <Kbd>x</Kbd> {t.feed.tabs.kbdOverview},{" "}
            <Kbd>a</Kbd> {t.feed.tabs.kbdListen}, <Kbd>/</Kbd> {t.feed.tabs.kbdSearch}
          </p>
        ) : null}
        {/* Под выпуском, а не над ним: это итог прочитанного, и наверху
            он был бы предложением вместо новостей. Одна на всю ленту,
            а не в каждой вкладке: предел про весь выпуск, а панели вкладок
            остаются смонтированными все — в каждой строка повторилась бы
            столько раз, сколько тем. */}
        {upgrade && items.length > 0 ? <UpgradeLine note={upgrade} plan={plan} /> : null}
      </div>
      <SelectionBar
        count={chosen.length}
        onClear={clear}
        onOpen={openEditor}
        onPodcast={buildPodcast}
        podcasting={podcasting}
      />
      {/* Монтируется только с черновиком: до первого «Собрать» ему нечего
          показывать, а состояние копирования не должно жить зря. */}
      {picked.draft ? (
        <OverviewDialog
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
