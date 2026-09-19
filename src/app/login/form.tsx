"use client";

import { useActionState, useState } from "react";
import { SendIcon } from "lucide-react";
import { login } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Вход один: ссылка из бота. Она несёт номер читателя, поэтому сессия
 * достаётся тому, кому бот её прислал, а не тому, кто открыл адрес.
 *
 * Пароль остаётся запасным входом владельца и убран с глаз: если Telegram
 * недоступен, дверь не должна захлопываться снаружи.
 */
export function LoginForm({
  next,
  expired,
  bot,
}: { next: string; expired: boolean; bot: string | null }) {
  const [state, action, pending] = useActionState(login, null);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Лента</CardTitle>
        <CardDescription>
          {expired
            ? "Ссылка истекла — попроси у бота новую."
            : "Вход через бота: он же присылает выпуск каждое утро."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {bot ? (
            <Button render={<a href={`https://t.me/${bot}?start=login`} />}>
              <SendIcon data-icon="inline-start" />
              Написать боту /start
            </Button>
          ) : (
            <FieldDescription>
              Напиши боту <code className="font-mono">/start</code> — он пришлёт ссылку
              на ленту. Ссылка действует 10 минут.
            </FieldDescription>
          )}

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
