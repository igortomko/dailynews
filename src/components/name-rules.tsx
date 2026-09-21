"use client";

import { Fragment, useRef, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  mergeDraft, RULE_LIMITS, splitNames, withVariants, type Names, type RuleKind,
} from "@/lib/rules";

/**
 * Список названий: за чем следить или что исключать.
 *
 * Один компонент на оба списка и на оба места — первый экран и «Интересы»:
 * правила ввода (запятая и перевод строки делят, повтор не добавляется,
 * предел объясняется словами) обязаны быть одними, а две копии разошлись бы
 * на первой правке любой из них. Сами правила — в `src/lib/rules.ts`,
 * где их проверяет `npm test`.
 *
 * Пределы здесь те же числа, что проверяет сервер (`RULE_LIMITS`):
 * форма гасит лишнее до отправки, сервер отвергает то, чего форма не видела.
 *
 * Набранное, но не добавленное, не теряется: и скрытое поле формы,
 * и `onChange` отдают список вместе с ним — включая написания
 * из раскрытого правила. Иначе «Сохранить» или «Дальше» с текстом в поле
 * означали бы список без него — отказ, похожий на успех. Уход из поля
 * добавляет чип и глазами тоже.
 */
export function NameRules({
  kind,
  initial,
  label,
  hint,
  description,
  placeholder,
  name,
  onChange,
}: {
  kind: RuleKind;
  initial: Names[];
  label: string;
  /** Короткая пометка у подписи: «необязательно» на первом экране. */
  hint?: string;
  description: string;
  placeholder: string;
  /** Имя скрытого поля формы. Пусто — список отдаётся только через onChange. */
  name?: string;
  onChange?: (next: Names[]) => void;
}) {
  const [rules, setRulesState] = useState<Names[]>(initial);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  // Раскрытое правило и черновик его написаний. Черновик отдельно от
  // правила: разбор по запятым на каждое нажатие клавиши съедал бы
  // запятую, которую только что поставили.
  const [selected, setSelected] = useState<number | null>(null);
  const [variants, setVariants] = useState("");
  const draftInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const limit = RULE_LIMITS.rules[kind];
  const full = rules.length >= limit;

  /**
   * Список, каким его увидит форма и родитель: правила, написания
   * из раскрытого правила и набранное в поле — теми же проверками, что
   * у кнопок. Непринятое молча не входит; причину покажет сама кнопка.
   */
  const pending = (
    nextRules: Names[] = rules,
    nextDraft: string = draft,
    nextVariants: string = variants,
    at: number | null = selected,
  ): Names[] => {
    const base = at === null ? nextRules : withVariants(nextRules, at, nextVariants).next;
    return mergeDraft(base, nextDraft, limit).next;
  };

  const report = (...args: Parameters<typeof pending>) => onChange?.(pending(...args));

  const setRules = (next: Names[], nextDraft = draft) => {
    setRulesState(next);
    report(next, nextDraft);
  };

  /** Добавить всё из поля: каждое название — своё правило. */
  const add = () => {
    if (splitNames(draft).length === 0) return;
    const { next, stopped, rejected } = mergeDraft(rules, draft, limit);
    // Поле очищается только от принятого: непринятое остаётся на месте,
    // чтобы его можно было поправить, а не набирать заново.
    const left = rejected.join(", ");
    if (next !== rules) setRules(next, left);
    setNote(stopped);
    setDraft(left);
  };

  const remove = (index: number) => {
    const next = rules.filter((_, i) => i !== index);
    // Редактор написаний закрывается вместе с любым убранным чипом: номер
    // раскрытого правила после сдвига указывал бы на соседа.
    setRulesState(next);
    setSelected(null);
    setNote(null);
    report(next, draft, "", null);
    // Крестик исчезает вместе с чипом, и фокус ушёл бы в body: принимаем
    // его крестик соседа, а когда убрали последний — поле ввода.
    requestAnimationFrame(() => {
      const buttons = box.current?.querySelectorAll<HTMLButtonElement>("[data-rule-remove]") ?? [];
      const landing = buttons[Math.min(index, buttons.length - 1)];
      (landing ?? draftInput.current)?.focus();
    });
  };

  const open = (index: number) => {
    if (selected === index) {
      setSelected(null);
      return;
    }
    setSelected(index);
    setVariants(rules[index].slice(1).join(", "));
  };

  /** Принять написания раскрытого правила глазами. Первое остаётся именем. */
  const commitVariants = () => {
    if (selected === null) return;
    const { next, stopped } = withVariants(rules, selected, variants);
    setNote(stopped);
    if (!stopped && next !== rules) setRules(next);
  };

  return (
    <Field ref={box}>
      {name ? <input type="hidden" name={name} value={JSON.stringify(pending())} /> : null}
      <FieldLabel className="flex items-center gap-2">
        {label}
        {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
        {/* Счётчик появляется вместе с первым названием: «0 из 50» сообщает
            о пределе раньше, чем о нём спросили. */}
        {rules.length > 0 ? (
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {rules.length} из {limit}
          </span>
        ) : null}
      </FieldLabel>
      <FieldDescription>{description}</FieldDescription>

      {rules.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {rules.map((names, index) => (
            <Fragment key={`${names[0]}-${index}`}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={selected === index}
                aria-label={
                  names.length > 1
                    ? `${names[0]}, ещё ${names.length - 1}: ${names.slice(1).join(", ")}`
                    : names[0]
                }
                onClick={() => open(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open(index);
                  }
                }}
                className={cn(
                  "flex h-10 items-center gap-1.5 rounded-lg border bg-card pr-1 pl-3 text-sm transition-colors select-none",
                  "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  selected === index ? "border-foreground/30 bg-muted" : "cursor-pointer hover:bg-muted",
                )}
              >
                <span>{names[0]}</span>
                {/* Сколько ещё написаний: раскрытие покажет какие. */}
                {names.length > 1 ? (
                  <span className="text-xs text-muted-foreground tabular-nums">+{names.length - 1}</span>
                ) : null}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        data-rule-remove
                        aria-label={`Убрать ${names[0]}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          remove(index);
                        }}
                        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      />
                    }
                  >
                    <XIcon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>Убрать</TooltipContent>
                </Tooltip>
              </div>

              {/* Написания раскрываются под своим чипом: w-full в ряду
                  с переносом ставит блок на новую строку. */}
              {selected === index ? (
                <div className="w-full">
                  <Input
                    value={variants}
                    aria-label={`Другие написания для «${names[0]}»`}
                    placeholder="Другие написания через запятую: Фигма, figma.com"
                    onChange={(event) => {
                      setVariants(event.target.value);
                      report(rules, draft, event.target.value);
                      if (note) setNote(null);
                    }}
                    onBlur={commitVariants}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      commitVariants();
                    }}
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Ищется каждое написание, буквально. До {RULE_LIMITS.names} на одно название
                  </p>
                </div>
              ) : null}
            </Fragment>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Input
          ref={draftInput}
          value={draft}
          aria-label={label}
          placeholder={placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
            report(rules, event.target.value);
            if (note) setNote(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
          // Уход из поля добавляет набранное чипом: в форму и к родителю
          // оно уходит и без этого, но глазами видно только так.
          onBlur={add}
        />
        <Button
          type="button"
          variant="outline"
          // Нажатие не уводит фокус из поля: после «Добавить» набирают
          // следующее, а не ищут поле заново.
          onMouseDown={(event) => event.preventDefault()}
          onClick={add}
          disabled={full}
        >
          <PlusIcon data-icon="inline-start" />
          Добавить
        </Button>
      </div>
      {note ? <FieldDescription>{note}</FieldDescription> : null}
      {full && !note ? (
        <FieldDescription>Не больше {limit}. Убери одно, чтобы добавить другое</FieldDescription>
      ) : null}
    </Field>
  );
}
