"use client";

import { useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { setUiLanguage } from "@/lib/actions";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n";
import { useLocale, useT } from "@/components/i18n-provider";

/**
 * Язык интерфейса. Живёт только в настройках, рядом с переключателем темы.
 *
 * В ленте его нет намеренно: язык выбирают один раз и меняют редко, а место
 * в шапке ленты занято тем, чем пользуются каждый день, — датой, поиском
 * и выходом в настройки. Кнопка, которую нажимают раз в жизни, стоит там,
 * куда за ней и приходят.
 *
 * Список, а не кнопка-перевёртыш: у перевёртыша нет места назвать язык,
 * на который он переключит, и всё, что остаётся, — подпись из двух знаков
 * и подсказка, которой нет на тапе. Список называет оба языка словами
 * и не заставляет гадать, что случится после нажатия.
 *
 * Язык назван на себе самом: «Russian» ищет глазами тот, кто и так читает
 * по-английски, а тот, кому нужен русский, ищет «Русский».
 */
export function LocaleToggle({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useT();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      value={locale}
      onValueChange={(value: string | null) => {
        if (!value || value === locale) return;
        startTransition(() => void setUiLanguage(value));
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={t.locale.toggle}
        disabled={pending}
        // Высота задаётся через тот же вариант, которым её задаёт сам
        // компонент (`data-[size=sm]:h-7`): простой `h-10` рядом с ним
        // проигрывает по весу и не делает ничего. Под палец 40, на указателе
        // 32 — как у переключателя темы рядом.
        className={cn(
          "w-auto gap-1 border-0 text-muted-foreground hover:text-foreground",
          "data-[size=sm]:h-10 sm:data-[size=sm]:h-8",
          className,
        )}
      >
        <SelectValue>{LOCALE_LABELS[locale]}</SelectValue>
      </SelectTrigger>
      {/* Обычный список, не подтянутый выбранным пунктом к полю: в шапке
          такой список наезжает на саму шапку, и выбранный язык оказывается
          поверх кнопки, которой его выбирают. */}
      <SelectContent alignItemWithTrigger={false} align="end" className="w-auto min-w-32">
        {LOCALES.map((entry) => (
          <SelectItem key={entry} value={entry}>
            {LOCALE_LABELS[entry]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
