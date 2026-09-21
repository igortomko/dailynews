"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchForm } from "@/components/search-form";

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
 * Поле на всю строку шапки. Сама форма общая со страницей результатов:
 * адрес и имя параметра у них обязаны совпадать, а две копии договора
 * расходятся с первой правкой любой из них.
 */
export function SearchField({ onClose }: { onClose: () => void }) {
  return (
    <SearchForm
      autoFocus
      placeholder="Найти в прошлых выпусках: uranium дата-центры"
      className="flex w-full items-center gap-2"
      // Escape возвращает ленту на место. Без него поле закрывается только
      // мышью, а открывают его с клавиатуры.
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
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
    </SearchForm>
  );
}
