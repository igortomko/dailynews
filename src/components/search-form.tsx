import { Input } from "@/components/ui/input";

/**
 * Форма поиска: одна на оба места, где она есть, — шапку ленты и страницу
 * результатов. Договор здесь один и тот же (адрес `/search` и имя параметра
 * `q`), а разъехаться двум копиям достаточно одной правки: поиск, начатый
 * из ленты, перестал бы доезжать до страницы, которая его показывает.
 *
 * GET, а не действие: адрес с запросом — это и есть состояние страницы,
 * его можно сохранить, переслать себе же и вернуться к нему кнопкой
 * «назад».
 *
 * Без «use client» намеренно: страница результатов серверная и обработчиков
 * не передаёт, а шапка ленты клиентская и передаёт. Директива здесь сделала
 * бы клиентской и первую.
 */
export function SearchForm({
  defaultValue,
  placeholder,
  label,
  submitLabel,
  autoFocus,
  inputRef,
  onKeyDown,
  className,
  children,
}: {
  defaultValue?: string;
  placeholder: string;
  /** aria-label поля: без «use client» здесь нет хука словаря, и подпись
   *  приходит из словаря того, кто рисует форму — страницы или шапки. */
  label: string;
  /** Текст невидимой кнопки отправки, той же природы, что и `label`. */
  submitLabel: string;
  /** Фокус при появлении. Годится там, где поле и появляется вместе
   *  со страницей; в шапке ленты оно есть всегда, и фокус ставится
   *  по `inputRef`, когда его раскрыли. */
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  className?: string;
  /** Что стоит в строке после поля: например, кнопка «закрыть». */
  children?: React.ReactNode;
}) {
  return (
    <form action="/search" className={className}>
      <Input
        type="search"
        name="q"
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        ref={inputRef}
        enterKeyHint="search"
        placeholder={placeholder}
        aria-label={label}
        onKeyDown={onKeyDown}
        className="h-10 sm:h-8"
      />
      {/* Кнопка отправки есть, хотя её и не видно: форма с одним полем
          уходит по Enter и без неё, но это поведение самого браузера,
          и проверить его нечем. Явная кнопка отправляет форму везде
          одинаково и даёт клавиатуре и читалке экрана то, что нажимают. */}
      <button type="submit" className="sr-only">
        {submitLabel}
      </button>
      {children}
    </form>
  );
}
