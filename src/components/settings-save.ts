"use client";

import { useCallback, useEffect, useState } from "react";
import type { Outcome } from "@/components/rebuild-queue";
import { markSaved, markUnsaved } from "@/components/unsaved-guard";

/**
 * Общая часть форм настроек: что тронуто, что сохранено и кто об этом знает.
 *
 * Одним местом, а не копией в каждой форме: обе держат один и тот же порядок
 * — записать, пересобрать сегодняшний выпуск, погасить кнопку, — и первая же
 * правка этого порядка требовала бы двух одинаковых правок в разных файлах.
 * Разъезжаются такие копии тише всего: обе работают, просто по-разному.
 *
 * `write` пишет и отвечает, получилось ли. `rebuild` доводит правку
 * до сегодняшнего выпуска; обе должны быть стабильными (`useCallback`),
 * иначе сторож ухода перерегистрируется на каждом кадре.
 */
export function useSettingsSave(
  write: () => Promise<boolean>,
  rebuild: () => Promise<Outcome>,
) {
  const [dirty, setDirty] = useState(false);
  const [applying, setApplying] = useState(false);

  /** Правка, о которой знают кнопка и сторож ухода. Сама ничего не пишет. */
  const touch = useCallback(() => setDirty(true), []);

  /** «Сохранить»: записать и довести правку до сегодняшнего выпуска. */
  const apply = useCallback(async () => {
    setApplying(true);
    const ok = await write();
    if (ok) {
      setDirty(false);
      const outcome = await rebuild().catch((): Outcome => "failed");
      // `busy` и `failed` оставляют работу в очереди, а тост зовёт нажать
      // ещё раз. Погашенная кнопка сделала бы это невозможным: единственным
      // выходом остался бы уход из настроек.
      //
      // Правка, сделанная пока шла пересборка, уже вернула `dirty` сама —
      // отдельный счётчик правок для этого не нужен.
      if (outcome !== "done" && outcome !== "idle") setDirty(true);
    }
    setApplying(false);
  }, [write, rebuild]);

  useEffect(() => {
    if (!dirty) {
      markSaved();
      return;
    }
    // Сторожу нужна сама запись: из окна «сохранить перед уходом» уходят
    // сразу после неё, не дожидаясь пересборки — она идёт минуту-две
    // и сама расскажет о себе тостом уже на следующей странице.
    markUnsaved(async () => {
      const ok = await write();
      if (ok) {
        setDirty(false);
        void rebuild().catch(() => {});
      }
      return ok;
    });
  }, [dirty, write, rebuild]);

  // Ушли со страницы — сторожить нечего: окно уже спросило, а без этого
  // оно всплыло бы на соседнем разделе.
  useEffect(() => markSaved, []);

  return { dirty, applying, touch, apply };
}
