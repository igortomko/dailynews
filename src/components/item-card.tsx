"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ThumbsUpIcon,
  ThumbsDownIcon,
  UndoIcon,
  BookOpenIcon,
  CheckIcon,
  EllipsisIcon,
  PenLineIcon,
  CrownIcon,
  ChevronDownIcon,
  HeadphonesIcon,
  EyeIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { QUIET } from "@/lib/quiet";
import { parseStoredReading } from "@/lib/reading-document";
import { ReadingSummary } from "@/components/reading-summary";
import { typography, summaryTime } from "@/lib/typography";
import { cardChars, DEFAULT_CHARS_PER_MINUTE } from "@/lib/reading-time";
import { FEATURES, type Plan } from "@/lib/plans";
import { usePaywall } from "@/components/paywall";
import { useT } from "@/components/i18n-provider";
import { OpinionDialog } from "@/components/opinion-dialog";
import type { NetworkId } from "@/lib/networks";
import type { FeedCard } from "@/lib/queries";
import { alsoLine, otherSources, storyLines, storyTitle } from "@/lib/story";

/** Ниже этого порога материал попался на глаза, но прочитан не был. */
const SEEN_MS = 1500;
const DWELL_FLOOR_MS = 4000;

/**
 * Событие калибровки.
 *
 * Отказ здесь не видит никто: запрос уходил через `void fetch` без единого
 * `catch`, и на моргнувшей сети событие просто исчезало. Калибровка потом
 * показывает отбор хуже, чем он есть, и объяснить это нечем — данных
 * о потере нет. Одна повторная попытка и строка в консоль: тост тут не
 * к месту, это не проблема читателя, но и молчать нельзя.
 */
function report(
  body: { item_id: number; event: string; dwell_ms?: number; undo?: true },
  beacon = false,
) {
  const json = JSON.stringify(body);
  // sendBeacon отдаёт false, когда очередь браузера переполнена, — тогда
  // обычный запрос. Раньше этот ответ не проверялся, и событие ухода
  // со страницы терялось ровно там, где повторить его уже нечем.
  if (beacon && typeof navigator.sendBeacon === "function") {
    if (navigator.sendBeacon("/api/read", new Blob([json], { type: "application/json" }))) return;
  }
  const send = () =>
    fetch("/api/read", { method: "POST", body: json, keepalive: true }).then((res) => {
      if (!res.ok) throw new Error(`ответ ${res.status}`);
    });
  void send()
    .catch(() => new Promise((resolve) => setTimeout(resolve, 1500)).then(send))
    .catch((error) => console.warn(`событие «${body.event}» не доехало:`, error));
}

/**
 * Классы для иконки, которая появляется или уходит по состоянию. Обе (все
 * три) иконки остаются в разметке, одна поверх другой: появляющаяся растёт
 * с 0.25 и теряет размытие, уходящая делает обратное. Подмена через
 * условный рендер даёт скачок ровно в тот момент, когда человек смотрит
 * на кнопку и ждёт ответа.
 */
const swap = (shown: boolean) =>
  cn(
    "size-3.5 transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
    shown ? "scale-100 opacity-100 blur-0" : "scale-[0.25] opacity-0 blur-[4px]",
  );


/** Домен издания: источник ведёт на издание, заголовок — на сам материал. */
function siteOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Значок и подпись кнопки озвучки — по записи на состояние.
 *
 * Одна таблица на оба места: значок в меню и значок в панели обязаны
 * означать одно и то же, а два вложенных тернарника рядом расходятся
 * молча и читаются глазом одинаково.
 */
type AudioState = "idle" | "working" | "sent";

const AUDIO_ICON: Record<AudioState, ReactNode> = {
  idle: <HeadphonesIcon />,
  working: <Spinner />,
  sent: <CheckIcon />,
};

const AUDIO_LABEL = (t: ReturnType<typeof useT>): Record<AudioState, string> => ({
  idle: t.feed.item.audioSpeak,
  working: t.feed.item.audioWorking,
  sent: t.feed.item.audioSent,
});

export function ItemCard({
  item,
  showTopic,
  plan,
  networks,
  selected,
  selecting,
  onSelectedChange,
}: {
  item: FeedCard;
  showTopic: boolean;
  plan: Plan;
  /** Сети, отмеченные в «Моих площадках»: сколько их — столько табов. */
  networks: NetworkId[];
  /** Отмечена ли карточка для обзора. Состояние держит лента, не карточка. */
  selected: boolean;
  /** Идёт ли выбор: пока в выпуске есть хоть одна отметка, чекбоксы видны у всех. */
  selecting: boolean;
  onSelectedChange: (next: boolean) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  // Своё состояние, а не expanded: раскрытие описания считается чтением
  // материала и уезжает в калибровку событием «opened». Список повторов —
  // не чтение, и засчитать его за чтение значило бы подмешать в петлю
  // измерения интерес, которого не было.
  const [storyOpen, setStoryOpen] = useState(false);
  const [opinion, setOpinion] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  // Состояние живёт в карточке, а не в ленте: отправка идёт минуту,
  // и всё это время читатель обязан видеть, что она идёт. После
  // перезагрузки оно теряется — повторный тап ловит 409 от частичного
  // индекса и честно об этом говорит.
  // Начальное состояние приходит из базы, а не всегда «ещё не отправляли»:
  // отправка идёт минуту, и перезагрузка посреди неё стирала весь след.
  const [audio, setAudio] = useState<AudioState>("idle");
  // Живость карточки — ref, а не состояние: цикл опроса читает её между
  // запросами, и перерисовка ему для этого не нужна.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const [kindle, setKindle] = useState<"idle" | "sending" | "sent">(
    item.kindled ? "sent" : "idle",
  );
  const article = useRef<HTMLElement>(null);
  const openedAt = useRef<number | null>(null);
  const reportedSeen = useRef(false);

  // Знаменатель калибровки: что действительно дошло до экрана. Без него
  // доля открытий считается от показанного в дайджесте, а это другое число.
  useEffect(() => {
    const node = article.current;
    if (!node || reportedSeen.current) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !reportedSeen.current) {
          timer = setTimeout(() => {
            reportedSeen.current = true;
            report({ item_id: item.id, event: "seen" });
            observer.disconnect();
          }, SEEN_MS);
        } else if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(node.querySelector("h3") ?? node);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [item.id]);

  useEffect(() => {
    if (!expanded) return;
    openedAt.current = Date.now();
    report({ item_id: item.id, event: "opened" });

    const flush = () => {
      if (openedAt.current === null) return;
      const dwell = Date.now() - openedAt.current;
      openedAt.current = null;
      if (dwell >= DWELL_FLOOR_MS) report({ item_id: item.id, event: "dwell", dwell_ms: dwell }, true);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
    };
  }, [expanded, item.id]);

  const sendToKindle = async () => {
    setKindle("sending");
    try {
      const res = await fetch("/api/kindle", {
        method: "POST",
        body: JSON.stringify({ item_id: item.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? t.feed.item.kindleError);
      setKindle("sent");
      // Честно про время: статья забирается и переводится целиком. Обещать
      // мгновенность — значит получить второй тап через десять секунд.
      toast.success(t.feed.item.kindleToastTitle, {
        description: t.feed.item.kindleToastDescription,
      });
    } catch (error) {
      setKindle("idle");
      toast.error(error instanceof Error ? error.message : t.feed.item.kindleError);
    }
  };

  const canPost = FEATURES.posts.has(plan);
  const paywall = usePaywall("posts", plan);
  const canListen = FEATURES.audio.has(plan);
  const audioPaywall = usePaywall("audio", plan);

  /**
   * Озвучка идёт минутами, поэтому шаг спрашивается, а не угадывается.
   * Проценты рисовать нечем: перевод занимает минуту, синтез — десятки
   * секунд, и «43%» о них не говорит ничего, а «перевожу» говорит всё.
   */
  const speak = async () => {
    if (!canListen) {
      audioPaywall.open();
      return;
    }
    setAudio("working");
    // Опрос переживает карточку, если его не остановить: читатель уходит
    // на другой день выпуска, карточка размонтируется, а цикл продолжает
    // ходить в сеть и звать setState у того, чего уже нет.
    const alive = aliveRef;
    const toastId = toast.loading(t.feed.item.audioStart);
    try {
      const res = await fetch("/api/audio", {
        method: "POST",
        body: JSON.stringify({ item_id: item.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? t.feed.item.audioError);
      // Без номера спрашивать не о чем: цикл ходил бы пять минут по
      // `send_id=undefined` и кончался бы «ещё готовится» на пустом месте.
      if (!body?.send_id) throw new Error(t.feed.item.audioError);

      const WORDS: Record<string, string> = {
        queued: t.feed.item.audioQueued,
        translating: t.feed.item.audioTranslating,
        speaking: t.feed.item.audioSpeaking,
        sending: t.feed.item.audioSending,
      };
      // Опрос, а не сокет: одна кнопка на карточку и минуты работы —
      // держать соединение ради четырёх слов дороже, чем спросить раз
      // в две секунды.
      for (let i = 0; i < 150; i++) {
        await new Promise((done) => setTimeout(done, 2000));
        // Уход с карточки гасит тост: он глобальный и живёт, пока его
        // обновляют, — брошенный, он останется на экране навсегда.
        if (!alive.current) {
          toast.dismiss(toastId);
          return;
        }
        const tick = await fetch(`/api/audio?send_id=${body.send_id}`);
        const state = await tick.json().catch(() => ({}));
        // Код ответа проверяется до статуса. Без этого истёкшая сессия
        // (401) или пропавшая строка (404) дают `{}`, `state.status`
        // становится undefined, и цикл крутится пять минут, чтобы
        // сказать «ещё готовится»: отказ выглядит как медленная работа.
        if (!tick.ok) throw new Error(state?.error ?? t.feed.item.audioError);
        if (state.status === "sent") {
          setAudio("sent");
          toast.success(t.feed.item.audioDoneTitle, {
            id: toastId,
            description: t.feed.item.audioDoneDescription(
              Math.max(1, Math.round((state.seconds ?? 0) / 60)),
            ),
          });
          return;
        }
        if (state.status === "failed") {
          throw new Error(state.error ?? t.feed.item.audioError);
        }
        if (WORDS[state.status]) toast.loading(WORDS[state.status], { id: toastId });
      }
      // Пять минут без ответа — это не «ещё чуть-чуть». Молчащий спиннер
      // читается как поломка, и лучше сказать правду: работа идёт, а мы
      // перестали ждать.
      if (!alive.current) return;
      toast.info(t.feed.item.audioSlowTitle, {
        id: toastId,
        description: t.feed.item.audioSlowDescription,
      });
      setAudio("idle");
    } catch (error) {
      if (!alive.current) return;
      setAudio("idle");
      toast.error(error instanceof Error ? error.message : t.feed.item.audioError, {
        id: toastId,
      });
    }
  };

  // Скрытая карточка выходит и из обзора: в ленте её больше нет, и блок
  // из неё в черновике был бы новостью, которую читатель только что убрал.
  const hide = () => {
    setVote("down");
    report({ item_id: item.id, event: "down" });
    if (selected) onSelectedChange(false);
  };

  // Считаются источники, а не публикации: источник, повторивший сам себя,
  // «ещё одним источником» не становится, и такой сюжет строки не получает.
  const reading = parseStoredReading(item.summary_document);
  const hasSummary = Boolean(item.summary?.trim());
  const seconds = reading ? reading.seconds : hasSummary ? cardChars(item.title_ru || item.title, item.summary) / DEFAULT_CHARS_PER_MINUTE * 60 : 0;
  const minutes = seconds > 0 ? summaryTime(seconds, t.feed.time) : null;
  const others = otherSources(item.story, item.source_id);
  const lines = others > 0 ? storyLines(item.story, t.feed.story) : [];

  const title = item.title_ru || item.title;
  const site = siteOf(item.url);
  const clickbait = item.clickbait;
  // Тема — одной строкой вместе с источником и временем чтения.
  //
  // Тип материала и горизонт отсюда убраны. «Факт» стоял у 58% карточек
  // выпуска, «месяцы» — у 44%: метка, которая есть почти у всех, не отличает
  // карточку от соседней, а слова взяты из нашей шкалы, а не из языка
  // читателя. В отборе и в «Калибровке» обе оси работают по-прежнему —
  // там значения стоят рядом друг с другом и сравниваются. В строке
  // остаётся метка, которая сообщает об отклонении, — «кликбейт» выше.
  const topic = showTopic ? item.topic_label : null;

  if (vote === "down") {
    return (
      <article className="flex items-center gap-3 border-b py-3 text-sm text-muted-foreground last:border-0">
        <span className="truncate">{t.feed.item.hidden(title)}</span>
        <button
          type="button"
          onClick={() => {
            // Отмена снимает событие, а не только прячет плашку. Лента
            // исключает материал по наличию события down: оставь его
            // на месте — и «Вернуть» возвращало бы материал ровно
            // до перезагрузки страницы, после которой он исчезал навсегда.
            // Кнопка обещала обратимость, которой не было.
            report({ item_id: item.id, event: "down", undo: true });
            setVote(null);
          }}
          className="flex shrink-0 cursor-pointer items-center gap-1 hover:text-foreground"
        >
          <UndoIcon className="size-3.5" />
          {t.feed.item.undo}
        </button>
      </article>
    );
  }

  /**
   * Строка над заголовком: издание, метка кликбейта, время чтения и тема.
   *
   * Списком, а не четырьмя подряд стоящими условиями в разметке: между
   * кусками стоит разделитель, а он нужен только между существующими.
   * Пришитый к самому куску, он вылезал бы первым символом строки у любого
   * материала без ссылки на издание.
   *
   * `quiet` — виден только по наведению. В покое строка над заголовком
   * должна называть одно: чьё это. Остальное — ответы на вопросы, которые
   * задают, уже выбрав карточку глазами, и в покое они спорят с самим
   * заголовком, ради которого лента и листается.
   */
  const meta: { key: string; node: ReactNode; quiet?: true }[] = [
    // shrink-0 с потолком в ширину строки: издание не уступает место теме
    // и времени, но и за край карточки не выходит. Без потолка название
    // длиннее строки на телефоне уезжало за правый край без многоточия —
    // и вместе с ним уезжали кнопки действий.
    {
      key: "source",
      node: site ? (
        <a
          href={site}
          target="_blank"
          rel="noreferrer noopener"
          className="max-w-full shrink-0 truncate text-[0.75rem] font-medium text-muted-foreground hover:text-foreground focus-visible:text-foreground hover:underline"
        >
          {item.source_label}
        </a>
      ) : (
        <span className="max-w-full shrink-0 truncate text-[0.75rem] font-medium text-muted-foreground">
          {item.source_label}
        </span>
      ),
    },
    // Метка стоит вплотную к источнику, а не за метаданными: место под время
    // и тему держится всегда, чтобы строка не дёргалась при наведении, —
    // и «кликбейт» за этим местом висел в пустоте, оторванный от того,
    // к чему относится.
    ...(clickbait
      ? [{ key: "clickbait", node: <span className="shrink-0 text-destructive">{t.feed.item.clickbait}</span> }]
      : []),
    // Написание из «За чем следить», найденное в материале. Правило
    // работает при отборе и молча; пометка — единственное, по чему видно,
    // что оно сработало. Только упоминание, как и обещано в настройках:
    // без слов «про Figma» — про что материал, решает читатель.
    ...(item.followed
      ? [{
          key: "followed",
          node: (
            // min-w-0 и truncate, как у темы рядом: написание — текст читателя
            // длиной до 80 знаков, и без обрезки оно наезжало бы на кнопки
            // на узком экране.
            <span
              className="inline-flex min-w-0 items-center gap-1"
              title={t.feed.rules.followedTitle}
            >
              <EyeIcon className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{item.followed}</span>
            </span>
          ),
          quiet: true as const,
        }]
      : []),
    // min-w-0 обязателен: truncate обрезает только то, чему разрешили
    // сузиться, а гибкий элемент по умолчанию не уже своего содержимого.
    // Строка в одну линию держала ширину всей карточки, и на телефоне лента
    // уезжала за край экрана — заголовок и текст обрезались справа,
    // а докрутить до них было нельзя.
    ...(topic
      ? [{ key: "topic", node: <span className="min-w-0 truncate">{topic}</span>, quiet: true as const }]
      : []),
    // Время чтения стоит последним, а не перед темой: оно единственное
    // здесь меняется от материала к материалу сильно, и в середине ряда
    // двигало тему при каждой карточке. С краю ряд стоит ровно, а число
    // никуда не съезжает. Пусто, когда текста статьи у нас нет: у 124
    // карточек из 200 его не бывает, и выдуманное число там было бы
    // неотличимо от измеренного.
    ...(minutes
      ? [{ key: "minutes", node: <span className="shrink-0">{minutes}</span>, quiet: true as const }]
      : []),
  ];

  return (
    <article
      ref={article}
      data-selected={selected || undefined}
      className={cn(
        "group border-b py-5 transition-[opacity,background-color] duration-150 last:border-0",
        // Отмеченная карточка подсвечена всей строкой до краёв контейнера,
        // а не рамкой вокруг текста: рамка внутри полей читалась бы как
        // коробка в коробке. Фон приглушённый и постоянный — выбор должен
        // быть виден издалека, но не спорить с заголовком.
        selected && "-mx-4 bg-muted/70 px-4 sm:-mx-6 sm:px-6",
      )}
    >
      {/* Одна строка, а не две. Прежде метаданные проявлялись по наведению,
          а в покое их место занимало время чтения — и получалось два ряда,
          живущих по разным правилам. Теперь ряд один и гаснет целиком,
          кроме издания: в покое строка над заголовком называет одно —
          чьё это.

          Времени публикации здесь больше нет. «2д» и «~41 мин» стоят рядом,
          оба про время и оба про разное: одно — давно ли вышло, второе —
          сколько читать. Глаз складывает их в одно число и спотыкается.
          Из двух оставлено то, что отвечает на «открывать ли сейчас».

          Шапка во всю ширину карточки, а не внутри текстовой колонки:
          там её правый край упирался в картинку, и кнопки у карточек
          с иллюстрацией и без неё стояли в разных местах. Теперь они
          всегда в правом верхнем углу, а картинка начинается под ними. */}
      <div className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
        {/* Отметка для обзора. Место под неё держится всегда — источник
            и заголовок не переезжают, когда она проявляется по наведению.
            Показывается как остальное тихое: под курсором, под фокусом
            и на тапе; а как только в выпуске отмечена хоть одна карточка —
            у всех, иначе выбор второй карточки начинался бы с поиска
            невидимого квадрата.

            Не внутри ссылки на издание и не рядом с её текстом: нажатие
            на отметку не открывает ничего и не считается чтением —
            ни `opened`, ни `outbound` отсюда не уходят. */}
        <Tooltip>
          {/* Подсказка висит на обёртке, а не на самом чекбоксе: у него свои
              дети (галочка), и render-слот подменил бы их пустотой. */}
          <TooltipTrigger render={<span className="flex shrink-0" />}>
            <Checkbox
              checked={selected}
              onCheckedChange={(next) => onSelectedChange(next)}
              aria-label={selected ? t.feed.overview.remove(title) : t.feed.overview.add(title)}
              className={cn(
                "size-4 bg-card transition-[opacity,background-color,border-color] duration-150",
                // На тапе цель под палец — сорок пикселей вокруг.
                "[@media(hover:none)]:after:-inset-3",
                selected || selecting ? "opacity-100" : QUIET,
              )}
            />
          </TooltipTrigger>
          <TooltipContent>
            {selected ? t.feed.overview.tooltipRemove : t.feed.overview.tooltipAdd}
          </TooltipContent>
        </Tooltip>
        {/* Разделитель между кусками, а не пробел: «Hacker News ~7 мин
            AI-инфра» читается одной строкой, в которой издание, время
            и тема слипаются в чужое название. Точка с пробелами по бокам
            растягивала бы ряд сильнее, чем несёт смысла, а запятая делала бы
            его перечислением однородного — чем издание, время и тема
            не являются.

            aria-hidden: диктор и так делает паузу между элементами,
            а «болт» в речи — мусор.

            Тихие куски гаснут прозрачностью, а не убираются из потока:
            место под них держится всегда, и строка не дёргается при
            наведении. Разделитель гаснет вместе со своим куском — иначе
            в покое перед пустотой висел бы болт. На тапе наведения нет
            вовсе, и там видно всё: спрятанное там было бы спрятано
            навсегда. */}
        <span className="flex min-w-0 items-baseline gap-1">
          {meta.map(({ key, node, quiet }, index) => (
            <Fragment key={key}>
              {index > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    "shrink-0 text-muted-foreground/40",
                    quiet && QUIET,
                  )}
                >
                  •
                </span>
              ) : null}
              {/* Обёртка — тоже флекс: иначе флекс-элементом становится она,
                  а `shrink-0` у времени и `truncate` у темы оказываются
                  на строчном потомке, где не значат ничего. Время сжималось
                  бы многоточием на узком экране, а тема — перестала бы. */}
              {quiet ? <span className={cn(key === "minutes" ? "flex shrink-0" : "flex min-w-0", QUIET)}>{node}</span> : node}
            </Fragment>
          ))}
        </span>

        {/* Оценка тоже по наведению: нужна раз на десяток материалов,
            а в покое спорит с заголовком. Поднятый палец виден всегда,
            иначе выставленная оценка исчезает вместе с курсором.

            На тапе наведения нет, и ряд висел раскрытым в каждой карточке:
            три иконки на узком экране, где и заголовку тесно. Там он прячется
            за одну кнопку — те же действия, но по своей воле, а не в каждой
            строке ленты. */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {/* На тапе действия живут в меню, а не раскрываются рядом: три
              голые иконки на узком экране нечем объяснить, а строка меню
              называет себя словами. На мыши меню было бы лишним щелчком —
              там ряд по-прежнему появляется под курсором. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={t.feed.item.actionsLabel}
                  className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 aria-expanded:bg-muted aria-expanded:text-foreground sm:hidden [@media(hover:none)]:flex"
                />
              }
            >
              {/* Поднятый палец виден и с закрытым меню: оценка, которую
                  видно только внутри меню, — это оценка, которую нечем
                  проверить, не открыв его. */}
              {vote === "up" ? (
                <ThumbsUpIcon className="size-4 text-foreground" />
              ) : (
                <EllipsisIcon className="size-4" />
              )}
            </DropdownMenuTrigger>
            {/* Ширина по самой длинной строке: иначе меню жмётся к кнопке
                и пункты переносятся — список из трёх строк читается
                как из шести. Подписи здесь короткие и заданы в коде,
                так что max-content не разъедется. */}
            <DropdownMenuContent align="end" className="min-w-max">
              {/* На тапе действия живут только здесь, поэтому «Своё мнение»
                  обязано быть и в меню: кнопка, существующая лишь под курсором,
                  на телефоне не существует вовсе. Первым пунктом по той же
                  причине, по какой первой стоит иконка в ряду. */}
              <DropdownMenuItem
                onClick={() => {
                  if (!canPost) {
                    paywall.open();
                    return;
                  }
                  if (networks.length === 0) {
                    toast.info(t.feed.item.pickNetworksFirst, {
                      description: `${t.nav.settings} → ${t.nav.channels}`,
                    });
                    return;
                  }
                  setOpinion(true);
                }}
              >
                <PenLineIcon />
                {t.feed.item.opinion}
                {canPost ? null : <CrownIcon className="ml-1 size-3.5 text-amber-500" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={audio === "working"}
                onClick={audio === "working" ? undefined : speak}
              >
                {AUDIO_ICON[audio]}
                {AUDIO_LABEL(t)[audio]}
                {canListen ? null : <CrownIcon className="ml-1 size-3.5 text-amber-500" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={kindle !== "idle"}
                onClick={kindle === "idle" ? sendToKindle : undefined}
              >
                {kindle === "sending" ? (
                  <Spinner />
                ) : kindle === "sent" ? (
                  <CheckIcon />
                ) : (
                  <BookOpenIcon />
                )}
                {kindle === "sending"
                  ? t.feed.item.kindleSending
                  : kindle === "sent"
                    ? t.feed.item.kindleSent
                    : t.feed.item.kindleSend}
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem
                checked={vote === "up"}
                onCheckedChange={(next: boolean) => {
                  setVote(next ? "up" : null);
                  if (next) report({ item_id: item.id, event: "up" });
                }}
              >
                <ThumbsUpIcon />
                {t.feed.item.upvoteLabel}
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem variant="destructive" onClick={hide}>
                <ThumbsDownIcon />
                {t.feed.item.downvoteLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity",
            "group-hover:opacity-100 group-focus-within:opacity-100",
            vote === "up" && "opacity-100",
            // На тапе этого ряда нет вовсе — там меню.
            "max-sm:hidden [@media(hover:none)]:hidden",
          )}
        >
          {/* Иконка без подписи опознаётся только по догадке. Подпись
              для экранного диктора у них была и раньше; всплывающая
              говорит то же самое глазами — на курсоре и на фокусе. */}
          {/* «Своё мнение» стоит первым среди действий: это то, за что Pro
              и берут деньги, и искать его в конце ряда пришлось бы глазами.
              Не положено тарифом — та же иконка с короной, а не спрятанная
              кнопка: спрятанное не даёт понять, за что предлагают платить. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={t.feed.item.opinionAria}
                  onClick={() => {
                    if (!canPost) {
                      paywall.open();
                      return;
                    }
                    if (networks.length === 0) {
                      toast.info(t.feed.item.pickNetworksFirst, {
                        description: `${t.nav.settings} → ${t.nav.channels}`,
                      });
                      return;
                    }
                    setOpinion(true);
                  }}
                  className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
                />
              }
            >
              <PenLineIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              {canPost ? t.feed.item.opinionTooltipReady : t.feed.item.opinionTooltipLocked}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={t.feed.item.audioAria}
                  aria-disabled={audio === "working"}
                  onClick={audio === "working" ? undefined : speak}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md transition-[color,background-color,scale] duration-150 active:scale-[0.96] hover:bg-muted hover:text-foreground",
                    audio === "idle"
                      ? "cursor-pointer text-muted-foreground/50"
                      : "text-foreground",
                  )}
                />
              }
            >
              <span className="flex size-3.5 items-center justify-center">
                {AUDIO_ICON[audio]}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {canListen ? t.feed.item.audioTooltipReady : t.feed.item.audioTooltipLocked}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={t.feed.item.kindleAria}
                  // aria-disabled, а не disabled: браузер снимает фокус
                  // с выключенной кнопки, и с клавиатуры место в списке
                  // теряется ровно в момент нажатия. Заодно остаётся
                  // подсказка — на disabled она не показывается никогда.
                  aria-disabled={kindle !== "idle"}
                  onClick={kindle === "idle" ? sendToKindle : undefined}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md transition-[color,background-color,scale] duration-150 active:scale-[0.96] hover:bg-muted hover:text-foreground",
                    kindle === "idle"
                      ? "cursor-pointer text-muted-foreground/50"
                      : "text-foreground",
                  )}
                />
              }
            >
              <span className="relative flex size-3.5 items-center justify-center">
                <Spinner className={cn("absolute", swap(kindle === "sending"))} />
                <CheckIcon className={cn("absolute", swap(kindle === "sent"))} />
                <BookOpenIcon className={swap(kindle === "idle")} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{t.feed.item.kindleTooltip}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={t.feed.item.upvoteLabel}
                  aria-pressed={vote === "up"}
                  onClick={() => {
                    setVote(vote === "up" ? null : "up");
                    if (vote !== "up") report({ item_id: item.id, event: "up" });
                  }}
                  className={cn(
                    "flex size-7 cursor-pointer items-center justify-center rounded-md transition-[color,background-color,scale] duration-150 active:scale-[0.96] hover:bg-muted hover:text-foreground",
                    vote === "up" ? "text-foreground" : "text-muted-foreground/50",
                  )}
                />
              }
            >
              <ThumbsUpIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>{t.feed.item.upvoteTooltip}</TooltipContent>
          </Tooltip>

          {/* Палец вниз убирает материал из ленты — единственное здесь
              действие, которое что-то отнимает. Красный по наведению
              отличает его от соседних двух до нажатия, а не после. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={t.feed.item.downvoteLabel}
                  onClick={hide}
                  className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/50 transition-[color,background-color,scale] duration-150 active:scale-[0.96] hover:bg-destructive/10 hover:text-destructive"
                />
              }
            >
              <ThumbsDownIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>{t.feed.item.downvoteLabel}</TooltipContent>
          </Tooltip>
        </div>
        </div>
      </div>
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          {/* Вес 600. Пятисотый на двадцати пикселях отличался от описания
              под ним слишком слабо, чтобы глаз цеплялся за заголовок как
              за якорь: список читался сплошным полотном, и на каждую карточку
              уходил лишний скачок. Семисотый на этом размере уже кричит.
              Inter подключён переменным, поэтому шестисотый берётся без
              второго файла шрифта.
              Отрицательный трекинг — на крупном кегле: Inter рисован
              под текстовые размеры, и на двадцати пикселях межбуквенное
              по умолчанию разваливает слово на буквы. */}
          <h3
            className={cn(
              "mt-1.5 text-pretty text-xl font-semibold leading-[1.3] tracking-[-0.011em]",
              // Прочитанный заголовок приглушается, но остаётся читаемым:
              // на 55% он давал около 3,5:1 — формально хватает для крупного
              // кегля, на солнце и на плохом экране уже нет.
              item.read_count > 0 && "text-foreground/70",
            )}
          >
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              className="decoration-muted-foreground/40 underline-offset-4 hover:underline"
              onClick={() => report({ item_id: item.id, event: "outbound" })}
            >
              {typography(title)}
            </a>
          </h3>

          {reading ? <div onClick={() => setExpanded((value) => !value)}><ReadingSummary reading={reading} labels={t.feed.reading} /></div> : hasSummary ? (
            <p
              onClick={() => setExpanded((value) => !value)}
              // 16 пикселей, а не 15: описание — единственный сплошной текст
              // в карточке, и на нём экономить кегль незачем. Строка держится
              // в 68 знаков — дальше глаз промахивается мимо начала следующей.
              // Цвет текста — полный, а не 80%: описание здесь и есть
              // материал, всё остальное в карточке к нему подпись.
              // Приглушённый основной текст читается как черновик.
              className="mt-2 max-w-[68ch] cursor-text text-pretty text-base leading-[1.6] text-foreground"
            >
              {typography(item.summary ?? "")}
            </p>
          ) : <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{t.feed.item.summaryUnavailable}</p>}

          {/* Работа дедупа, названная вслух. Не «важно» и не «подтверждено»:
              пять изданий, пересказавших один пресс-релиз, ничего
              не подтверждают. Здесь сказано ровно то, что произошло, —
              Reporta выбрала из них одно и не спрятала остальные. */}
          {others > 0 ? (
            <div className="mt-3">
              <button
                type="button"
                aria-expanded={storyOpen}
                onClick={() => setStoryOpen((value) => !value)}
                className="flex cursor-pointer items-center gap-1 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground"
              >
                {alsoLine(others, t.feed.story)}
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform duration-200", storyOpen && "rotate-180")}
                />
              </button>
              {storyOpen ? (
                <div className="mt-2 max-w-[68ch] rounded-lg bg-muted/40 px-3 py-2.5 text-[0.8125rem]">
                  <p className="mb-1.5 font-medium">{storyTitle(lines.length, t.feed.story)}</p>
                  <ul className="space-y-1">
                    {lines.map((line) => (
                      <li key={line.item_id} className="flex flex-wrap items-baseline gap-x-1.5">
                        <a
                          href={line.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          // Переход к любой публикации сюжета — это уход
                          // читать эту новость, и калибровке он нужен весь:
                          // событие ставится на карточку, а не на ту строку,
                          // по которой щёлкнули, — в выпуске была она.
                          onClick={() => report({ item_id: item.id, event: "outbound" })}
                          className="text-foreground/80 underline-offset-4 hover:underline"
                        >
                          {line.source_label}
                        </a>
                        {line.note ? (
                          <span className="text-muted-foreground">— {line.note}</span>
                        ) : null}
                        {/* Показанная публикация помечается отдельно: в выпуск
                            едет та, которую выбрал дедуп, а первым в списке
                            стоит написавший раньше всех — это разные правила,
                            и они расходятся. Без пометки список читался бы
                            как ошибка отбора: «почему первым не тот, кого
                            мне показали». */}
                        {line.item_id === item.id ? (
                          <span className="text-muted-foreground/70">· {t.feed.item.thisCard}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Картинка справа, как в Google News: не мешает пробегать заголовки
            глазами, но даёт строке опору. Битую ссылку убираем молча —
            дыра в ряду хуже, чем её отсутствие. */}
        {item.image_url && !imageFailed ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1.5 hidden shrink-0 sm:block"
            onClick={() => report({ item_id: item.id, event: "outbound" })}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.image_url}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
              // Контур в пиксель, чёрный на светлой теме и белый на тёмной. Без него
              // светлый скриншот сливается с карточкой, а тёмный — с тёмной темой:
              // у картинки пропадает край. Цвет чистый, не из палитры: тонированный
              // подхватывает фон под собой и читается как грязь по краю.
              className="size-[104px] rounded-lg bg-muted object-cover outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
            />
          </a>
        ) : null}
      </div>

      {paywall.dialog}
      {audioPaywall.dialog}
      {/* Мотатка монтируется только после нажатия: она пишет пост при открытии,
          и держать её на каждой карточке значило бы сорок запросов на ленту. */}
      {opinion ? (
        <OpinionDialog
          itemId={item.id}
          title={title}
          url={item.url}
          networks={networks}
          open={opinion}
          onOpenChange={setOpinion}
        />
      ) : null}
    </article>
  );
}
