"use client";

import { useState } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function SubscriptionForm() {
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

    </div>
  );
}
