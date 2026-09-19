"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveKindle } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const DOMAIN = "kindle.tomko.io";

// Точка входа «Manage Your Content and Devices». Ссылка ведёт на настоящий
// раздел Amazon, а не на угаданный якорь внутри него: адрес личного
// документа лежит там же, а хеш-маршруты этой страницы меняются.
const AMAZON_SETTINGS = "https://www.amazon.com/hz/mycd/myx";

export function DeliveryForm({
  connected,
  username,
  kindleAddress,
  kindleDigest,
  sender,
}: {
  connected: boolean;
  username: string | null;
  kindleAddress: string;
  kindleDigest: boolean;
  sender: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>
            Каждое утро в твой Telegram приходит ссылка на свежий выпуск твоих
            персональных новостей.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {connected
            ? `Подключён${username ? ` как @${username}` : ""}.`
            : "Не подключён — напиши боту /start, и он свяжет этот аккаунт."}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kindle</CardTitle>
          <CardDescription className="flex flex-col gap-2">
            <span>Ты можешь автоматически получать выпуск на свой Kindle.</span>
            <span>
              Добавь свой персональный адрес имя@kindle.com. Он лежит в настройках
              Amazon, в{" "}
              <a
                href={AMAZON_SETTINGS}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                «Manage Your Content and Devices»
              </a>
              .
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {sender ? (
            <Alert>
              <AlertTitle>Сначала разреши отправителя</AlertTitle>
              <AlertDescription>
                Добавь <code className="font-mono">{sender}@{DOMAIN}</code> в список
                одобренных адресов Amazon — без этого письмо молча отбрасывается.
                Адрес свой у каждого читателя и не меняется: Amazon считает объём
                по отправителю, и общий адрес отвалился бы разом у всех.
              </AlertDescription>
            </Alert>
          ) : null}

          <form
            action={(formData) =>
              startTransition(async () => {
                const result = await saveKindle(formData);
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
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="kindle_address">Адрес читалки</FieldLabel>
                <Input
                  id="kindle_address"
                  name="kindle_address"
                  defaultValue={kindleAddress}
                  placeholder="имя@kindle.com"
                  aria-invalid={error ? true : undefined}
                />
                <FieldDescription>
                  {error ?? "Пустой адрес выключает отправку на читалку целиком."}
                </FieldDescription>
              </Field>

              <Field orientation="horizontal">
                <Switch
                  id="kindle_digest"
                  name="kindle_digest"
                  defaultChecked={kindleDigest}
                />
                <FieldLabel htmlFor="kindle_digest" className="font-normal">
                  Присылать выпуск на читалку
                  <FieldDescription>
                    Выключено — адрес остаётся для отправки отдельных статей.
                  </FieldDescription>
                </FieldLabel>
              </Field>
              <Button type="submit" disabled={pending} className="self-start">
                Сохранить
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
