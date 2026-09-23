"use client";

import { useActionState, useState } from "react";
import { MailIcon, SendIcon } from "lucide-react";
import { requestEmailLink } from "@/lib/actions";
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
 * Пароля нет: запасной вход владельца — та же почта. Telegram недоступен —
 * входят ссылкой из письма, если адрес добавлен в «Доставке».
 */
export function LoginForm({
  expired,
  bot,
  google,
}: { expired: boolean; bot: string | null; google: boolean }) {
  const [mail, mailAction, mailPending] = useActionState(requestEmailLink, null);
  const [emailOpen, setEmailOpen] = useState(false);
  const t = useT();

  return (
    <Card className="w-full">
      <CardHeader className="items-center text-center">
        {/* Логотип вместо слова: это первое, что видит пришедший, и знак здесь
            говорит больше названия. 192 px — выше минимума в 160 из GUIDELINES. */}
        <CardTitle>
          <h1 className="mx-auto w-48">
            {/* eslint-disable @next/next/no-img-element */}
            <img src="/brand/logo-reporta.svg" alt="Reporta" width="760" height="216" className="block h-auto w-full dark:hidden" />
            <img src="/brand/logo-reporta-dark.svg" alt="Reporta" width="760" height="216" className="hidden h-auto w-full dark:block" />
            {/* eslint-enable @next/next/no-img-element */}
          </h1>
        </CardTitle>
        <CardDescription>
          {expired ? t.onboarding.login.linkExpired : t.onboarding.login.tagline}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Кнопки входа — один выбор из трёх, а не три поля формы: зазор
            кнопочный, а не межполевой (gap-7 у FieldGroup). */}
        <FieldGroup className="gap-3">
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

          {/* Почта свёрнута в кнопку: полем на первом экране она спорила бы
              с Telegram за внимание, а выбирают её реже. */}
          {mail?.sent ? (
            <FieldDescription role="status">{t.onboarding.login.linkSent(mail.sent)}</FieldDescription>
          ) : emailOpen ? (
            <form action={mailAction}>
              <FieldGroup className="gap-3">
                <Field data-invalid={mail?.error ? true : undefined}>
                  <FieldLabel htmlFor="email" className="sr-only">{t.onboarding.login.emailLabel}</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    placeholder={t.onboarding.login.emailPlaceholder}
                    aria-invalid={mail?.error ? true : undefined}
                  />
                  {mail?.error ? <FieldError>{mail.error}</FieldError> : null}
                </Field>
                <Button type="submit" size="lg" disabled={mailPending}>
                  {t.onboarding.login.sendLink}
                </Button>
              </FieldGroup>
            </form>
          ) : (
            <Button type="button" size="lg" variant="outline" onClick={() => setEmailOpen(true)}>
              <MailIcon data-icon="inline-start" />
              {t.onboarding.login.viaEmail}
            </Button>
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
