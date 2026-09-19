"use client";

import { useRef, useState } from "react";
import { colorAt, moveBoundary } from "@/lib/topic-budget";
import { cn } from "@/lib/utils";

/**
 * Дайджест одной полосой: каждая тема — свой кусок, граница между соседями
 * тянется мышью или стрелками.
 *
 * Полоса показывает штуки, а не проценты, потому что цель темы хранится
 * штуками и отбор выдаёт примерно их. Процент пришлось бы переводить обратно
 * в места в голове читателя, а он и так знает, сколько новостей хочет.
 *
 * Что тянется — граница, а не сегмент: сколько ушло слева, столько пришло
 * справа. Тогда сумма не меняется, и размер дайджеста не уезжает сам собой,
 * пока подбираешь доли.
 *
 * Ручки показываются только у выбранного куска. Постоянно видимые ручки
 * на пяти темах — это четыре засечки поперёк полосы, и полоса перестаёт
 * читаться как доли; невидимые совсем — непонятно, что здесь вообще можно
 * тянуть. Поэтому кусок сначала выбирается, а тянется потом.
 */
export function TopicBudgetBar({
  labels,
  counts,
  onChange,
}: {
  labels: string[];
  counts: number[];
  onChange: (next: number[]) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const upTo = (index: number) => counts.slice(0, index + 1).reduce((sum, count) => sum + count, 0);

  /**
   * Считаем от снимка на момент нажатия, а не от текущего состояния: цель
   * задаётся абсолютной позицией границы, соседи по бокам в сумме постоянны,
   * и устаревший снимок здесь не ошибка, а то, что нужно.
   */
  const startDrag = (boundary: number) => (event: React.PointerEvent<HTMLElement>) => {
    const node = bar.current;
    if (!node || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const snapshot = [...counts];
    const rect = node.getBoundingClientRect();

    const move = (moved: PointerEvent) => {
      const at = ((moved.clientX - rect.left) / rect.width) * total;
      onChange(moveBoundary(snapshot, boundary, at));
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  const nudge = (boundary: number, by: number) =>
    onChange(moveBoundary(counts, boundary, upTo(boundary) + by));

  // Ручки выбранного куска: левая — граница с предыдущим, правая — со следующим.
  const handles = active === null
    ? []
    : [active - 1, active].filter((boundary) => boundary >= 0 && boundary < counts.length - 1);

  const shown = hovered ?? active;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Подпись держит высоту всегда: появляясь и исчезая, она дёргала бы
          вниз всё, что под полосой, ровно в момент перетаскивания. */}
      <div className="h-5 text-xs text-muted-foreground" aria-hidden>
        {shown !== null ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: colorAt(shown) }} />
            {labels[shown]} — {counts[shown]} из {total}
          </span>
        ) : null}
      </div>

      <div ref={bar} className="relative flex h-5 w-full touch-none gap-1 select-none">
        {counts.map((count, index) => (
          <button
            // Ключ по индексу, а не по названию: во время переименования
            // название пустое и неуникальное, и React путает сегменты.
            key={index}
            type="button"
            title={`${labels[index]} — ${counts[index]} из ${total}`}
            aria-label={`${labels[index]}, ${counts[index]} из ${total}`}
            aria-pressed={active === index}
            onClick={() => setActive(active === index ? null : index)}
            onPointerEnter={() => setHovered(index)}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered(index)}
            onBlur={() => setHovered(null)}
            className={cn(
              "h-full cursor-pointer rounded-full transition-opacity focus-visible:outline-none",
              active !== null && active !== index && "opacity-40",
              // У выбранного куска края под ручками распрямляются: скруглённый
              // цветной торец рядом с ручкой читается как зазор, и граница
              // выглядит не на своём месте.
              active === index && index > 0 && "rounded-l-none",
              active === index && index < counts.length - 1 && "rounded-r-none",
            )}
            style={{ flexGrow: count, flexBasis: 0, backgroundColor: colorAt(index) }}
          />
        ))}

        {handles.map((boundary) => (
          <div
            key={`handle-${boundary}`}
            role="separator"
            tabIndex={0}
            aria-label={`Граница: ${labels[boundary]} и ${labels[boundary + 1]}`}
            aria-valuenow={counts[boundary]}
            aria-valuemin={1}
            aria-valuemax={counts[boundary] + counts[boundary + 1] - 1}
            aria-orientation="vertical"
            onPointerDown={startDrag(boundary)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") { event.preventDefault(); nudge(boundary, -1); }
              if (event.key === "ArrowRight") { event.preventDefault(); nudge(boundary, 1); }
              if (event.key === "Escape") setActive(null);
            }}
            style={{ left: `${(upTo(boundary) / total) * 100}%` }}
            // Белая, а не тёмная: тёмная ручка на цветной полосе читается
            // как ещё один кусок, только чёрный.
            className="absolute top-1/2 h-7 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-col-resize rounded-full border border-foreground/15 bg-background shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        ))}
      </div>
    </div>
  );
}
