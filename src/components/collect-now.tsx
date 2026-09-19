"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { topUpDigest } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Собрать выпуск, не дожидаясь ночи.
 *
 * Зовёт ту же догрузку, что и смена числа новостей: сбор и оценка общие
 * на всех читателей и уже прошли, не хватает только письма описаний.
 * Отдельная ветка «собрать первый» разошлась бы с догрузкой на потолке
 * тарифа, на дневном пределе и на исключении уже прочитанного.
 */
export function CollectNow() {
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
    <div className="flex flex-col items-center gap-1.5">
      <Button type="button" onClick={collect} disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {pending ? "Собираю…" : "Собрать сейчас"}
      </Button>
      <span className="text-xs text-muted-foreground">Займёт пару минут</span>
    </div>
  );
}
