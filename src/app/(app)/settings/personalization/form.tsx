"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveInterests, type ChipInput } from "@/lib/actions";
import { TopicChips } from "@/components/topic-chips";
import { Button } from "@/components/ui/button";
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
  const [language, setLanguage] = useState(profile?.language ?? "ru");
  const router = useRouter();
  const first = !profile?.onboarded_at;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{first ? "Настрой ленту" : "Персонализация"}</CardTitle>
        <CardDescription>
          {first
            ? "По этим направлениям будут собираться новости, и по ним же раскладываться вкладки."
            : "Сколько материалов, на каком языке, для кого и о чём."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={(formData) =>
            startTransition(async () => {
              const result = await saveInterests(formData);
              if (result?.error) {
                setError(result.error);
                return;
              }
              setError(null);
              toast.success("Сохранено");
              if (first) router.push("/");
              else router.refresh();
            })
          }
        >
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
                onValueChange={(value: string[]) => value[0] && setLanguage(value[0] as typeof language)}
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

            <TopicChips initial={chips} />

            {error ? <FieldDescription className="text-destructive">{error}</FieldDescription> : null}

            <Button type="submit" disabled={pending} className="self-start">
              {first ? "Готово" : "Сохранить"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
