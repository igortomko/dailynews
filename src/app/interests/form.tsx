"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveInterests, type ChipInput } from "@/lib/actions";
import { TopicChips } from "@/components/topic-chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Profile } from "@/lib/types";

export function InterestsForm({ profile, chips }: { profile: Profile; chips: ChipInput[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const first = !profile?.onboarded_at;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{first ? "Настрой ленту" : "Интересы"}</CardTitle>
        <CardDescription>
          {first
            ? "По этим направлениям будут собираться новости, и по ним же раскладываться вкладки."
            : "Убранный интерес не удаляется, а гаснет: на нём держатся оценки уже собранного."}
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
          <FieldGroup>
            <TopicChips initial={chips} />

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
                Этот текст видит и модель, раскладывающая поток по темам, и та,
                что пишет дайджест. Он сильнее влияет на отбор, чем список интересов.
              </FieldDescription>
            </Field>

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
