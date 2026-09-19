"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
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

  return (
    <article
      ref={article}
      className={cn("border-b py-5 last:border-0", item.read_count > 0 && "opacity-55")}
    >
      {/* Источник мелким и с весом, остальное — приглушённым.
          Размеры взяты с Google News: 12px/500 на источник, 13px на время. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted-foreground">
        {site ? (
          <a
            href={site}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[0.75rem] font-medium text-foreground/75 hover:underline"
          >
            {item.source_label}
          </a>
        ) : (
          <span className="text-[0.75rem] font-medium text-foreground/75">{item.source_label}</span>
        )}
        <span aria-hidden>·</span>
        <span>{relativeTime(item.day)}</span>
        {showTopic && item.topic_label ? (
          <>
            <span aria-hidden>·</span>
            <span>{item.topic_label}</span>
          </>
        ) : null}
        {kind ? <Badge variant="secondary">{kind}</Badge> : null}
        {horizon ? <Badge variant="secondary">{horizon}</Badge> : null}
        {clickbait ? <Badge variant="destructive">кликбейт</Badge> : null}
      </div>

      {/* Иерархию держит размер, а не жирность: у Google News заголовки
          идут весом 400 с межстрочным около 1.25. Полужирный при таком
          размере начинает шуметь и мешает пробегать список глазами. */}
      <h3 className="mt-1.5 text-pretty text-xl font-normal leading-[1.3]">
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
          className="mt-2 max-w-[68ch] cursor-text text-pretty text-[0.9375rem] leading-relaxed text-muted-foreground"
        >
          {item.summary}
        </p>
      ) : null}
    </article>
  );
}
