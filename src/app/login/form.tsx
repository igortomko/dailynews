"use client";

import { useActionState, useState, useTransition } from "react";
import { SendIcon } from "lucide-react";
import { login, sendLoginLink } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function LoginForm({ next, expired }: { next: string; expired: boolean }) {
  const [state, action, pending] = useActionState(login, null);
  const [sending, startSending] = useTransition();
  const [sent, setSent] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  // Пароль остаётся, но убран с глаз: если Telegram недоступен, дверь
  // не должна захлопываться снаружи.
  const [showPassword, setShowPassword] = useState(false);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Лента</CardTitle>
        <CardDescription>
          {expired
            ? "Ссылка истекла — запроси новую."
            : "Ссылка придёт туда же, куда дайджест."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Button
            type="button"
            disabled={sending || sent}
            onClick={() =>
              startSending(async () => {
                const result = await sendLoginLink();
                if (result?.error) {
                  setLinkError(result.error);
                  return;
                }
                setLinkError(null);
                setSent(true);
              })
            }
          >
            <SendIcon data-icon="inline-start" />
            {sent ? "Отправлено — проверь Telegram" : "Прислать ссылку в Telegram"}
          </Button>
          {linkError ? (
            <FieldDescription className="text-destructive">{linkError}</FieldDescription>
          ) : null}

          {showPassword ? (
            <form action={action}>
              <input type="hidden" name="next" value={next} />
              <FieldGroup>
                <Field data-invalid={state?.error ? true : undefined}>
                  <FieldLabel htmlFor="password">Пароль</FieldLabel>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoFocus
                    autoComplete="current-password"
                    aria-invalid={state?.error ? true : undefined}
                  />
                  {state?.error ? <FieldDescription>{state.error}</FieldDescription> : null}
                </Field>
                <Button type="submit" variant="outline" disabled={pending}>
                  Войти
                </Button>
              </FieldGroup>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowPassword(true)}
              className="cursor-pointer self-start text-xs text-muted-foreground hover:text-foreground"
            >
              Войти паролем
            </button>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
