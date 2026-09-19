"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/lib/queries";

/** Ниже этого порога раскрытие карточки — промах, а не чтение. */
const DWELL_FLOOR_MS = 4000;

function report(body: { item_id: number; event: string; dwell_ms?: number }, beacon = false) {
  const json = JSON.stringify(body);
  if (beacon && typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon("/api/read", new Blob([json], { type: "application/json" }));
    return;
  }
  void fetch("/api/read", { method: "POST", body: json, keepalive: true });
}

const KIND_LABEL: Record<string, string> = {
  fact: "факт",
  forecast: "прогноз",
  opinion: "мнение",
  announcement: "анонс",
  reprint: "перепечатка",
};

const HORIZON_LABEL: Record<string, string> = {
  years: "годы",
  months: "месяцы",
  noise: "шум дня",
};

export function ItemCard({ item }: { item: FeedItem }) {
  const [open, setOpen] = useState(false);
  const openedAt = useRef<number | null>(null);

  // Время на карточке отправляется при закрытии и при уходе со страницы:
  // без второго случая теряются ровно те материалы, которые дочитали
  // и сразу закрыли вкладку.
  useEffect(() => {
    if (!open) return;
    openedAt.current = Date.now();
    report({ item_id: item.id, event: "opened" });

    const flush = () => {
      if (openedAt.current === null) return;
      const dwell = Date.now() - openedAt.current;
      openedAt.current = null;
      if (dwell >= DWELL_FLOOR_MS) {
        report({ item_id: item.id, event: "dwell", dwell_ms: dwell }, true);
      }
    };

    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
    };
  }, [open, item.id]);

  const title = item.title_ru || item.title;
  const clickbait = item.axes?.clickbait?.noul ?? 0;

  return (
    <Card className={cn("transition-colors", item.read_count > 0 && "opacity-60")}>
      <CardHeader>
        <CardTitle
          className="cursor-pointer text-balance"
          onClick={() => setOpen((value) => !value)}
        >
          {title}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span>{item.source_label}</span>
          <span aria-hidden>·</span>
          <span>{item.day}</span>
          {item.topic_label ? <Badge variant="secondary">{item.topic_label}</Badge> : null}
          <Badge variant="outline">{KIND_LABEL[item.axes?.kind?.choice] ?? "—"}</Badge>
          <Badge variant="outline">{HORIZON_LABEL[item.axes?.horizon?.choice] ?? "—"}</Badge>
          {clickbait > 0.6 ? <Badge variant="destructive">кликбейт</Badge> : null}
        </CardDescription>
      </CardHeader>

      {open ? (
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{item.summary || "Саммари не записано."}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
            <Axis name="скор" value={item.total.toFixed(0)} />
            <Axis name="уверенность" value={`${Math.round(item.confidence * 100)}%`} />
            <Axis name="новизна" value={`${item.axes?.novelty?.score?.toFixed(1) ?? "—"} / 2`} />
            <Axis name="конкретика" value={`${item.axes?.specifics?.score?.toFixed(1) ?? "—"} / 2`} />
          </dl>
        </CardContent>
      ) : null}

      <CardFooter>
        <Button
          variant="outline"
          size="sm"
          render={
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => report({ item_id: item.id, event: "outbound" })}
            />
          }
        >
          <ExternalLinkIcon data-icon="inline-start" />
          Источник
        </Button>
      </CardFooter>
    </Card>
  );
}

function Axis({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt>{name}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
