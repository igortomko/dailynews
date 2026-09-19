"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveInterests, type ChipInput } from "@/lib/actions";
import { TopicChips } from "@/components/topic-chips";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Profile } from "@/lib/types";

const LANGUAGES = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
  { value: "pt", label: "Português" },
];

export function PersonalizationForm({ profile, chips }: { profile: Profile; chips: ChipInput[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [language, setLanguage] = useState(profile?.language ?? "ru");
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();
  const first = !profile?.onboarded_at;

  const save = () => {
    const node = form.current;
    if (!node) return;
    startTransition(async () => {
      const result = await saveInterests(new FormData(node));
      if (result?.error) {
        setError(result.error);
        return;
      }
      setError(null);
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
        <CardDescription>
          {first
            ? "По этим направлениям будут собираться новости, и по ним же раскладываться вкладки."
            : "Сколько материалов, на каком языке, для кого и о чём."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={form} onChange={schedule} onSubmit={(event) => event.preventDefault()}>
          {/* Порядок от общего к частному: сколько и на каком языке — решения
              на один раз; кто читает влияет на отбор сильнее списка тем,
              поэтому стоит перед ним; интересы меняются чаще всего и потому
              в конце, ближе к кнопке. */}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="digest_size">Материалов в дайджесте</FieldLabel>
              <Input
                id="digest_size"
                name="digest_size"
                type="number"
                min={3}
                max={50}
                defaultValue={profile?.digest_size ?? 12}
                className="w-24"
              />
            </Field>

            <Field>
              <FieldLabel>Язык</FieldLabel>
              <ToggleGroup
                value={[language]}
                onValueChange={(value: string[]) => {
                  if (!value[0]) return;
                  setLanguage(value[0] as typeof language);
                  schedule();
                }}
                variant="outline"
              >
                {LANGUAGES.map((entry) => (
                  <ToggleGroupItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <input type="hidden" name="language" value={language} />
              <FieldDescription>
                На нём пишутся заголовки и описания. Источники остаются на своих языках.
              </FieldDescription>
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
                Этот текст видит и модель, раскладывающая поток по темам, и та, что пишет
                дайджест. Он влияет на отбор сильнее, чем список интересов.
              </FieldDescription>
            </Field>

            <TopicChips initial={chips} onChange={schedule} />

            {error ? <FieldDescription className="text-destructive">{error}</FieldDescription> : null}

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
