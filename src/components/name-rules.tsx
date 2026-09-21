"use client";

import { Fragment, useRef, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fold, RULE_LIMITS, splitNames, type Names, type RuleKind } from "@/lib/rules";

/**
 * Слить набранное в список: каждое название — своё правило. Возвращает
 * тот же массив, если добавить было нечего, и причину остановки словами.
 * Одна функция на кнопку «Добавить» и на скрытое поле формы: иначе
 * набранное проходило бы в форму мимо проверок, которые видит кнопка.
 */
function merge(rules: Names[], draft: string, limit: number): { next: Names[]; stopped: string | null } {
  const next = [...rules];
  let added = false;
  let stopped: string | null = null;
  for (const candidate of splitNames(draft)) {
    if (candidate.length > RULE_LIMITS.chars) {
      stopped = `«${candidate.slice(0, 24)}…» длиннее ${RULE_LIMITS.chars} знаков`;
      break;
    }
    if (next.some((known) => known.some((n) => fold(n) === fold(candidate)))) {
      stopped = `«${candidate}» уже есть`;
      continue;
    }
    if (next.length >= limit) {
      stopped = `Не больше ${limit}. Убери одно, чтобы добавить другое`;
      break;
    }
    next.push([candidate]);
    added = true;
  }
  return { next: added ? next : rules, stopped };
}

/**
 * Список названий: за чем следить или что исключать.
 *
 * Один компонент на оба списка и на оба места — первый экран и «Интересы»:
 * правила ввода (запятая и перевод строки делят, повтор не добавляется,
 * предел объясняется словами) обязаны быть одними, а две копии разошлись бы
 * на первой правке любой из них.
 *
 * Пределы здесь те же числа, что проверяет сервер (`RULE_LIMITS`):
 * форма гасит лишнее до отправки, сервер отвергает то, чего форма не видела.
 *
 * Набранное, но не добавленное, не теряется: уход из поля добавляет его
 * само. Иначе «Figma» в поле и нажатое «Сохранить» означали бы список
 * без Figma — отказ, похожий на успех.
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
   * Родителю отдаётся список вместе с набранным, но не добавленным, — то же,
   * что уходит в скрытое поле формы. Иначе «Дальше» на первом экране
   * сохраняло бы список без текста в поле: кнопка не забирает фокус
   * (см. мастер), чтобы чипы не появлялись между mousedown и mouseup
   * и не двигали её из-под указателя.
   */
  const report = (nextRules: Names[], nextDraft: string) =>
    onChange?.(merge(nextRules, nextDraft, limit).next);

  const setRules = (next: Names[], nextDraft = draft) => {
    setRulesState(next);
    report(next, nextDraft);
  };

  /** Добавить всё из поля: каждое название — своё правило. */
  const add = () => {
    if (splitNames(draft).length === 0) return;
    const { next, stopped } = merge(rules, draft, limit);
    // Поле очищается только от принятого: непринятое остаётся на месте,
    // чтобы его можно было поправить, а не набирать заново.
    const left = stopped && next === rules ? draft : "";
    if (next !== rules) setRules(next, left);
    setNote(stopped);
    setDraft(left);
  };

  const remove = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
    setSelected(null);
    setNote(null);
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

  /** Принять написания раскрытого правила. Первое остаётся именем. */
  const commitVariants = () => {
    if (selected === null) return;
    const [shown] = rules[selected];
    const others = splitNames(variants).filter((n) => fold(n) !== fold(shown));
    // Повтор из другого правила — ошибка, а не молчание: одно написание
    // в двух правилах ничего не добавляет, а человек думал бы, что добавил.
    const taken = others.find((n) => rules.some((names, i) => i !== selected && names.some((k) => fold(k) === fold(n))));
    if (taken) {
      setNote(`«${taken}» уже есть в другом правиле`);
      return;
    }
    const long = others.find((n) => n.length > RULE_LIMITS.chars);
    if (long) {
      setNote(`«${long.slice(0, 24)}…» длиннее ${RULE_LIMITS.chars} знаков`);
      return;
    }
    if (others.length + 1 > RULE_LIMITS.names) {
      setNote(`Не больше ${RULE_LIMITS.names} написаний на одно название`);
      return;
    }
    setNote(null);
    const next = [shown, ...others];
    if (next.join("\n") === rules[selected].join("\n")) return;
    setRules(rules.map((names, i) => (i === selected ? next : names)));
  };

  return (
    <Field ref={box}>
      {/* Форма читает список вместе с набранным, но ещё не добавленным:
          «Сохранить» с текстом в поле иначе сохраняло бы список без него.
          Теми же правилами, что и кнопка «Добавить», — повтор и лишнее
          не проходят и здесь. */}
      {name ? <input type="hidden" name={name} value={JSON.stringify(merge(rules, draft, limit).next)} /> : null}
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
                    onChange={(event) => setVariants(event.target.value)}
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
          // Уход из поля добавляет набранное: иначе «Сохранить» с текстом
          // в поле сохраняло бы список без него.
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
