"use client";

import { useActionState, useState } from "react";
import { MailIcon, SendIcon } from "lucide-react";
import { login, requestEmailLink } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/components/i18n-provider";

/**
 * Три входа: ссылка из бота, Google и ссылка на почту. Каждый несёт
 * подтверждённую личность — чат Telegram или ящик, — поэтому сессия
 * достаётся тому, кому пришла ссылка, а не тому, кто открыл адрес.
 * Пришедшие по почте получают выпуск письмом, а не в бота.
 *
 * Пароль остаётся запасным входом владельца и убран с глаз: если Telegram
 * недоступен, дверь не должна захлопываться снаружи.
 */
export function LoginForm({
  next,
  expired,
  bot,
  google,
}: { next: string; expired: boolean; bot: string | null; google: boolean }) {
  const [state, action, pending] = useActionState(login, null);
  const [mail, mailAction, mailPending] = useActionState(requestEmailLink, null);
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
            <Button size="lg" nativeButton={false} render={<a href={`https://t.me/${bot}?start=login`} />}>
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

          {google ? (
            <Button size="lg" variant="outline" nativeButton={false} render={<a href="/auth/google" />}>
              <GoogleMark />
              {t.onboarding.login.viaGoogle}
            </Button>
          ) : null}

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t.onboarding.login.or}
            <span className="h-px flex-1 bg-border" />
          </div>

          {mail?.sent ? (
            <FieldDescription role="status">{t.onboarding.login.linkSent(mail.sent)}</FieldDescription>
          ) : (
            <form action={mailAction}>
              <FieldGroup>
                <Field data-invalid={mail?.error ? true : undefined}>
                  <FieldLabel htmlFor="email">{t.onboarding.login.emailLabel}</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder={t.onboarding.login.emailPlaceholder}
                    aria-invalid={mail?.error ? true : undefined}
                  />
                  {mail?.error ? <FieldError>{mail.error}</FieldError> : null}
                </Field>
                <Button type="submit" variant="outline" disabled={mailPending}>
                  <MailIcon data-icon="inline-start" />
                  {t.onboarding.login.sendLink}
                </Button>
              </FieldGroup>
            </form>
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

/** Знак Google — его цвета требует их гайд по кнопке входа. */
function GoogleMark() {
  return (
    <svg data-icon="inline-start" viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}
