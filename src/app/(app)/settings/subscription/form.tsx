"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveLlm, clearLlmKey } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SubscriptionForm({
  baseUrl, model, hasKey,
}: { baseUrl: string; model: string; hasKey: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Свои ключи</CardTitle>
          <CardDescription>
            Дайджест пишет модель по твоему ключу. Подойдёт любой провайдер с
            OpenAI-совместимым адресом: DeepSeek, Gemini, together и прочие.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={(formData) =>
              startTransition(async () => {
                const result = await saveLlm(formData);
                if (result && "error" in result) {
                  setError(result.error);
                  return;
                }
                setError(null);
                toast.success("Сохранено");
              })
            }
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="base_url">Адрес</FieldLabel>
                <Input id="base_url" name="base_url" defaultValue={baseUrl} placeholder="https://api.deepseek.com" />
              </Field>
              <Field>
                <FieldLabel htmlFor="model">Модель</FieldLabel>
                <Input id="model" name="model" defaultValue={model} placeholder="deepseek-flash" />
              </Field>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="api_key">Ключ</FieldLabel>
                <Input
                  id="api_key"
                  name="api_key"
                  type="password"
                  autoComplete="off"
                  placeholder={hasKey ? "сохранён — оставь пустым, чтобы не менять" : "sk-…"}
                  aria-invalid={error ? true : undefined}
                />
                <FieldDescription>
                  {error ??
                    "Ключ лежит в базе открытым текстом, в твоей строке: соседям он не виден, но и от администратора базы не закрыт. Не устраивает — оставь поле пустым, тогда дайджест пишется общим ключом из окружения: он старше по приоритету."}
                </FieldDescription>
              </Field>
              <div className="flex gap-2">
                <Button type="submit" disabled={pending}>Сохранить</Button>
                {hasKey ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                  startTransition(async () => {
                    // Отказ тарифа нельзя запивать успехом: «Ключ убран»
                    // при оставшемся ключе — это отказ, похожий на успех.
                    const result = await clearLlmKey();
                    if (result && "error" in result) {
                      toast.error(result.error);
                      return;
                    }
                    toast.success("Ключ убран");
                  })
                }
                  >
                    Убрать ключ
                  </Button>
                ) : null}
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
