"use client";

import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ru } from "react-day-picker/locale";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Spinner } from "@/components/ui/spinner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Стрелка, которая сообщает о работе. Выпуск — серверная страница, и между
 * нажатием и новой лентой на медленной сети проходят секунды: без признака
 * работы нажатие читается как «не сработало», и его повторяют.
 *
 * Про переход знает сам Next — useLinkStatus внутри <Link>; своё состояние
 * тут завелось бы рядом с настоящим и разошлось бы с ним при первой отмене.
 */
function Arrow({ icon: Icon }: { icon: typeof ChevronLeftIcon }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <Spinner className="size-5 sm:size-4" />
  ) : (
    <Icon className="size-5 sm:size-4" />
  );
}

const FORMAT = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" });

/** Локальная дата без часового пояса: «2026-09-19» — это день, а не момент. */
const toDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * Выпуски листаются датами. Стрелками — соседние, календарём — далёкие:
 * добираться до прошлого месяца тридцатью нажатиями невозможно.
 *
 * Дни без выпуска в календаре выключены: выбор даты, за которую ничего нет,
 * приводит на пустую страницу и выглядит поломкой.
 */
export function DateNav({ day, days }: { day: string; days: string[] }) {
  const [open, setOpen] = useState(false);
  const [going, startGoing] = useTransition();
  const router = useRouter();

  const index = days.indexOf(day);
  const newer = index > 0 ? days[index - 1] : null;
  const older = index >= 0 && index < days.length - 1 ? days[index + 1] : null;
  const available = new Set(days);

  // 40 пикселей на телефоне против 28 на мыши: под палец меньшая цель
  // промахивается, а на указателе лишний размер только разъезжается.
  const arrow = "flex size-10 items-center justify-center rounded-md transition-colors sm:size-7";

  return (
    <div className="flex items-center gap-1 text-sm font-medium">
      {older ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href={`/?day=${older}`}
                aria-label="Предыдущий выпуск"
                className={cn(arrow, "hover:bg-muted")}
              />
            }
          >
            <Arrow icon={ChevronLeftIcon} />
          </TooltipTrigger>
          <TooltipContent>Предыдущий выпуск</TooltipContent>
        </Tooltip>
      ) : (
        <span aria-hidden className={cn(arrow, "text-muted-foreground/30")}>
          <ChevronLeftIcon className="size-5 sm:size-4" />
        </span>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Выбрать дату"
              className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-2 tabular-nums transition-colors hover:bg-muted sm:px-1.5 sm:py-0.5"
            />
          }
        >
            {going ? <Spinner className="size-4" /> : null}
          {FORMAT.format(new Date(`${day}T12:00:00`))}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            locale={ru}
            defaultMonth={new Date(`${day}T12:00:00`)}
            selected={new Date(`${day}T12:00:00`)}
            disabled={(date) => !available.has(toDay(date))}
            onSelect={(date) => {
              if (!date) return;
              setOpen(false);
              // Переход в переходе: выпуск за другой день собирается
              // на сервере, и до его прихода страница остаётся прежней.
              // Без признака работы это выглядит как «календарь не сработал».
              startGoing(() => router.push(`/?day=${toDay(date)}`));
            }}
          />
        </PopoverContent>
      </Popover>

      {newer ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href={`/?day=${newer}`}
                aria-label="Следующий выпуск"
                className={cn(arrow, "hover:bg-muted")}
              />
            }
          >
            <Arrow icon={ChevronRightIcon} />
          </TooltipTrigger>
          <TooltipContent>Следующий выпуск</TooltipContent>
        </Tooltip>
      ) : (
        <span aria-hidden className={cn(arrow, "text-muted-foreground/30")}>
          <ChevronRightIcon className="size-5 sm:size-4" />
        </span>
      )}
    </div>
  );
}
