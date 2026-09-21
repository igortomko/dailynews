"use client";

import { useActionState, useState } from "react";
import { SendIcon } from "lucide-react";
import { login } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/components/i18n-provider";

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
  const t = useT();

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Reporta</CardTitle>
        <CardDescription>
          {expired ? t.onboarding.login.linkExpired : t.onboarding.login.tagline}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {bot ? (
            <Button nativeButton={false} render={<a href={`https://t.me/${bot}?start=login`} />}>
              <SendIcon data-icon="inline-start" />
              {t.onboarding.login.viaTelegram}
            </Button>
          ) : (
            <FieldDescription>
              {t.onboarding.login.botHintBefore}
              <code className="font-mono">/start</code>
              {t.onboarding.login.botHintAfter}
            </FieldDescription>
          )}

          {showPassword ? (
            <form action={action}>
              <input type="hidden" name="next" value={next} />
              <FieldGroup>
                <Field data-invalid={state?.error ? true : undefined}>
                  <FieldLabel htmlFor="password">{t.onboarding.login.passwordLabel}</FieldLabel>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoFocus
                    autoComplete="current-password"
                    aria-invalid={state?.error ? true : undefined}
                  />
                  {state?.error ? <FieldError>{state.error}</FieldError> : null}
                </Field>
                <Button type="submit" variant="outline" disabled={pending}>
                  {t.onboarding.login.signIn}
                </Button>
              </FieldGroup>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowPassword(true)}
              className="cursor-pointer self-start text-xs text-muted-foreground hover:text-foreground"
            >
              {t.onboarding.login.signInWithPassword}
            </button>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
