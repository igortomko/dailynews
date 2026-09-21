"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { setUiLanguage } from "@/lib/actions";
import { LOCALES, LOCALE_LABELS, LOCALE_SHORT } from "@/lib/i18n";
import { useLocale, useT } from "@/components/i18n-provider";

/**
 * Язык интерфейса, рядом с переключателем темы.
 *
 * Кнопка, а не список: языков два, и список из двух пунктов — это два
 * нажатия там, где хватает одного. Появится третий — здесь встанет меню,
 * и это будет видно по самому списку, а не по догадке.
 *
 * Кнопка показывает текущий язык, а не тот, на который переключит. Тема
 * рядом делает наоборот, и это не разнобой: у темы нет имени на экране,
 * кроме самой иконки, а язык — это подпись, и подпись «RU» на английском
 * интерфейсе читалась бы как «интерфейс русский». Что будет после нажатия,
 * говорит подсказка.
 */
export function LocaleToggle({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useT();
  const [pending, startTransition] = useTransition();

  const next = LOCALES.find((entry) => entry !== locale) ?? locale;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.locale.toggle}
            disabled={pending}
            onClick={() => startTransition(() => void setUiLanguage(next))}
            className={cn(
              "text-[0.6875rem] font-medium text-muted-foreground/50 tabular-nums transition-colors hover:text-foreground focus-visible:text-foreground",
              className,
            )}
          />
        }
      >
        {LOCALE_SHORT[locale]}
      </TooltipTrigger>
      <TooltipContent>{t.locale.pick(LOCALE_LABELS[next])}</TooltipContent>
    </Tooltip>
  );
}
