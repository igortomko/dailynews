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
        <SunIcon className="hidden dark:block" />
        <MoonIcon className="dark:hidden" />
      </TooltipTrigger>
      {/* Подпись называет то, что будет после нажатия, — как и иконка. */}
      <TooltipContent>
        <span className="dark:hidden">Тёмная тема</span>
        <span className="hidden dark:block">Светлая тема</span>
      </TooltipContent>
    </Tooltip>
  );
}
