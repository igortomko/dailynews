"use client";

import { useEffect, useRef, useState } from "react";
import { ThumbsUpIcon, ThumbsDownIcon, UndoIcon } from "lucide-react";
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
      className="group border-b py-5 last:border-0"
    >
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          {/* В покое остаётся только источник. Время, тема и метки нужны,
              когда уже присматриваешься к материалу, а в списке они тянут
              строку и спорят с заголовком. Место под них держится всегда,
              поэтому строка не дёргается при наведении.
              Разделитель — запятая: точки с пробелами по бокам растягивали
              ряд сильнее, чем несли смысла. */}
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
              <span className="truncate opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                {[
                  relativeTime(item.day),
                  showTopic ? item.topic_label : null,
                  kind,
                  horizon,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </span>

            {clickbait ? <span className="shrink-0 text-destructive">кликбейт</span> : null}

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
              >
                <ThumbsUpIcon className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Скрыть и меньше такого"
                onClick={() => {
                  setVote("down");
                  report({ item_id: item.id, event: "down" });
                }}
                className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
              >
                <ThumbsDownIcon className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Вес 500, а не 400 и не 700. Четырёхсотый на двадцати пикселях
              сливается с описанием под ним — заголовок перестаёт быть входом
              в материал. Полужирный при этом размере шумит и мешает пробегать
              список глазами. Inter подключён переменным, поэтому пятисотый
              берётся без второго файла шрифта. */}
          <h3
            className={cn(
              "mt-1.5 text-pretty text-xl font-medium leading-[1.3]",
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
              className="mt-2 max-w-[68ch] cursor-text text-pretty text-[0.9375rem] leading-relaxed text-foreground/80"
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
            className="mt-6 hidden shrink-0 sm:block"
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
