"use client";

import { useEffect, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Поиск начинается прямо в ленте: нажатие раскрывает поле в шапке, а уводит
 * на страницу результатов уже Enter. Иконка, ведущая на пустую страницу
 * с полем, — это лишний переход ради того же самого действия: набрать слово.
 *
 * Поле раскрывается поверх всей строки шапки, а не втискивается между датой
 * и шестерёнкой: на телефоне между ними остаётся сантиметр, и поле там либо
 * нечитаемо, либо выдавливает дату за экран.
 *
 * Форма обычная, GET: результат — это адрес, его можно сохранить и переслать
 * себе же, а отправка работает и до того, как страница ожила.
 */
export function FeedSearch() {
  const [open, setOpen] = useState(false);

  /**
   * «/» — как везде, где есть поиск. Проверяются обе стороны: в кириллице
   * та же клавиша отдаёт «.», а «/» приезжает с другой, и проверка по одному
   * признаку молча перестала бы работать у половины читателей.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      if (event.code !== "Slash" && event.key !== "/") return;
      event.preventDefault();
      setOpen(true);
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!open) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Поиск по выпускам"
              onClick={() => setOpen(true)}
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

  return (
    <form
      action="/search"
      // Поверх строки шапки, а не внутри неё: строку рисует лента, и место
      // под поле в ней не заложено. Фон обязателен — под ним лежит дата.
      className="absolute inset-0 z-20 flex items-center gap-2 bg-background px-4"
    >
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
          if (event.key === "Escape") setOpen(false);
        }}
        className="h-10 sm:h-8"
      />
      {/* Кнопка отправки есть, хотя её и не видно: форма с одним полем
          отправляется по Enter и без неё, но это поведение самого браузера,
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
        onClick={() => setOpen(false)}
        className="size-10 shrink-0 text-muted-foreground/50 transition-colors hover:text-foreground sm:size-8 [&_svg]:size-5 sm:[&_svg]:size-4"
      >
        <XIcon />
      </Button>
    </form>
  );
}
