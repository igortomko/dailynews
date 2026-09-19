"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Переключатель светлой и тёмной темы.
 *
 * Положения два, а не три. «Как в системе» остаётся значением по умолчанию
 * и действует, пока его не отменили нажатием: первый заход идёт за системной
 * настройкой, и отдельный пункт «системная» в переключателе спрашивал бы
 * о том, что уже решено. Нажатие закрепляет выбор — он переживает
 * перезагрузку и живёт только в этом браузере.
 *
 * Какая иконка видна, решает правило CSS, а не ветка в коде. На сервере
 * текущей темы не знает никто: класс на <html> ставит скрипт next-themes
 * уже в браузере. Ветка по resolvedTheme при отрисовке разошлась бы
 * с серверной разметкой, и отказ выглядел бы не ошибкой, а миганием иконки
 * при каждом заходе.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Переключить тему"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className={cn(
              "text-muted-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground",
              className,
            )}
          />
        }
      >
        {/* Иконки не подменяются, а перетекают одна в другую: обе лежат
            в разметке, верхняя поверх нижней. Появляющаяся растёт с 0.25
            и теряет размытие, уходящая — наоборот. Простое hidden/block
            даёт скачок, который на переключателе темы особенно заметен:
            цвет страницы меняется плавно, а иконка щёлкает. */}
        <span className="relative flex size-4 items-center justify-center">
          <SunIcon className="absolute scale-[0.25] opacity-0 blur-[4px] transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] dark:scale-100 dark:opacity-100 dark:blur-0" />
          <MoonIcon className="scale-100 opacity-100 blur-0 transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] dark:scale-[0.25] dark:opacity-0 dark:blur-[4px]" />
        </span>
      </TooltipTrigger>
      {/* Подпись называет то, что будет после нажатия, — как и иконка. */}
      <TooltipContent>
        <span className="dark:hidden">Тёмная тема</span>
        <span className="hidden dark:block">Светлая тема</span>
      </TooltipContent>
    </Tooltip>
  );
}
