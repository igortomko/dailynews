"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  // Номер последней правки. `write` снимает слепок формы в момент вызова,
  // а серверное действие идёт заметное время: правка, сделанная пока оно шло,
  // в этот слепок не попала. Гасить по её итогу — значит потерять её молча:
  // кнопка гаснет, сторож ухода снимается, в базе прежнее.
  const edits = useRef(0);

  /** Правка, о которой знают кнопка и сторож ухода. Сама ничего не пишет. */
  const touch = useCallback(() => {
    edits.current += 1;
    setDirty(true);
  }, []);

  /** Погасить, только если с момента снимка формы ничего нового не появилось. */
  const settle = useCallback((mark: number) => {
    if (edits.current === mark) setDirty(false);
  }, []);

  /** «Сохранить»: записать и довести правку до сегодняшнего выпуска. */
  const apply = useCallback(async () => {
    setApplying(true);
    try {
      const mark = edits.current;
      const ok = await write();
      if (!ok) return;
      settle(mark);
      const outcome = await rebuild().catch((): Outcome => "failed");
      // `busy` и `failed` оставляют работу в очереди, а тост зовёт нажать
      // ещё раз. Погашенная кнопка сделала бы это невозможным: единственным
      // выходом остался бы уход из настроек.
      if (outcome !== "done" && outcome !== "idle") setDirty(true);
    } finally {
      // В `finally`, а не в конце: тип `write` не обещает, что он не бросит,
      // а спиннер, оставшийся гореть, гасит кнопку навсегда — у всех форм,
      // которые берут этот крючок.
      setApplying(false);
    }
  }, [write, rebuild, settle]);

  useEffect(() => {
    if (!dirty) {
      markSaved();
      return;
    }
    // Сторожу нужна сама запись: из окна «сохранить перед уходом» уходят
    // сразу после неё, не дожидаясь пересборки — она идёт минуту-две
    // и сама расскажет о себе тостом уже на следующей странице.
    markUnsaved(async () => {
      const mark = edits.current;
      const ok = await write();
      if (ok) {
        settle(mark);
        void rebuild().catch(() => {});
      }
      return ok;
    });
  }, [dirty, write, rebuild, settle]);

  // Ушли со страницы — сторожить нечего: окно уже спросило, а без этого
  // оно всплыло бы на соседнем разделе.
  useEffect(() => markSaved, []);

  return { dirty, applying, touch, apply };
}
