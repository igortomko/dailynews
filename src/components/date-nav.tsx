"use client";

import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/components/i18n-provider";
import { formatDayRange } from "@/lib/relative-time";
import { feedHref, windowStart } from "@/lib/day";

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

/**
 * Календарь приезжает отдельным куском по первому открытию: 180 КБ
 * react-day-picker не нужны тому, кто листает дни стрелками. ssr: false —
 * содержимое поповера и так рисуется только в браузере. Заглушка держит
 * место календаря, чтобы поповер не подпрыгивал, когда кусок доедет.
 */
const DayPicker = dynamic(() => import("@/components/day-picker").then((m) => m.DayPicker), {
  ssr: false,
  loading: () => (
    <div className="flex h-72 w-[13.25rem] items-center justify-center">
      <Spinner />
    </div>
  ),
});

/**
 * Выпуски листаются датами. Стрелками — соседние, календарём — далёкие:
 * добираться до прошлого месяца тридцатью нажатиями невозможно.
 *
 * Дни без выпуска в календаре выключены: выбор даты, за которую ничего нет,
 * приводит на пустую страницу и выглядит поломкой.
 *
 * Стрелки двигают якорь, а длину окна и заказ времени несут дальше —
 * в том числе в prefetch. Без этого «следующий день» молча выбрасывал бы
 * из режима «читаю по три дня», и вернуться в него можно было бы только
 * через календарь.
 */
export function DateNav({
  day,
  days,
  span,
  minutes,
}: {
  day: string;
  days: string[];
  /** Длина окна в днях: 1 — обычный выпуск. */
  span: number;
  /** Заказанные минуты или null — «всё время». */
  minutes: number | null;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [going, startGoing] = useTransition();
  const router = useRouter();

  const index = days.indexOf(day);
  const newer = index > 0 ? days[index - 1] : null;
  const older = index >= 0 && index < days.length - 1 ? days[index + 1] : null;
  const available = new Set(days);
  // Окно называется целиком, а не одним якорем: «22 сент.» над лентой
  // из пяти выпусков — это дата, которая не отвечает за то, что под ней.
  // Одиночный день идёт через ту же функцию: Intl отдаёт «22 сент.», когда
  // концы совпадают, и две формы записи одной кнопки разъехаться не могут.
  const label = formatDayRange(windowStart(day, span), day, locale);

  // 40 пикселей на телефоне против 28 на мыши: под палец меньшая цель
  // промахивается, а на указателе лишний размер только разъезжается.
  // Видимый размер и область нажатия — разные вещи. На указателе стрелка
  // в 28 пикселей выглядит уместно, но попасть в неё тяжело; псевдоэлемент
  // растягивает цель до сорока, ничего не меняя на вид. Больше нельзя:
  // соседняя цель — сама дата, и пересекаться им не положено.
  const arrow =
    "relative flex size-10 items-center justify-center rounded-md transition-[color,background-color] duration-150 after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2 sm:size-7";

  return (
    <div className="flex items-center gap-2 text-sm font-medium">
      {older ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href={feedHref(older, span, minutes)}
                // Соседний выпуск подгружается сразу, пока читают этот:
                // переключение дня становится мгновенным, а не ждёт сервер.
                // Цена — один-два фоновых рендера ленты на показ. Скрытая
                // карточка меняет только выпуск своего дня, а его соседи
                // подгружают заново уже после ухода с него.
                prefetch={true}
                aria-label={t.feed.dateNav.previous}
                className={cn(arrow, "hover:bg-muted")}
              />
            }
          >
            <Arrow icon={ChevronLeftIcon} />
          </TooltipTrigger>
          <TooltipContent>{t.feed.dateNav.previous}</TooltipContent>
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
              aria-label={t.feed.dateNav.pickDate}
              // whitespace-nowrap: дата — цельная подпись, и перенос ломает
              // её на «22» и «сент.» в две строки, а высота шапки задана.
              // На телефоне поля узкие: под дату в строке остаётся около
              // шестидесяти пикселей, и каждые восемь из них решают,
              // встанет она в строку или сложится.
              className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-1 py-2 text-center whitespace-nowrap tabular-nums transition-colors hover:bg-muted sm:min-h-0 sm:px-1.5 sm:py-0.5"
            />
          }
        >
            {going ? <Spinner className="size-4" /> : null}
          {label}
        </PopoverTrigger>
        {/* Календарь прибит к экрану, а не к странице: кнопка даты живёт
            в прибитой шапке и при прокрутке остаётся на месте, а слежение
            за ней пересчитывало положение каждым кадром и отставало от него
            — календарь дёргался, пока страница едет. Считаем один раз
            при открытии и больше не трогаем. */}
        <PopoverContent
          align="start"
          positionMethod="fixed"
          disableAnchorTracking
          className="w-auto p-0"
        >
          <DayPicker
            day={day}
            days={span}
            available={available}
            locale={locale}
            onPick={(picked, pickedDays) => {
              setOpen(false);
              // Переход в переходе: выпуск за другой день собирается
              // на сервере, и до его прихода страница остаётся прежней.
              // Без признака работы это выглядит как «календарь не сработал».
              // Заказ времени переживает выбор окна: это две разные ручки
              // одного экрана, и одна не должна сбрасывать другую.
              startGoing(() => router.push(feedHref(picked, pickedDays, minutes)));
            }}
          />
        </PopoverContent>
      </Popover>

      {newer ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href={feedHref(newer, span, minutes)}
                prefetch={true}
                aria-label={t.feed.dateNav.next}
                className={cn(arrow, "hover:bg-muted")}
              />
            }
          >
            <Arrow icon={ChevronRightIcon} />
          </TooltipTrigger>
          <TooltipContent>{t.feed.dateNav.next}</TooltipContent>
        </Tooltip>
      ) : (
        <span aria-hidden className={cn(arrow, "text-muted-foreground/30")}>
          <ChevronRightIcon className="size-5 sm:size-4" />
        </span>
      )}
    </div>
  );
}
