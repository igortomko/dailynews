"use client";

import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { readingTime } from "@/lib/relative-time";
import { FEATURES, type Plan } from "@/lib/plans";
import { usePaywall } from "@/components/paywall";
import { OpinionDialog } from "@/components/opinion-dialog";
import type { NetworkId } from "@/lib/networks";
import type { FeedCard } from "@/lib/queries";
import { alsoLine, otherSources, storyLines, storyTitle } from "@/lib/story";
import { HORIZON, KIND } from "@/lib/axis-labels";

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

export function ItemCard({
  item,
  showTopic,
  plan,
  networks,
}: {
  item: FeedCard;
  showTopic: boolean;
  plan: Plan;
  /** Сети, отмеченные в «Моих площадках»: сколько их — столько табов. */
  networks: NetworkId[];
}) {
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
    observer.observe(node);
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
      if (!res.ok) throw new Error(body?.error ?? "Не отправилось на Kindle — попробуй ещё раз");
      setKindle("sent");
      // Честно про время: статья забирается и переводится целиком. Обещать
      // мгновенность — значит получить второй тап через десять секунд.
      toast.success("Статья ушла на Kindle", {
        description: "Придёт примерно через минуту",
      });
    } catch (error) {
      setKindle("idle");
      toast.error(error instanceof Error ? error.message : "Не отправилось на Kindle — попробуй ещё раз");
    }
  };

  const canPost = FEATURES.posts.has(plan);
  const paywall = usePaywall("posts", plan);

  // Считаются источники, а не публикации: источник, повторивший сам себя,
  // «ещё одним источником» не становится, и такой сюжет строки не получает.
  const minutes = readingTime(item.body_chars);
  const others = otherSources(item.story, item.source_id);
  const lines = others > 0 ? storyLines(item.story) : [];

  const title = item.title_ru || item.title;
  const site = siteOf(item.url);
  const kind = item.axes?.kind?.choice ? KIND[item.axes.kind.choice] : undefined;
  const horizon = item.axes?.horizon?.choice ? HORIZON[item.axes.horizon.choice] : undefined;
  const clickbait = (item.axes?.clickbait?.noul ?? 0) > 0.6;
  // Тема, тип и горизонт — одной строкой вместе с источником и временем
  // чтения. Порядок от общего к частному: про что это, что это за материал
  // и насколько надолго.
  const tags = [showTopic ? item.topic_label : null, kind, horizon].filter(Boolean);

  if (vote === "down") {
    return (
      <article className="flex items-center gap-3 border-b py-3 text-sm text-muted-foreground last:border-0">
        <span className="truncate">Скрыто: {title}</span>
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
          Вернуть
        </button>
      </article>
    );
  }

  return (
    <article
      ref={article}
      className="group border-b py-5 transition-opacity duration-150 last:border-0"
    >
      {/* Одна строка, а не две. Пока метаданные проявлялись по наведению,
          в покое их место занимало время чтения — и получалось два ряда,
          живущих по разным правилам.

          Времени публикации здесь больше нет. «2д» и «≈41 мин» стоят рядом,
          оба про время и оба про разное: одно — давно ли вышло, второе —
          сколько читать. Глаз складывает их в одно число и спотыкается.
          Из двух оставлено то, что отвечает на «открывать ли сейчас».
          Разделитель — запятая: точки с пробелами по бокам растягивали
          ряд сильнее, чем несли смысла.

          Шапка во всю ширину карточки, а не внутри текстовой колонки:
          там её правый край упирался в картинку, и кнопки у карточек
          с иллюстрацией и без неё стояли в разных местах. Теперь они
          всегда в правом верхнем углу, а картинка начинается под ними. */}
      <div className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
        <span className="flex min-w-0 items-baseline gap-1">
          {site ? (
            <a
              href={site}
              target="_blank"
              rel="noreferrer noopener"
              className="shrink-0 text-[0.75rem] font-medium text-foreground/75 hover:underline"
            >
              {item.source_label}
            </a>
          ) : (
            <span className="shrink-0 text-[0.75rem] font-medium text-foreground/75">
              {item.source_label}
            </span>
          )}
          {/* Метка стоит вплотную к источнику, а не за метаданными:
              место под время и тему держится всегда, чтобы строка
              не дёргалась при наведении, — и «кликбейт» за этим местом
              висел в пустоте, оторванный от того, к чему относится. */}
          {clickbait ? <span className="shrink-0 text-destructive">кликбейт</span> : null}
          {/* Время чтения: «открывать ли сейчас» спрашивают раньше и чаще,
              чем «про что это». Пусто, когда текста статьи у нас нет:
              у 124 карточек из 200 его не бывает, и выдуманное число там
              было бы неотличимо от измеренного. */}
          {minutes ? <span className="shrink-0">{minutes}</span> : null}
          {/* min-w-0 обязателен: truncate обрезает только то, чему разрешили
              сузиться, а гибкий элемент по умолчанию не уже своего
              содержимого. Строка в одну линию держала ширину всей карточки,
              и на телефоне лента уезжала за край экрана — заголовок и текст
              обрезались справа, а докрутить до них было нельзя. */}
          {tags.length > 0 ? <span className="min-w-0 truncate">{tags.join(", ")}</span> : null}
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
                  aria-label="Действия с материалом"
                  className="hidden size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 aria-expanded:bg-muted aria-expanded:text-foreground [@media(hover:none)]:flex"
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
                    toast.info("Сначала отметь, где ты публикуешь", {
                      description: "Настройки → Мои площадки",
                    });
                    return;
                  }
                  setOpinion(true);
                }}
              >
                <PenLineIcon />
                Своё мнение
                {canPost ? null : <CrownIcon className="ml-1 size-3.5 text-amber-500" />}
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
                  ? "Отправляю…"
                  : kindle === "sent"
                    ? "Уже на читалке"
                    : "Отправить на читалку"}
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem
                checked={vote === "up"}
                onCheckedChange={(next: boolean) => {
                  setVote(next ? "up" : null);
                  if (next) report({ item_id: item.id, event: "up" });
                }}
              >
                <ThumbsUpIcon />
                Больше такого
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  setVote("down");
                  report({ item_id: item.id, event: "down" });
                }}
              >
                <ThumbsDownIcon />
                Скрыть и меньше такого
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity",
            "group-hover:opacity-100 group-focus-within:opacity-100",
            vote === "up" && "opacity-100",
            // На тапе этого ряда нет вовсе — там меню.
            "[@media(hover:none)]:hidden",
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
                  aria-label="Своё мнение: готовый пост твоим голосом"
                  onClick={() => {
                    if (!canPost) {
                      paywall.open();
                      return;
                    }
                    if (networks.length === 0) {
                      toast.info("Сначала отметь, где ты публикуешь", {
                        description: "Настройки → Мои площадки",
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
              {canPost ? "Пост твоим голосом для твоих сетей" : "Своё мнение — на тарифе «Pro»"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Отправить на Kindle"
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
            <TooltipContent>Отправить статью на читалку</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Больше такого"
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
            <TooltipContent>Больше такого в следующих выпусках</TooltipContent>
          </Tooltip>

          {/* Палец вниз убирает материал из ленты — единственное здесь
              действие, которое что-то отнимает. Красный по наведению
              отличает его от соседних двух до нажатия, а не после. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Скрыть и меньше такого"
                  onClick={() => {
                    setVote("down");
                    report({ item_id: item.id, event: "down" });
                  }}
                  className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/50 transition-[color,background-color,scale] duration-150 active:scale-[0.96] hover:bg-destructive/10 hover:text-destructive"
                />
              }
            >
              <ThumbsDownIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Скрыть и меньше такого</TooltipContent>
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
              {title}
            </a>
          </h3>

          {item.summary ? (
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
              {item.summary}
            </p>
          ) : null}

          {/* Работа дедупа, названная вслух. Не «важно» и не «подтверждено»:
              пять изданий, пересказавших один пресс-релиз, ничего
              не подтверждают. Здесь сказано ровно то, что произошло, —
              Retorta выбрала из них одно и не спрятала остальные. */}
          {others > 0 ? (
            <div className="mt-3">
              <button
                type="button"
                aria-expanded={storyOpen}
                onClick={() => setStoryOpen((value) => !value)}
                className="flex cursor-pointer items-center gap-1 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground"
              >
                {alsoLine(others)}
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform duration-200", storyOpen && "rotate-180")}
                />
              </button>
              {storyOpen ? (
                <div className="mt-2 max-w-[68ch] rounded-lg bg-muted/40 px-3 py-2.5 text-[0.8125rem]">
                  <p className="mb-1.5 font-medium">{storyTitle(lines.length)}</p>
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
                          <span className="text-muted-foreground/70">· эта карточка</span>
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
