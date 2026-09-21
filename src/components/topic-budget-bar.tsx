"use client";

import { useRef } from "react";
import { colorAt, handleLeft, moveBoundary } from "@/lib/topic-budget";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

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
 * Имя и число каждой темы подписаны под её куском и видны всегда. Раньше
 * их показывала одна строка над полосой — та, на которую наведён курсор,
 * — и ручки появлялись тоже по наведению: с пальца не наступает ни то,
 * ни другое, и полоса на телефоне была картинкой, а не настройкой.
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
  const t = useT();
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

  return (
    <div className="flex flex-col gap-2">
      {/* Полоса сплошная и скруглена только по торцам: зазор между цветными
          кусками читается как ещё одна граница, и рядом с настоящей ручкой
          их становится две. */}
      <div
        ref={bar}
        className="relative flex h-5 w-full touch-none select-none"
      >
        {counts.map((count, index) => (
          <div
            // Ключ по индексу, а не по названию: во время переименования
            // название пустое и неуникальное, и React путает сегменты.
            key={index}
            // Кусок — картинка: нажимать на нём нечего, имя и число читаются
            // подписью под ним, а тянется граница. Кнопка без действия
            // ловила бы и фокус, и палец, ничего при этом не делая.
            aria-hidden
            // Скругление по номеру, а не через `last:`: ручки лежат в том же
            // флексе и стоят в разметке после кусков, поэтому последним
            // ребёнком оказывалась ручка, а правый торец полосы — прямым.
            className={cn(
              "h-full",
              index === 0 && "rounded-l-full",
              index === counts.length - 1 && "rounded-r-full",
            )}
            style={{ flexGrow: count, flexBasis: 0, backgroundColor: colorAt(index) }}
          />
        ))}

        {counts.slice(0, -1).map((_, boundary) => (
          <div
            key={`handle-${boundary}`}
            role="separator"
            tabIndex={0}
            aria-label={t.settings.topicBudgetBar.boundaryAria(labels[boundary], labels[boundary + 1])}
            aria-valuenow={counts[boundary]}
            aria-valuemin={1}
            aria-valuemax={counts[boundary] + counts[boundary + 1] - 1}
            aria-orientation="vertical"
            onPointerDown={startDrag(boundary)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") { event.preventDefault(); nudge(boundary, -1); }
              if (event.key === "ArrowRight") { event.preventDefault(); nudge(boundary, 1); }
            }}
            style={{ left: handleLeft(counts, boundary) }}
            // Белая всегда, а не цвета фона: в тёмной теме фон почти чёрный,
            // и ручка на цветной полосе читалась не как ручка, а как дырка
            // между кусками — то есть ровно как то, чего на полосе нет.
            className="absolute top-1/2 h-7 w-3 -translate-x-1/2 -translate-y-1/2 cursor-col-resize rounded-full border border-black/15 bg-white shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        ))}
      </div>

      {/* Подписи в тех же долях, что и куски: имя над числом, обе строки
          по центру своего куска. Длинное имя в узком куске обрезается —
          число под ним остаётся читаемым, а оно и есть настройка. */}
      <div className="flex w-full">
        {counts.map((count, index) => (
          <div
            key={index}
            // Обрезаем и ячейку: у темы с одной новостью из ста доля почти
            // нулевая, и число под ней вылезало бы на соседей слипшимся
            // комком цифр — ровно того, что подпись должна была спасти.
            className="min-w-0 overflow-hidden px-0.5 text-center"
            style={{ flexGrow: count, flexBasis: 0 }}
          >
            <div className="truncate text-[11px] leading-tight text-muted-foreground">
              {labels[index]}
            </div>
            <div className="text-sm leading-tight font-medium tabular-nums">
              {count}
              <span className="sr-only">{t.settings.topicBudgetBar.ofTotalSuffix(total)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
