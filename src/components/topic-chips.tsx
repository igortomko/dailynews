"use client";

import { useState } from "react";
import { XIcon, PlusIcon, GripVerticalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { ChipInput } from "@/lib/actions";

const SUGGESTIONS = [
  "AI-инфра", "Энергетика и уран", "Блокчейн", "Демография",
  "Психотерапия и mental health", "Дизайн и продукт",
];

export function TopicChips({
  initial,
  onChange,
}: {
  initial: ChipInput[];
  onChange?: () => void;
}) {
  const [chips, setChipsState] = useState<ChipInput[]>(initial);

  // Скрытое поле меняется без события формы, поэтому о правке чипов
  // сообщаем сами: иначе автосохранение их не заметит.
  const setChips = (next: ChipInput[]) => {
    setChipsState(next);
    onChange?.();
  };
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const add = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (chips.some((chip) => chip.label.toLowerCase() === trimmed.toLowerCase())) return;
    setChips([...chips, { slug: "", label: trimmed, hint: "" }]);
    setDraft("");
  };

  const remove = (index: number) => {
    setChips(chips.filter((_, i) => i !== index));
    setSelected(null);
  };

  const setHint = (index: number, hint: string) =>
    setChips(chips.map((chip, i) => (i === index ? { ...chip, hint } : chip)));

  /** Порядок интересов — это порядок вкладок в ленте. */
  const reorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= chips.length) return;
    const next = [...chips];
    next.splice(to, 0, ...next.splice(from, 1));
    setChips(next);
    if (selected === from) setSelected(to);
    return to;
  };

  const unused = SUGGESTIONS.filter(
    (suggestion) => !chips.some((chip) => chip.label.toLowerCase() === suggestion.toLowerCase()),
  );

  return (
    <FieldGroup>
      <input type="hidden" name="chips" value={JSON.stringify(chips)} />

      <Field>
        <FieldLabel htmlFor="chip-draft">Интересы</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="chip-draft"
            value={draft}
            placeholder="Например: энергетика и уран"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add(draft);
              }
            }}
          />
          <Button type="button" variant="outline" onClick={() => add(draft)}>
            <PlusIcon data-icon="inline-start" />
            Добавить
          </Button>
        </div>
        <FieldDescription>
          Порядок здесь — порядок вкладок в ленте. Тащи за левый край, чтобы переставить.
        </FieldDescription>
      </Field>

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip, index) => (
            <div
              key={`${chip.label}-${index}`}
              draggable
              onDragStart={() => setDragging(index)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => {
                event.preventDefault();
                if (dragging === null || dragging === index) return;
                // Переставляем на лету: чип уезжает под курсор сразу,
                // и не приходится угадывать, куда он приземлится.
                const moved = reorder(dragging, index);
                if (moved !== undefined) setDragging(moved);
              }}
              onClick={() => setSelected(selected === index ? null : index)}
              // Стрелками — для клавиатуры: перетаскивание ею недоступно.
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") { event.preventDefault(); reorder(index, index - 1); }
                if (event.key === "ArrowRight") { event.preventDefault(); reorder(index, index + 1); }
              }}
              tabIndex={0}
              role="button"
              aria-label={`${chip.label}. Стрелками влево и вправо — переставить`}
              className={cn(
                "group flex h-10 cursor-grab items-center gap-1 rounded-lg border bg-card pr-1 pl-1 text-sm transition-colors select-none",
                "hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing",
                dragging === index && "opacity-40",
                selected === index && "border-foreground/30 bg-muted",
              )}
            >
              <GripVerticalIcon className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              <span className="px-0.5">{chip.label}</span>
              <button
                type="button"
                aria-label={`Убрать ${chip.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  remove(index);
                }}
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 hover:bg-background hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {unused.length > 0 ? (
        <Field>
          <FieldLabel>Подсказки</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {unused.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => add(suggestion)}
                className="flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed px-3 text-sm text-muted-foreground transition-colors hover:border-solid hover:text-foreground"
              >
                <PlusIcon className="size-3.5" />
                {suggestion}
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      {/* Уточнение живёт под облаком, а не в каждом чипе: шесть полей ввода
          в ряд превращали страницу в форму, где не видно самого списка тем. */}
      {selected !== null && chips[selected] ? (
        <Field>
          <FieldLabel htmlFor="chip-hint">Что относится к теме «{chips[selected].label}»</FieldLabel>
          <Textarea
            id="chip-hint"
            rows={2}
            value={chips[selected].hint}
            placeholder="через запятую: что сюда попадает"
            onChange={(event) => setHint(selected, event.target.value)}
          />
          <FieldDescription>
            Это читает модель, раскладывающая поток по темам: чем точнее, тем меньше попадёт по ошибке.
          </FieldDescription>
        </Field>
      ) : (
        <FieldDescription>Нажми на тему, чтобы уточнить, что к ней относится.</FieldDescription>
      )}
    </FieldGroup>
  );
}
