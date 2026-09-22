"use client";

import { ru, enUS } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { FEED_DAYS_MAX, toDay, windowStart } from "@/lib/day";
import type { Locale } from "@/lib/i18n/locale";

/**
 * Календарь выбора окна — отдельным модулем, чтобы шапка ленты грузила его
 * лениво: react-day-picker с локалями — 180 КБ, а нужен он тому, кто открыл
 * выбор даты, не каждому, кто открыл ленту. Локали лежат здесь же, а не
 * в шапке: иначе словари date-fns уезжали бы в общий бандл вместе с ней.
 *
 * Диапазон, а не один день: пропустил три дня — отметил их разом и получил
 * одну ленту вместо трёх. Один день остаётся частным случаем диапазона —
 * нажатие на уже выбранный край сворачивает окно в него.
 *
 * Дни без выпуска выключены, и это про концы окна, а не про его середину:
 * якорь, за который выпуска нет, увёл бы на последний выпуск и молча
 * выбросил из режима. Внутри окна такие дни просто отсутствуют —
 * `excludeDisabled` не ставим, иначе выбранное окно обрезалось бы само.
 */
export function DayPicker({
  day,
  days,
  available,
  locale,
  onPick,
}: {
  day: string;
  days: number;
  available: Set<string>;
  locale: Locale;
  onPick: (day: string, days: number) => void;
}) {
  const start = windowStart(day, days);
  return (
    <Calendar
      mode="range"
      locale={locale === "ru" ? ru : enUS}
      defaultMonth={new Date(`${day}T12:00:00`)}
      selected={{ from: new Date(`${start}T12:00:00`), to: new Date(`${day}T12:00:00`) }}
      // Предел в неделю — это предел счёта за страницу, а не продуктовое
      // решение: пять выпусков по сорок карточек это впятеро больший HTML.
      // Ставится самим календарём, а не обрезкой после выбора: обрезанное
      // окно выглядело бы как «календарь выбрал не то, что я отметил»,
      // а так слишком широкий выбор просто начинает отметку заново.
      //
      // Минус единица не описка: внутри библиотеки это разница дат, а не
      // число дней окна, и семь суток между краями — это восемь выпусков.
      // Адрес всё равно прижимает своё (`feedWindow`), но календарь должен
      // показывать ровно то, что придёт.
      max={FEED_DAYS_MAX - 1}
      disabled={(date) => !available.has(toDay(date))}
      onSelect={(range) => {
        // Неполный диапазон — это первое из двух нажатий (или отметка шире
        // недели, которую календарь начал заново). Уходить с ним некуда:
        // ждём второго нажатия.
        if (!range?.from || !range.to) return;
        const from = toDay(range.from);
        const to = toDay(range.to);
        onPick(to, Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1);
      }}
    />
  );
}
