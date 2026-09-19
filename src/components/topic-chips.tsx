"use client";

import { useState } from "react";
import { XIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import type { ChipInput } from "@/lib/actions";

const SUGGESTIONS = [
  "AI-инфра", "Энергетика и уран", "Блокчейн", "Демография",
  "Психотерапия и mental health", "Дизайн и продукт",
];

export function TopicChips({ initial }: { initial: ChipInput[] }) {
  const [chips, setChips] = useState<ChipInput[]>(initial);
  const [draft, setDraft] = useState("");

  const add = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (chips.some((chip) => chip.label.toLowerCase() === trimmed.toLowerCase())) return;
    setChips([...chips, { slug: "", label: trimmed, hint: "" }]);
    setDraft("");
  };

  const remove = (index: number) => setChips(chips.filter((_, i) => i !== index));

  const setHint = (index: number, hint: string) =>
    setChips(chips.map((chip, i) => (i === index ? { ...chip, hint } : chip)));

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
          Каждый интерес становится вкладкой в ленте и вариантом ответа при оценке новости.
        </FieldDescription>
      </Field>

      {unused.length > 0 ? (
        <Field>
          <FieldLabel>Подсказки</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {unused.map((suggestion) => (
              <Badge
                key={suggestion}
                variant="outline"
                className="cursor-pointer"
                onClick={() => add(suggestion)}
              >
                {suggestion}
              </Badge>
            ))}
          </div>
        </Field>
      ) : null}

      {chips.length > 0 ? (
        <Field>
          <FieldLabel>Уточнения</FieldLabel>
          <FieldDescription>
            Чем точнее описан интерес, тем меньше новостей попадёт в него по ошибке.
            Это описание читает модель, которая раскладывает поток по темам.
          </FieldDescription>
          <div className="flex flex-col gap-2">
            {chips.map((chip, index) => (
              <div key={`${chip.label}-${index}`} className="flex items-center gap-2">
                <Badge variant="secondary" className="shrink-0">
                  {chip.label}
                  <button
                    type="button"
                    aria-label={`Убрать ${chip.label}`}
                    className="ml-1 cursor-pointer opacity-60 hover:opacity-100"
                    onClick={() => remove(index)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
                <Input
                  value={chip.hint}
                  placeholder="что сюда относится"
                  onChange={(event) => setHint(index, event.target.value)}
                />
              </div>
            ))}
          </div>
        </Field>
      ) : null}
    </FieldGroup>
  );
}
