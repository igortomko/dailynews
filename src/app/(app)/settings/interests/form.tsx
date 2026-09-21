"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveInterests, type ChipInput } from "@/lib/actions";
import { TopicChips } from "@/components/topic-chips";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Plan } from "@/lib/plans";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { flushRebuild } from "@/components/rebuild-queue";
import { useSettingsSave } from "@/components/settings-save";

export function InterestsForm({
  chips,
  minutes,
  perCard,
  inToday,
  plan,
}: {
  chips: ChipInput[];
  /** Заказ: сколько минут чтения просит читатель. */
  minutes: number;
  /** Сколько минут занимает одна его карточка — мерка для деления на места. */
  perCard: number;
  /** Сколько минут в последнем выпуске. */
  inToday: number;
  plan: Plan;
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();

  /**
   * Запись. Промисом, а не колбэком: её ждут двое — кнопка и окно
   * «сохранить перед уходом», и второму нужен исход, чтобы решить,
   * уходить ли.
   */
  const write = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        const node = form.current;
        if (!node) return resolve(false);
        startTransition(async () => {
          // Отказ приходит двумя путями: разобранным `{ error }` и исключением
          // из серверного действия. Молчать нельзя ни о том, ни о другом.
          try {
            const result = await saveInterests(new FormData(node));
            if (result?.error) {
              setError(result.error);
              return resolve(false);
            }
          } catch {
            setError("Не удалось сохранить. Попробуй ещё раз");
            return resolve(false);
          }
          setError(null);
          resolve(true);
        });
      }),
    [],
  );

  /**
   * Догрузить сегодняшний выпуск, если он стал короче заказанного. Доли тем
   * ему уже не помогут — он отобран, — и тост об этом честно молчит.
   */
  const rebuild = useCallback(() => flushRebuild(() => router.refresh()), [router]);

  const { dirty, applying, touch, apply } = useSettingsSave(write, rebuild);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Интересы</CardTitle>
        <CardDescription>
          О чём собирать новости. Двигай границы: чем больше доля темы, тем больше новостей по ней.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={form} onChange={touch} onSubmit={(event) => event.preventDefault()}>
          <FieldGroup>
            <TopicChips
              initial={chips}
              initialMinutes={minutes}
              perCard={perCard}
              inToday={inToday}
              plan={plan}
              onChange={touch}
            />
            {error ? <FieldError>{error}</FieldError> : null}

            <Button
              type="button"
              disabled={applying || !dirty}
              // Заметно крупнее остальных кнопок экрана: это единственное
              // действие, ради которого сюда пришли, а в ряду одинаковых
              // оно читалось как ещё одна настройка.
              className="h-11 self-start px-6 text-base"
              onClick={apply}
            >
              {applying ? <Spinner data-icon="inline-start" /> : null}
              Сохранить
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
