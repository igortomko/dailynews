"use client";

import { useEffect, useRef, useState } from "react";
import { ThumbsUpIcon, ThumbsDownIcon, UndoIcon, BookOpenIcon, CheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/relative-time";
import type { FeedItem } from "@/lib/queries";

/** Ниже этого порога материал попался на глаза, но прочитан не был. */
const SEEN_MS = 1500;
const DWELL_FLOOR_MS = 4000;

function report(body: { item_id: number; event: string; dwell_ms?: number }, beacon = false) {
  const json = JSON.stringify(body);
  if (beacon && typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon("/api/read", new Blob([json], { type: "application/json" }));
    return;
  }
  void fetch("/api/read", { method: "POST", body: json, keepalive: true });
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

/** Домен издания: источник ведёт на издание, заголовок — на сам материал. */
function siteOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function ItemCard({ item, showTopic }: { item: FeedItem; showTopic: boolean }) {
  const [expanded, setExpanded] = useState(false);
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
          onClick={() => setVote(null)}
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
          <span className="truncate opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            {[
              relativeTime(item.published_at),
              showTopic ? item.topic_label : null,
              kind,
              horizon,
            ]
              .filter(Boolean)
              .join(", ")}
          </span>
        </span>

        {/* Оценка тоже по наведению: нужна раз на десяток материалов,
            а в покое спорит с заголовком. Поднятый палец виден всегда,
            иначе выставленная оценка исчезает вместе с курсором. */}
        <div
          className={cn(
            "ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity",
            "group-hover:opacity-100 group-focus-within:opacity-100",
            "[@media(hover:none)]:opacity-100",
            vote === "up" && "opacity-100",
          )}
        >
          {/* Иконка без подписи опознаётся только по догадке. Подпись
              для экранного диктора у них была и раньше; всплывающая
              говорит то же самое глазами — на курсоре и на фокусе. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Отправить на Kindle"
                  disabled={kindle !== "idle"}
                  onClick={sendToKindle}
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
              item.read_count > 0 && "text-foreground/55",
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
              className="mt-2 max-w-[68ch] cursor-text text-pretty text-base leading-[1.6] text-foreground/80"
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

    </article>
  );
}
