"use client";

import { useEffect, useRef } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { SearchForm } from "@/components/search-form";
import { useT } from "@/components/i18n-provider";

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
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            variant="ghost"
            size="icon-sm"
            aria-label={t.feed.search.label}
            onClick={onOpen}
            className="size-10 text-muted-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground sm:size-8 [&_svg]:size-5 sm:[&_svg]:size-4"
          />
        }
      >
        <SearchIcon />
      </TooltipTrigger>
      <TooltipContent>
        {t.feed.search.openHint}
        <Kbd>/</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Поле на всю строку шапки. Сама форма общая со страницей результатов:
 * адрес и имя параметра у них обязаны совпадать, а две копии договора
 * расходятся с первой правкой любой из них.
 *
 * Раскрыто оно или нет — знает шапка, а поле только следит за фокусом:
 * оно не появляется и не исчезает, а проявляется и гаснет, и убрать его
 * из разметки на время ухода нельзя.
 */
export function SearchField({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const field = useRef<HTMLInputElement>(null);

  // Фокус ставится на раскрытие, а не на появление в разметке: поле теперь
  // висит в шапке всегда, и `autoFocus` увёл бы курсор в него при каждой
  // загрузке ленты — включая ту, где ничего не искали.
  //
  // Закрытое поле очищается по той же причине: раньше оно исчезало вместе
  // с набранным, а теперь осталось бы с ним. «Закрыть» значит «убрать
  // поиск», и раскрытое заново оно предлагало бы дописать брошенный
  // запрос, пряча за ним подсказку, — а вернуться к прошлому поиску есть
  // чем, недавние стоят строкой ниже.
  useEffect(() => {
    if (open) {
      // Слой раскрывается кроссфейдом, и `visibility` едет в переходе
      // вместе с прозрачностью (см. `layerClass` в `feed-tabs.tsx`):
      // фокус на ещё `visibility: hidden` элементе браузер тихо
      // игнорирует, без ошибки. Замер показал, что видимость
      // разрешается не в первом кадре и не мгновенно, а около середины
      // 150-миллисекундного перехода — число зависит от браузера
      // и нагрузки, и держать его константой значит однажды снова
      // словить молчаливый промах. Поэтому не ждём кадр и не гадаем
      // задержку, а пробуем каждый кадр, пока фокус не встанет —
      // как только видимость разрешится, первая же попытка сработает.
      // Ограничение — не про случай из замера (там хватает и одного кадра
      // с запасом), а про случай, где фокус не встанет никогда: поле
      // убрали из разметки, вкладка так и не получила фокус ОС. Без
      // потолка это крутилось бы кадр за кадром, пока открыт поиск.
      const deadline = performance.now() + 1000;
      let frame = 0;
      const tryFocus = () => {
        const input = field.current;
        if (!input || document.activeElement === input) return;
        input.focus();
        if (document.activeElement !== input && performance.now() < deadline) {
          frame = requestAnimationFrame(tryFocus);
        }
      };
      frame = requestAnimationFrame(tryFocus);
      return () => cancelAnimationFrame(frame);
    }
    if (field.current) field.current.value = "";
  }, [open]);

  return (
    <>
      <SearchForm
        inputRef={field}
        placeholder={t.feed.search.fieldPlaceholder}
        label={t.feed.search.label}
        submitLabel={t.feed.search.submit}
        className="flex-1"
        // Escape возвращает ленту на место. Без него поле закрывается только
        // мышью, а открывают его с клавиатуры.
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      />
      {/* Крестик справа: он закрывает поиск, а не уводит назад. Слева
          на странице результатов стоит стрелка — это переход, и путать
          их местами значит обещать переход там, где его нет. */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t.feed.search.close}
        onClick={onClose}
        className="size-10 shrink-0 text-muted-foreground/50 transition-colors hover:text-foreground sm:size-8 [&_svg]:size-5 sm:[&_svg]:size-4"
      >
        <XIcon />
      </Button>
    </>
  );
}
