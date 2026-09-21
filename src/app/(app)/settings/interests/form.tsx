"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveInterests, type ChipInput } from "@/lib/actions";
import { TopicChips } from "@/components/topic-chips";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Plan } from "@/lib/plans";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { flushRebuild } from "@/components/rebuild-queue";
import { markSaved, markUnsaved } from "@/components/unsaved-guard";

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
  const [applying, setApplying] = useState(false);
  // Тронул ли читатель хоть что-то с прошлого сохранения. Кнопка над
  // нетронутой формой обещала бы работу, которой нет, а сторож ухода
  // спрашивал бы о правке, которой не было.
  const [dirty, setDirty] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();

  /**
   * Запись. Промисом, а не колбэком: её ждут двое — кнопка и окно
   * «сохранить перед уходом», и второму нужен исход, чтобы решить,
   * уходить ли.
   */
  const save = useCallback(
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
          setDirty(false);
          resolve(true);
        });
      }),
    [],
  );

  /** Правка, о которой знают кнопка и сторож ухода. Сама ничего не пишет. */
  const touch = () => setDirty(true);

  /**
   * «Сохранить»: записать и догрузить сегодняшний выпуск, если он стал
   * короче заказанного. Доли тем сегодняшнему выпуску уже не помогут —
   * он отобран, — и тост об этом честно молчит.
   */
  const apply = async () => {
    setApplying(true);
    const ok = await save();
    if (ok) await flushRebuild(() => router.refresh()).catch(() => {});
    setApplying(false);
  };

  // Сторожу нужна и сама запись: из окна «сохранить перед уходом» уходят
  // сразу после неё, не дожидаясь пересборки — она идёт минуту-две и сама
  // расскажет о себе тостом уже на следующей странице.
  useEffect(() => {
    if (!dirty) {
      markSaved();
      return;
    }
    markUnsaved(async () => {
      const ok = await save();
      if (ok) void flushRebuild(() => router.refresh()).catch(() => {});
      return ok;
    });
  }, [dirty, save, router]);

  // Ушли со страницы — сторожить нечего, даже если правка осталась: окно
  // уже спросило, а без этого оно всплыло бы на соседнем разделе.
  useEffect(() => markSaved, []);

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
