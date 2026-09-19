"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveKindle } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const DOMAIN = "kindle.tomko.io";

export function DeliveryForm({
  connected,
  username,
  kindleAddress,
  sender,
}: {
  connected: boolean;
  username: string | null;
  kindleAddress: string;
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
            Каждое утро туда приходит ссылка на свежий выпуск. Оттуда же приходит вход:
            читать нужно в вебе, иначе калибровке неоткуда узнать, что было прочитано,
            а что пролистано.
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
          <CardDescription>
            Выпуск уходит книгой на читалку. Адрес вида имя@kindle.com лежит
            в настройках Amazon, в «Manage Your Content and Devices».
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
                  {error ?? "Пустое поле выключает отправку на Kindle."}
                </FieldDescription>
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
