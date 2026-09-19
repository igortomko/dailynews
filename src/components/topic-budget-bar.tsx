"use client";

import { useRef } from "react";
import { colorAt, moveBoundary } from "@/lib/topic-budget";

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

  return (
    <div ref={bar} className="relative flex h-3 w-full touch-none gap-1 select-none">
      {counts.map((count, index) => (
        <div
          // Ключ по индексу, а не по названию: во время переименования
          // название пустое и неуникальное, и React путает сегменты.
          key={index}
          className="h-full rounded-full"
          style={{ flexGrow: count, flexBasis: 0, backgroundColor: colorAt(index) }}
        />
      ))}

      {counts.slice(0, -1).map((_, index) => (
        <div
          key={`boundary-${index}`}
          role="separator"
          tabIndex={0}
          aria-label={`Граница: ${labels[index]} и ${labels[index + 1]}`}
          aria-valuenow={counts[index]}
          aria-valuemin={1}
          aria-valuemax={counts[index] + counts[index + 1] - 1}
          aria-orientation="vertical"
          onPointerDown={startDrag(index)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") { event.preventDefault(); nudge(index, -1); }
            if (event.key === "ArrowRight") { event.preventDefault(); nudge(index, 1); }
          }}
          style={{ left: `${(upTo(index) / total) * 100}%` }}
          className="absolute top-1/2 h-6 w-4 -translate-x-1/2 -translate-y-1/2 cursor-col-resize rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        />
      ))}
    </div>
  );
}
