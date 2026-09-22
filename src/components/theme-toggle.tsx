"use client";

import { useCallback } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { useHotkey } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

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
  const t = useT();
  const toggle = useCallback(
    () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    [resolvedTheme, setTheme],
  );
  // Клавиша живёт здесь, а не в ленте: переключатель стоит и в настройках,
  // и в поиске, а подсказка обещает клавишу на каждом из этих экранов.
  useHotkey("KeyT", toggle);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.theme.toggle}
            onClick={toggle}
            className={cn(
              "text-muted-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground",
              className,
            )}
          />
        }
      >
        {/* Иконки не подменяются, а перетекают одна в другую: обе лежат
            в разметке, верхняя поверх нижней. Появляющаяся растёт с 0.25,
            уходящая съёживается. Простое hidden/block даёт скачок, который
            на переключателе темы особенно заметен: цвет страницы меняется
            плавно, а иконка щёлкает.

            Размытия в переходе нет. Оно тут стояло и читалось грязью:
            на значке в шестнадцать пикселей четыре пиксела blur размазывают
            весь рисунок, и середина перехода выглядит не мягкой, а мыльной.
            На крупной картинке тот же приём работает, на иконке — нет. */}
        <span className="relative flex size-4 items-center justify-center">
          <SunIcon className="absolute scale-[0.25] opacity-0 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] dark:scale-100 dark:opacity-100" />
          <MoonIcon className="scale-100 opacity-100 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] dark:scale-[0.25] dark:opacity-0" />
        </span>
      </TooltipTrigger>
      {/* Подпись называет то, что будет после нажатия, — как и иконка. */}
      <TooltipContent>
        <span className="dark:hidden">{t.theme.dark}</span>
        <span className="hidden dark:block">{t.theme.light}</span>
        <Kbd>t</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
