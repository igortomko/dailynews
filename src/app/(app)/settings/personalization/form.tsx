"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePersonalization } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DEFAULT_COMPLEXITY,
  DEFAULT_STYLE,
  STYLES,
  complexityAt,
  styleOf,
} from "@/lib/voice";
import type { Profile } from "@/lib/types";

export function PersonalizationForm({ profile }: { profile: Profile }) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();
  const first = !profile?.onboarded_at;

  const [complexity, setComplexity] = useState(profile?.complexity ?? DEFAULT_COMPLEXITY);
  const [style, setStyle] = useState(profile?.style ?? DEFAULT_STYLE);

  const save = () => {
    const node = form.current;
    if (!node) return;
    startTransition(async () => {
      await savePersonalization(new FormData(node));
      setSaved(true);
      router.refresh();
    });
  };

  // Сохраняем сами, с паузой после последней правки: кнопка заставляет
  // помнить, что изменения не применены, и наказывает за уход со страницы.
  // Пауза нужна, чтобы не слать запрос на каждую букву в текстовом поле.
  const schedule = () => {
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
  };

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!saved) return;
    const hide = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(hide);
  }, [saved]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {first ? "Настрой ленту" : "Персонализация"}
          <span
            aria-live="polite"
            className="flex items-center gap-1 text-xs font-normal text-muted-foreground"
          >
            {pending ? "сохраняю…" : saved ? (<><CheckIcon className="size-3" />сохранено</>) : null}
          </span>
        </CardTitle>
        {first ? (
          <CardDescription>
            По этим направлениям будут собираться новости, и по ним же раскладываться вкладки.
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <form ref={form} onChange={schedule} onSubmit={(event) => event.preventDefault()}>
          {/* Сколько новостей в день — в «Интересах», рядом с полосой, где
              это число делится между темами: там оно одно решение, а не два.
              Здесь остаётся только то, как текст написан и для кого. */}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="language">Язык</FieldLabel>
              <Input
                id="language"
                name="language"
                defaultValue={profile?.language ?? "русском"}
                placeholder="русском"
                className="max-w-64"
              />
            </Field>

            {/* Ползунок и селект меняются мимо события формы: базовый компонент
                не шлёт change с настоящего поля, поэтому о правке сообщаем сами.
                Скрытое поле держит значение для FormData. */}
            <Field>
              <FieldLabel htmlFor="complexity">Сложность языка</FieldLabel>
              <div className="flex max-w-sm items-center gap-3">
                <Slider
                  id="complexity"
                  min={1}
                  max={5}
                  step={1}
                  // Массивом, а не числом: обёртка рисует по ползунку на элемент,
                  // и на скаляре откатывается к [min, max] — два ползунка вместо
                  // одного, причём поле при этом продолжает сохраняться.
                  value={[complexity]}
                  onValueChange={(value) => {
                    setComplexity(Array.isArray(value) ? value[0] : value);
                    schedule();
                  }}
                  aria-label="Сложность языка"
                />
                <span className="w-36 shrink-0 text-sm">{complexityAt(complexity).label}</span>
              </div>
              <input type="hidden" name="complexity" value={complexity} />
              <FieldDescription>{complexityAt(complexity).hint}</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="style">Манера</FieldLabel>
              <Select
                value={style}
                onValueChange={(value: string | null) => {
                  if (!value) return;
                  setStyle(value);
                  schedule();
                }}
              >
                <SelectTrigger id="style" className="max-w-64">
                  <SelectValue>{styleOf(style).label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STYLES.map((entry) => (
                    <SelectItem key={entry.key} value={entry.key}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="style" value={style} />
              <FieldDescription>{styleOf(style).hint}</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="reader_context">Кто читает</FieldLabel>
              <Textarea
                id="reader_context"
                name="reader_context"
                rows={5}
                defaultValue={profile?.reader_context ?? ""}
                placeholder="Чем занимаешься, какой стек, что за продукт, где живёшь"
              />
              <FieldDescription>
                Расскажите о себе, это влияет на саммари и отбор новостей под ваши интересы.
              </FieldDescription>
            </Field>

            {/* Кнопка остаётся только в онбординге: там она не сохраняет,
                а заканчивает настройку и уводит в ленту. */}
            {first ? (
              <Button
                type="button"
                disabled={pending}
                className="self-start"
                onClick={() => {
                  clearTimeout(timer.current);
                  save();
                  router.push("/");
                }}
              >
                Готово
              </Button>
            ) : null}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
