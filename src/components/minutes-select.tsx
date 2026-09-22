"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";
import { feedHref, FEED_MINUTES } from "@/lib/day";
import { formatMinutes } from "@/lib/reading-time";

/** Значение «всё время» в списке: у Select значение обязано быть строкой. */
const ALL = "all";

/**
 * Сколько времени есть на чтение — на месте, где и так стояло время выпуска.
 *
 * Время показанного было подписью, и подпись превратилась в ручку: вопрос
 * «сколько это читать» и вопрос «сколько у меня есть» задают в одном месте
 * и в одну секунду. Кнопка показывает настоящее время того, что на экране,
 * а не заказ: при отсечке они почти совпадают, но в тихий день показанное
 * короче — и число обязано говорить про ленту, а не про намерение.
 *
 * Правило одно на окно и на один день: заказ работает и там, где выпуск
 * ровно один (урок `nudgeTopic` — одно нажатие не может означать разное
 * в двух местах одного экрана).
 *
 * Показывается везде, включая телефон. Сценарий «пропустил три дня» —
 * телефонный в первую очередь, а элемента, которого на телефоне нет,
 * для него не существует.
 */
export function MinutesSelect({
  day,
  days,
  minutes,
  shown,
  className,
}: {
  day: string;
  /** Длина окна: уходит в адрес вместе с заказом, иначе выбор минут вышвыривает из окна. */
  days: number;
  /** Заказанное или null — «всё время». */
  minutes: number | null;
  /** Настоящее время того, что на экране. */
  shown: number;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [going, startGoing] = useTransition();

  return (
    <Select
      value={minutes === null ? ALL : String(minutes)}
      onValueChange={(value: string | null) => {
        if (!value) return;
        const next = value === ALL ? null : Number(value);
        if (next === minutes) return;
        startGoing(() => router.push(feedHref(day, days, next)));
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={t.feed.minutes.label}
        disabled={going}
        // Высота задаётся тем же вариантом, которым её задаёт сам компонент
        // (`data-[size=sm]:h-7`): простой `h-10` рядом с ним проигрывает
        // по весу и не делает ничего. Под палец 40, на указателе 32 —
        // как у соседей по шапке.
        className={cn(
          "w-auto shrink-0 gap-1 border-0 px-1.5 text-sm text-muted-foreground tabular-nums hover:text-foreground",
          "data-[size=sm]:h-10 sm:data-[size=sm]:h-8",
          className,
        )}
      >
        {going ? <Spinner className="size-4" /> : null}
        {/* Подпись собирается здесь, а не берётся у выбранного пункта:
            в меню стоят заказы (10/20/30/Все), а на кнопке — время ленты.
            Совпади они — «~10 мин» горело бы и в тихий день, когда всего
            выпуска на шесть. */}
        <SelectValue>{formatMinutes(shown, t.feed.time)}</SelectValue>
      </SelectTrigger>
      {/* Обычный список, не подтянутый выбранным пунктом к полю: в шапке
          такой наезжает на саму шапку, и выбранное оказывается поверх
          кнопки, которой его выбирают. */}
      <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-36">
        {FEED_MINUTES.map((entry) => (
          <SelectItem key={entry} value={String(entry)}>
            {t.feed.minutes.option(entry)}
          </SelectItem>
        ))}
        <SelectItem value={ALL}>{t.feed.minutes.all}</SelectItem>
      </SelectContent>
    </Select>
  );
}
