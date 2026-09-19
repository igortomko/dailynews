"use client";

import { useActionState } from "react";
import { login } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Лента</CardTitle>
      </CardHeader>
      <CardContent>
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
            <Button type="submit" disabled={pending}>
              Войти
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
