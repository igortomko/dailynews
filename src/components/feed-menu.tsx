"use client";

import Link from "next/link";
import { EllipsisIcon, MoonIcon, SearchIcon, SettingsIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

/**
 * Поиск, тема и настройки одной кнопкой — на телефоне.
 *
 * Три иконки подряд отнимали у шапки около ста двадцати пикселей из трёхсот
 * семидесяти пяти, и под дату оставалось столько, что «22 сентября 2026 г.»
 * складывалось в две строки, а окно — в три. Из трёх кнопок каждый день
 * нажимают одну, и та не всегда одна и та же: держать их все на виду —
 * значит платить шириной за то, чем пользуются по очереди.
 *
 * На широком экране меню нет: там место есть, а лишнее нажатие ради того,
 * что и так видно, — это плата без покупки.
 *
 * Монтируется по первому нажатию, как меню карточки: пятьдесят закрытых
 * Dialog при каждом показе выпуска здесь уже проходили.
 */
export function FeedMenu({ onSearch, className }: { onSearch: () => void; className?: string }) {
  const t = useT();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t.feed.page.moreActions}
            className={cn(
              "flex size-10 cursor-pointer items-center justify-center rounded-md",
              "text-muted-foreground/50 transition-colors aria-expanded:bg-muted aria-expanded:text-foreground",
              className,
            )}
          />
        }
      >
        <EllipsisIcon className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={onSearch}>
          <SearchIcon />
          {t.feed.search.label}
        </DropdownMenuItem>
        {/* Какая тема сейчас, решает CSS, а не ветка в коде: на сервере
            текущей темы не знает никто — класс на <html> ставит скрипт
            next-themes уже в браузере, — и ветка по resolvedTheme при
            отрисовке разошлась бы с разметкой. Подпись называет то, что
            будет после нажатия, как и в переключателе рядом. */}
        <DropdownMenuItem onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          <span className="relative flex size-4 items-center justify-center">
            <SunIcon className="absolute hidden dark:block" />
            <MoonIcon className="dark:hidden" />
          </span>
          <span className="dark:hidden">{t.theme.dark}</span>
          <span className="hidden dark:inline">{t.theme.light}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<Link href="/settings/personalization" prefetch={true} />}
        >
          <SettingsIcon />
          {t.nav.settings}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
