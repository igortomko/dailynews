"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { rewriteDigest, topUpDigest } from "@/lib/actions";

/**
 * Пересборка сегодняшнего выпуска после настроек.
 *
 * Настройка, которая ничего не меняет до полуночи, — это отказ, похожий
 * на успех: ползунок принят, лента прежняя. Но и пересобирать на каждое
 * движение ползунка нельзя: письмо сорока описаний идёт минуту-две и стоит
 * денег, а в настройках за один заход трогают и число, и манеру, и язык.
 *
 * Поэтому правки копятся, а работа начинается, когда из настроек вышли:
 * к этому моменту читатель уже решил всё, что хотел. Ждать её не нужно —
 * она идёт фоном, о себе сообщает тостом в углу и сама обновляет страницу,
 * когда закончит.
 *
 * Очередь лежит в модуле, а не в состоянии компонента: компонент настроек
 * к тому времени уже размонтирован — он и есть сигнал «вышли».
 */
type Kind = "size" | "voice";

const queued = new Set<Kind>();

/** Отложить пересборку. Вызывается формами настроек, ничего не ждёт. */
export function queueRebuild(kind: Kind) {
  queued.add(kind);
}

async function run(kinds: Kind[], refresh: () => void) {
  const running = toast.loading("Пересобираю сегодняшний выпуск…", {
    description: "Это минута-две, можно читать дальше",
    duration: Infinity,
  });

  try {
    const done: string[] = [];

    // Сначала догрузка, потом переписывание: добавленные материалы пишутся
    // уже новым голосом, и переписывать их второй раз незачем.
    if (kinds.includes("size")) {
      const result = await topUpDigest();
      if (result && "error" in result) throw new Error(result.error);
      if (result?.added) done.push(`добавлено ${result.added}`);
    }

    if (kinds.includes("voice")) {
      const result = await rewriteDigest();
      if (result && "error" in result) throw new Error(result.error);
      if (result?.rewritten) done.push(`переписано ${result.rewritten}`);
    }

    toast.dismiss(running);
    if (done.length === 0) {
      toast.info("Выпуск и так соответствует настройкам");
      return;
    }
    toast.success(`Выпуск пересобран: ${done.join(", ")}`);
    refresh();
  } catch (error) {
    toast.dismiss(running);
    toast.error(error instanceof Error ? error.message : "Пересобрать не вышло");
  }
}

/**
 * Сторож выхода. Живёт выше настроек, поэтому переживает уход на ленту
 * и может обновить её, когда работа закончится.
 */
export function RebuildOnLeave() {
  const pathname = usePathname();
  const router = useRouter();
  const wasInSettings = useRef(false);

  useEffect(() => {
    const inSettings = pathname.startsWith("/settings");
    if (wasInSettings.current && !inSettings && queued.size > 0) {
      const kinds = [...queued];
      queued.clear();
      void run(kinds, () => router.refresh());
    }
    wasInSettings.current = inSettings;
  }, [pathname, router]);

  return null;
}
