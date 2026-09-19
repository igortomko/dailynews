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
import { relativeTime } from "@/lib/relative-time";
import { FEATURES, type Plan } from "@/lib/plans";
import { usePaywall } from "@/components/paywall";
import { OpinionDialog } from "@/components/opinion-dialog";
import type { NetworkId } from "@/lib/networks";
import type { FeedItem } from "@/lib/queries";

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

const KIND: Record<string, string> = {
  fact: "факт",
  forecast: "прогноз",
  opinion: "мнение",
  announcement: "анонс",
  reprint: "перепечатка",
};

const HORIZON: Record<string, string> = {
  years: "годы",
  months: "месяцы",
  noise: "шум дня",
};

/**
 * Полная дата для подсказки. «4д» отвечает на «давно ли», но не на «какого
 * числа» — а это разные вопросы, и второй возникает ровно тогда, когда
 * материал обсуждают с кем-то ещё.
 */
const EXACT = new Intl.DateTimeFormat("ru", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

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
  item: FeedItem;
  showTopic: boolean;
  plan: Plan;
  /** Сети, отмеченные в «Моих площадках»: сколько их — столько табов. */
  networks: NetworkId[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [opinion, setOpinion] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  // Состояние живёт в карточке, а не в ленте: отправка идёт минуту,
  // и всё это время читатель обязан видеть, что она идёт. После
  // перезагрузки оно теряется — повторный тап ловит 409 от частичного
  // индекса и честно об этом говорит.
  const [kindle, setKindle] = useState<"idle" | "sending" | "sent">("idle");
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
      if (!res.ok) throw new Error(body?.error ?? `ошибка ${res.status}`);
      setKindle("sent");
      // Честно про время: статья забирается и переводится целиком. Обещать
      // мгновенность — значит получить второй тап через десять секунд.
      toast.success("Уехала на Kindle", {
        description: "Перевод и сборка занимают около минуты",
      });
    } catch (error) {
      setKindle("idle");
      toast.error(error instanceof Error ? error.message : "Не отправилось");
    }
  };

  const canPost = FEATURES.posts.has(plan);
  const paywall = usePaywall("posts", plan);

  const title = item.title_ru || item.title;
  const site = siteOf(item.url);
  const kind = item.axes?.kind?.choice ? KIND[item.axes.kind.choice] : undefined;
  const horizon = item.axes?.horizon?.choice ? HORIZON[item.axes.horizon.choice] : undefined;
  const clickbait = (item.axes?.clickbait?.noul ?? 0) > 0.6;

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
      {/* В покое остаётся только источник. Время, тема и метки нужны,
          когда уже присматриваешься к материалу, а в списке они тянут
          строку и спорят с заголовком. Место под них держится всегда,
          поэтому строка не дёргается при наведении.
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
          {/* min-w-0 обязателен: truncate обрезает только то, чему разрешили
              сузиться, а гибкий элемент по умолчанию не уже своего
              содержимого. Строка в одну линию держала ширину всей карточки,
              и на телефоне лента уезжала за край экрана — заголовок и текст
              обрезались справа, а докрутить до них было нельзя. */}
          <span className="min-w-0 truncate opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <Tooltip>
              <TooltipTrigger
                render={
                  <time
                    dateTime={new Date(item.published_at).toISOString()}
                    // Часовой пояс сервера и читателя разные, и точная дата
                    // на них расходится. Значение читателя верное,
                    // предупреждение о несовпадении — шум.
                    suppressHydrationWarning
                    className="cursor-default"
                  />
                }
              >
                {relativeTime(item.published_at)}
              </TooltipTrigger>
              <TooltipContent>{EXACT.format(new Date(item.published_at))}</TooltipContent>
            </Tooltip>
            {[showTopic ? item.topic_label : null, kind, horizon].filter(Boolean).length > 0
              ? `, ${[showTopic ? item.topic_label : null, kind, horizon].filter(Boolean).join(", ")}`
              : ""}
          </span>
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
                    "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground",
                    kindle === "idle"
                      ? "cursor-pointer text-muted-foreground/50"
                      : "text-foreground",
                  )}
                />
              }
            >
              {kindle === "sending" ? (
                <Spinner className="size-3.5" />
              ) : kindle === "sent" ? (
                <CheckIcon className="size-3.5" />
              ) : (
                <BookOpenIcon className="size-3.5" />
              )}
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
                    "flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground",
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
                  className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
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
              className="size-[104px] rounded-lg bg-muted object-cover"
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
