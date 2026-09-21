"use client";

import { ru, enUS } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { toDay } from "@/lib/day";

/**
 * Календарь выбора дня — отдельным модулем, чтобы шапка ленты грузила его
 * лениво: react-day-picker с локалями — 180 КБ, а нужен он тому, кто открыл
 * выбор даты, не каждому, кто открыл ленту. Локали лежат здесь же, а не
 * в шапке: иначе словари date-fns уезжали бы в общий бандл вместе с ней.
 *
 * Дни без выпуска выключены: выбор даты, за которую ничего нет, приводит
 * на пустую страницу и выглядит поломкой.
 */
export function DayPicker({
  day,
  available,
  locale,
  onPick,
}: {
  day: string;
  available: Set<string>;
  locale: string;
  onPick: (day: string) => void;
}) {
  return (
    <Calendar
      mode="single"
      locale={locale === "ru" ? ru : enUS}
      defaultMonth={new Date(`${day}T12:00:00`)}
      selected={new Date(`${day}T12:00:00`)}
      disabled={(date) => !available.has(toDay(date))}
      onSelect={(date) => {
        if (date) onPick(toDay(date));
      }}
    />
  );
}
