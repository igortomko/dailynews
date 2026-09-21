"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";
import { saveInterests, type ChipInput } from "@/lib/actions";
import { TopicChips } from "@/components/topic-chips";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Plan } from "@/lib/plans";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { flushRebuild } from "@/components/rebuild-queue";

export function InterestsForm({
  chips,
  total,
  inToday,
  plan,
}: {
  chips: ChipInput[];
  total: number;
  inToday: number;
  plan: Plan;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [applying, setApplying] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();

  /** `after` зовётся после записи и только при успехе: пересобирать отвергнутое не за чем. */
  const save = (after?: () => void) => {
    const node = form.current;
    if (!node) return;
    startTransition(async () => {
      // Отказ приходит двумя путями: разобранным `{ error }` и исключением
      // из серверного действия. Оба гасят спиннер здесь — `after` при отказе
      // не зовётся, и снять его больше некому: кнопка крутилась бы всегда,
      // а причина не называлась бы вовсе.
      try {
        const result = await saveInterests(new FormData(node));
        if (result?.error) {
          setError(result.error);
          setApplying(false);
          return;
        }
      } catch {
        setError("Не удалось сохранить. Попробуй ещё раз");
        setApplying(false);
        return;
      }
      setError(null);
      setSaved(true);
      after?.();
    });
  };

  // Сохраняем сами, с паузой после последней правки: иначе запрос уходил бы
  // на каждое движение границы. Пауза короткая, но не нулевая — правку,
  // сделанную и тут же брошенную уходом со страницы, она не спасёт.
  const schedule = () => {
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
  };

  /**
   * «Сохранить»: дописать недописанное и догрузить сегодняшний выпуск,
   * если он стал меньше заказанного. Доли тем сегодняшнему выпуску уже
   * не помогут — он отобран, — и тост об этом честно молчит.
   */
  const apply = () => {
    clearTimeout(timer.current);
    setApplying(true);
    save(() => {
      void flushRebuild(() => router.refresh())
        .catch(() => {})
        .finally(() => setApplying(false));
    });
  };

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!saved) return;
    const hide = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(hide);
  }, [saved]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Интересы
          <span
            aria-live="polite"
            className={cn(
              "flex items-center gap-1 text-xs font-normal",
              saved && !pending ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            {pending ? "сохраняю…" : saved ? (<><CheckIcon className="size-3" />сохранено</>) : null}
          </span>
        </CardTitle>
        <CardDescription>
          О чём собирать новости. Чем больше доля темы, тем больше новостей по ней.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={form} onChange={schedule} onSubmit={(event) => event.preventDefault()}>
          <FieldGroup>
            <TopicChips
              initial={chips}
              initialTotal={total}
              inToday={inToday}
              plan={plan}
              onChange={schedule}
            />
            {error ? <FieldError>{error}</FieldError> : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="lg"
                disabled={applying}
                // Заметно крупнее остальных кнопок экрана: это единственное
                // действие, ради которого сюда пришли, а в ряду одинаковых
                // оно читалось как ещё одна настройка.
                className="h-11 self-start px-6 text-base"
                onClick={apply}
              >
                {applying ? <Spinner data-icon="inline-start" /> : null}
                Сохранить
              </Button>
              <span className="text-xs text-muted-foreground">
                Доли начнут работать со следующего выпуска. Если добавил новостей, догрузим сегодня.
              </span>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
