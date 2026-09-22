"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveInterests } from "@/lib/actions";
import { TopicChips, type FormChip } from "@/components/topic-chips";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Plan } from "@/lib/plans";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { flushRebuild } from "@/components/rebuild-queue";
import { useSettingsSave } from "@/components/settings-save";
import { useT } from "@/components/i18n-provider";
import { NameRules } from "@/components/name-rules";
import type { Names } from "@/lib/rules";

export function InterestsForm({
  chips,
  minutes,
  perCard,
  inToday,
  plan,
  follow,
  exclude,
}: {
  chips: FormChip[];
  /** Заказ: сколько минут чтения просит читатель. */
  minutes: number;
  /** Сколько минут занимает одна его карточка — мерка для деления на места. */
  perCard: number;
  /** Сколько минут в последнем выпуске. */
  inToday: number;
  plan: Plan;
  /** Личные правила отбора: в той же форме, потому что это то же решение. */
  follow: Names[];
  exclude: Names[];
}) {
  const t = useT();
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
            setError(t.settings.common.saveError);
            return resolve(false);
          }
          setError(null);
          resolve(true);
        });
      }),
    [t],
  );

  /**
   * Догрузить сегодняшний выпуск, если он стал короче заказанного. Доли тем
   * ему уже не помогут — он отобран, — и тост об этом честно молчит.
   */
  const rebuild = useCallback(() => flushRebuild(() => router.refresh(), t.feed.rebuild), [router, t]);

  const { dirty, applying, touch, apply } = useSettingsSave(write, rebuild);

  /**
   * Закрыть поле списка до снимка правок, а не внутри записи. Уход из поля
   * добавляет чип и зовёт `touch`; сделанный внутри `write`, он попадал бы
   * после снимка `apply`, и форма после удачной записи оставалась бы
   * «несохранённой» на вид. Кнопка не забирает фокус на mousedown (ниже):
   * иначе чип появлялся бы между mousedown и mouseup, кнопка уезжала
   * бы вниз, и первый клик пропадал.
   */
  const save = () => {
    const node = form.current;
    const active = document.activeElement;
    if (node && active instanceof HTMLElement && node.contains(active)) active.blur();
    void apply();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.nav.interests}</CardTitle>
        <CardDescription>{t.settings.interests.description}</CardDescription>
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
            {/* После тем и их долей: сначала о чём, потом что именно.
                Пересборку выпуска ни то ни другое не заводит — исключение
                прячет карточки из готового само, слежение решается
                при следующем отборе. */}
            <NameRules kind="follow" name="follow" initial={follow} onChange={touch} />
            <NameRules kind="exclude" name="exclude" initial={exclude} onChange={touch} />
            {error ? <FieldError>{error}</FieldError> : null}

            <Button
              type="button"
              disabled={applying || !dirty}
              // Заметно крупнее остальных кнопок экрана: это единственное
              // действие, ради которого сюда пришли, а в ряду одинаковых
              // оно читалось как ещё одна настройка.
              className="h-11 self-start px-6 text-base"
              // Фокус остаётся в поле до самого клика: см. `save`.
              onMouseDown={(event) => event.preventDefault()}
              onClick={save}
            >
              {applying ? <Spinner data-icon="inline-start" /> : null}
              {t.settings.common.save}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
