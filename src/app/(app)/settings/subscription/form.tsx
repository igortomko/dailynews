"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";
import { saveLlm, clearLlmKey } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function SubscriptionForm({
  baseUrl, model, hasKey,
}: { baseUrl: string; model: string; hasKey: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [wants, setWants] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Подписка</CardTitle>
          <CardDescription>
            Сбор, оценка и дайджест каждый день — без своих ключей и без своего сервера.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
            {[
              "Источники и оценка потока на нашей стороне",
              "Дайджест в Telegram каждое утро",
              "Калибровка отбора по тому, что читаешь",
            ].map((line) => (
              <li key={line} className="flex gap-2">
                <CheckIcon className="mt-0.5 size-4 shrink-0" />
                {line}
              </li>
            ))}
          </ul>

          {wants ? (
            <Alert>
              <AlertTitle>Записал</AlertTitle>
              <AlertDescription>
                Подписки пока нет — я проверяю, нужна ли она вообще. Напишу, когда появится.
              </AlertDescription>
            </Alert>
          ) : (
            <Button className="self-start" onClick={() => setWants(true)}>
              Подписаться — 400 ₽ в месяц
            </Button>
          )}
        </CardContent>
      </Card>

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
                if (result?.error) {
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
                    "Ключ лежит в базе открытым текстом. База закрыта снаружи и читатель у неё один, но если это не устраивает — оставь поле пустым и задай ключ переменной окружения: она старше по приоритету."}
                </FieldDescription>
              </Field>
              <div className="flex gap-2">
                <Button type="submit" disabled={pending}>Сохранить</Button>
                {hasKey ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => startTransition(async () => { await clearLlmKey(); toast.success("Ключ убран"); })}
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
