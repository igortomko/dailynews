"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { topUpDigest } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Что видит читатель, у которого ещё нет ни одного выпуска.
 *
 * Здесь стояла команда `npm run pipeline` — единственное место в продукте,
 * где читателю показывали терминал. Выполнить её он не может ни при каких
 * условиях, и первый же экран после настройки сообщал ему, что лента
 * вообще не про него.
 *
 * Кнопка зовёт ту же догрузку, что и смена числа новостей: сбор и оценка
 * общие на всех читателей и уже прошли, так что ждать до полуночи нечего —
 * не хватает только письма описаний. Дневной потолок и предел тарифа
 * она обходить не умеет, потому что это тот же путь.
 */
export function FirstDigest() {
  // Состояние своё, а не из useTransition: тот следит лишь за синхронной
  // частью функции, и на первом же await кнопка оживала — за минуты письма
  // описаний второе нажатие успевало запустить второй платный прогон.
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const collect = async () => {
    if (pending) return;
    setPending(true);
    try {
      const result = await topUpDigest();
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      if (!result?.added) {
        toast.info(result?.note ?? "Свежих новостей пока нет");
        return;
      }
      toast.success(`Собрали: ${result.added}`);
      router.refresh();
    } catch {
      // Ожидаемые отказы приходят как { error }; сюда попадают оборванная
      // сеть и упавшая модель. Промолчать здесь — оставить читателя
      // с кнопкой, которая просто перестала крутиться.
      toast.error("Не получилось собрать выпуск — попробуй ещё раз");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-page flex-col items-start gap-4 px-4 py-16 sm:py-24">
      <h1 className="font-heading text-2xl font-semibold">Первый выпуск придёт завтра утром</h1>
      <p className="max-w-[52ch] text-muted-foreground">
        Новости собираются ночью. Можно не ждать — соберём выпуск прямо сейчас
        из того, что уже вышло.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={collect} disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {pending ? "Собираю…" : "Собрать сейчас"}
        </Button>
        {/* Вторая дорога обязательна: собирать нечего, пока не выбраны
            интересы, и упереться в это молча читатель не должен. */}
        <Button variant="ghost" render={<Link href="/settings/interests" />}>
          Выбрать интересы
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Займёт пару минут.</p>
    </div>
  );
}
