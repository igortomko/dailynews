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
 * Поэтому правки копятся, а работа начинается по одному из двух сигналов:
 * нажали «Сохранить» (`flushRebuild`) или ушли из настроек, ничего не нажав
 * (`RebuildOnLeave`). Второй — не дубль первого, а страховка: правка,
 * сохранённая автоматически, иначе доехала бы до ленты только к полуночи,
 * и настройки выглядели бы не работающими ровно так же, как до кнопки.
 *
 * Ждать работу не нужно — она идёт фоном, о себе сообщает тостом в углу
 * и сама обновляет страницу, когда закончит.
 *
 * Очередь лежит в модуле, а не в состоянии компонента: сторож выхода стоит
 * выше настроек, а формы к моменту ухода уже размонтированы.
 */
type Kind = "size" | "voice";

const queued = new Set<Kind>();

/**
 * Идёт ли пересборка прямо сейчас. Кнопка запускает её, не уходя со страницы,
 * поэтому второй запуск теперь возможен: нажал «Сохранить», поправил ещё раз
 * и вышел — и сторож выхода завёл бы `rewriteDigest` параллельно первому.
 * Это ровно та двойная оплата одной работы, от которой здесь и заведена
 * очередь, плюс два спорящих тоста на одном выпуске.
 */
let running = false;

/** Отложить пересборку. Вызывается формами настроек, ничего не ждёт. */
export function queueRebuild(kind: Kind) {
  queued.add(kind);
}

/**
 * Применить отложенное прямо сейчас — это и есть работа кнопки «Сохранить».
 * Промис возвращается, чтобы кнопка держала спиннер ровно столько, сколько
 * идёт пересборка, а не гасила его до срока.
 */
export async function flushRebuild(refresh: () => void) {
  if (running) {
    toast.info("Сохранили. Выпуск ещё обновляется", {
      description: "Нажми «Сохранить» ещё раз, когда закончим",
    });
    return;
  }
  // Сегодняшнему выпуску менять нечего: тронули то, что решается при отборе
  // (доли тем) или не тронули ничего. Молчать тут нельзя — нажали кнопку
  // и не получили ответа, — но и обещать пересборку не за что.
  if (queued.size === 0) {
    toast.success("Настройки сохранены", {
      description: "Следующие выпуски придут уже с ними",
    });
    return;
  }
  const kinds = [...queued];
  queued.clear();
  await run(kinds, refresh);
}

async function run(kinds: Kind[], refresh: () => void) {
  // Сторож выхода зовёт `run` мимо кнопки, и звать его во время работы
  // нельзя: правки подождут следующего запуска, а не поедут вторым вызовом.
  if (running) {
    for (const kind of kinds) queued.add(kind);
    return;
  }
  running = true;

  const running_toast = toast.loading("Обновляю сегодняшний выпуск…", {
    description: "Это минута-две, можно читать дальше",
    duration: Infinity,
  });

  // Что ещё не сделано. Возвращать в очередь весь список нельзя: упавшее
  // переписывание заставило бы догрузку сходить второй раз — за деньги
  // и ровно за тем же результатом.
  const left = new Set(kinds);

  try {
    const done: string[] = [];

    // Сначала догрузка, потом переписывание: добавленные материалы пишутся
    // уже новым голосом, и переписывать их второй раз незачем.
    if (kinds.includes("size")) {
      const result = await topUpDigest();
      if (result && "error" in result) throw new Error(result.error);
      if (result?.added) done.push(`добавили ${result.added}`);
      left.delete("size");
    }

    if (kinds.includes("voice")) {
      const result = await rewriteDigest();
      if (result && "error" in result) throw new Error(result.error);
      if (result?.rewritten) done.push(`переписали ${result.rewritten}`);
      left.delete("voice");
    }

    toast.dismiss(running_toast);
    if (done.length === 0) {
      toast.info("Сегодняшний выпуск уже такой", {
        description: "Следующие придут с новыми настройками",
      });
      return;
    }
    toast.success(`Сегодняшний выпуск обновили: ${done.join(", ")}`, {
      description: "Следующие соберутся по новым настройкам",
    });
    refresh();
  } catch (error) {
    toast.dismiss(running_toast);
    toast.error(error instanceof Error ? error.message : "Не удалось обновить выпуск");
    // Недоделанное возвращаем в очередь: списанная работа, которая
    // не сделалась, — это отказ, похожий на успех. Второе «Сохранить»
    // отвечало бы «настройки сохранены», а выпуск остался бы прежним.
    for (const kind of left) queued.add(kind);
  } finally {
    running = false;
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
