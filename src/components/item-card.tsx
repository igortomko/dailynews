"use client";

import { useEffect, useRef, useState } from "react";
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

/**
 * Только те пометки, что меняют решение читать: материал окажется тоньше,
 * чем обещает заголовок. «Факт», «анонс» и «прогноз» читателю ничего не
 * говорят заранее — их незачем выносить в строку.
 */
const WARNINGS: Record<string, string> = {
  opinion: "мнение",
  reprint: "перепечатка",
};

export function ItemCard({ item, showTopic }: { item: FeedItem; showTopic: boolean }) {
  const [open, setOpen] = useState(false);
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
    if (!open) return;
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
  }, [open, item.id]);

  const title = item.title_ru || item.title;
  const kind = item.axes?.kind?.choice;
  const warning = kind ? WARNINGS[kind] : undefined;
  const clickbait = (item.axes?.clickbait?.noul ?? 0) > 0.6;

  return (
    <article
      ref={article}
      className={cn(
        "border-b py-4 last:border-0",
        item.read_count > 0 && "opacity-55",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/70">{item.source_label}</span>
        <span aria-hidden>·</span>
        <span>{relativeTime(item.day)}</span>
        {showTopic && item.topic_label ? (
          <>
            <span aria-hidden>·</span>
            <span>{item.topic_label}</span>
          </>
        ) : null}
        {warning ? (
          <>
            <span aria-hidden>·</span>
            <span>{warning}</span>
          </>
        ) : null}
        {clickbait ? (
          <>
            <span aria-hidden>·</span>
            <span className="text-destructive">кликбейт</span>
          </>
        ) : null}
      </div>

      {/* Заголовок — единственный сильный элемент строки и сам же ссылка:
          отдельная кнопка «Источник» повторялась бы под каждым материалом. */}
      <h3 className="mt-1 text-pretty text-[1.0625rem] font-medium leading-snug">
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
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "mt-1.5 max-w-[62ch] cursor-pointer text-pretty text-sm leading-relaxed text-muted-foreground",
            !open && "line-clamp-2",
          )}
        >
          {item.summary}
        </p>
      ) : null}

    </article>
  );
}

