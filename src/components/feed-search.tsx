"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Поиск начинается прямо в ленте: нажатие раскрывает поле в шапке, а уводит
 * на страницу результатов уже отправка. Иконка, ведущая на пустую страницу
 * с полем, — это лишний переход ради того же самого действия: набрать слово.
 *
 * Кнопка и поле — две половины одного, и состояние между ними держит шапка
 * (`feed-tabs`): открытое поле занимает всю строку, а строку рисует она.
 * Наложить поле поверх строки было проще, но под ним остались бы живые
 * стрелки дат и шестерёнка: обратный Tab уходил бы на кнопки, которых
 * не видно.
 */
export function SearchButton({
  onOpen,
  ref,
}: {
  onOpen: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            variant="ghost"
            size="icon-sm"
            aria-label="Поиск по выпускам"
            onClick={onOpen}
            className="size-10 text-muted-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground sm:size-8 [&_svg]:size-5 sm:[&_svg]:size-4"
          />
        }
      >
        <SearchIcon />
      </TooltipTrigger>
      <TooltipContent>Поиск по прошлым выпускам — клавиша /</TooltipContent>
    </Tooltip>
  );
}

/**
 * Поле на всю строку шапки. Форма обычная, GET: результат — это адрес,
 * его можно сохранить и переслать себе же, а отправка работает и до того,
 * как страница ожила.
 */
export function SearchField({ onClose }: { onClose: () => void }) {
  return (
    <form action="/search" className="flex w-full items-center gap-2">
      <Input
        type="search"
        name="q"
        autoFocus
        enterKeyHint="search"
        placeholder="Найти в прошлых выпусках: uranium дата-центры"
        aria-label="Поиск по выпускам"
        // Escape возвращает ленту на место. Без него поле закрывается только
        // мышью, а открывают его с клавиатуры.
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="h-10 sm:h-8"
      />
      {/* Кнопка отправки есть, хотя её и не видно: форма с одним полем
          уходит по Enter и без неё, но это поведение самого браузера,
          и проверить его нечем. Явная кнопка отправляет форму везде
          одинаково и даёт клавиатуре и читалке экрана то, что нажимают. */}
      <button type="submit" className="sr-only">
        Найти
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Закрыть поиск"
        onClick={onClose}
        className="size-10 shrink-0 text-muted-foreground/50 transition-colors hover:text-foreground sm:size-8 [&_svg]:size-5 sm:[&_svg]:size-4"
      >
        <XIcon />
      </Button>
    </form>
  );
}
