"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { rewriteDigest, topUpDigest } from "@/lib/actions";
import { useT } from "@/components/i18n-provider";
import type { Dict } from "@/lib/i18n";
import { feed as ruFeed } from "@/lib/i18n/ru/feed";

type RebuildText = Dict["feed"]["rebuild"];

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

/**
 * Сколько секунд на «отменить» до первого запроса.
 *
 * Отмена возможна только здесь. Переписывание идёт по материалу за материал
 * и пишет в базу по ходу: прерванное на середине не откатывается, и кнопка
 * «отменить» над уже начавшейся работой обещала бы то, чего сделать нельзя.
 * Поэтому окно стоит до вызова — пока не потрачено ни одного запроса.
 */
const HOLD_MS = 5000;

/** Чем кончился заход: по этому форма решает, гасить ли кнопку. */
export type Outcome = "done" | "cancelled" | "idle" | "busy" | "failed";

/** Отложить пересборку. Вызывается формами настроек, ничего не ждёт. */
export function queueRebuild(kind: Kind) {
  queued.add(kind);
}

/**
 * Применить отложенное прямо сейчас — это и есть работа кнопки «Сохранить».
 * Промис возвращается, чтобы кнопка держала спиннер ровно столько, сколько
 * идёт пересборка, а не гасила его до срока.
 *
 * `t` по умолчанию — русские подписи: формы настроек, которые сегодня зовут
 * `flushRebuild`, ещё не подключены к словарю, и без умолчания их типизация
 * сломалась бы правкой чужого файла.
 */
export async function flushRebuild(refresh: () => void, t: RebuildText = ruFeed.rebuild): Promise<Outcome> {
  if (running) {
    toast.info(t.stillUpdatingTitle, {
      description: t.stillUpdatingDescription,
    });
    return "busy";
  }
  // Сегодняшнему выпуску менять нечего: тронули то, что решается при отборе
  // (доли тем) или не тронули ничего. Молчать тут нельзя — нажали кнопку
  // и не получили ответа, — но и обещать обновление не за что.
  if (queued.size === 0) {
    toast.success(t.savedNoChangeTitle, {
      description: t.savedNoChangeDescription,
    });
    return "idle";
  }
  const kinds = [...queued];
  queued.clear();
  return run(kinds, refresh, t);
}

async function run(kinds: Kind[], refresh: () => void, t: RebuildText = ruFeed.rebuild): Promise<Outcome> {
  // Окно отмены стоит здесь, а не в `flushRebuild`, и достаётся обоим входам
  // намеренно. Уход из настроек запускает платную работу, которую читатель
  // не просил вслух: кнопку он нажал, а тут просто закрыл раздел. Окно даёт
  // ему те же 5 секунд, чтобы сказать «не надо».
  //
  // Сторож выхода зовёт `run` мимо кнопки, и звать его во время работы
  // нельзя: правки подождут следующего запуска, а не поедут вторым вызовом.
  if (running) {
    for (const kind of kinds) queued.add(kind);
    return "busy";
  }
  running = true;

  // Что ещё не сделано. Возвращать в очередь весь список нельзя: упавшее
  // переписывание заставило бы догрузку сходить второй раз — за деньги
  // и ровно за тем же результатом.
  const left = new Set(kinds);
  let cancelled = false;

  // Окно ждём промисом, а не таймером: «Отменить» обязано сработать в тот
  // момент, когда по нему нажали. С одним `setTimeout` отмена принималась,
  // но применялась через оставшиеся секунды, и кнопка всё это время
  // крутилась — нажатие выглядело не сработавшим.
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const holdTimer = setTimeout(release, HOLD_MS);

  // Пока идёт окно отмены, заголовок стоит в будущем времени: «обновляю»
  // над работой, которая ещё не началась, — это стадия, которая врёт,
  // а такая хуже, чем никакой.
  const holdId = toast.loading(t.countdownTitle, {
    description: t.countdownDescription(HOLD_MS / 1000),
    action: {
      label: t.cancelAction,
      onClick: () => {
        cancelled = true;
        clearTimeout(holdTimer);
        release();
      },
    },
    duration: Infinity,
  });

  // Тост работы заводится свой, а не переписывается поверх прежнего: тост
  // закрывается нажатием по нему, и продолжение с тем же id после этого
  // не показывалось вовсе — работа шла молча.
  let workId: string | number | undefined;

  try {
    await held;
    toast.dismiss(holdId);
    if (cancelled) {
      // В очередь не возвращаем: отмена значит «не сейчас», и сторож выхода
      // не должен запустить то же самое через минуту сам.
      toast(t.cancelledToast);
      return "cancelled";
    }

    workId = toast.loading(t.workingTitle, {
      description: t.workingDescription,
      duration: Infinity,
    });

    const done: string[] = [];

    // Сначала догрузка, потом переписывание: добавленные материалы пишутся
    // уже новым голосом, и переписывать их второй раз незачем.
    if (kinds.includes("size")) {
      const result = await topUpDigest();
      if (result && "error" in result) throw new Error(result.error);
      if (result?.added) done.push(t.added(result.added));
      left.delete("size");
    }

    if (kinds.includes("voice")) {
      const result = await rewriteDigest();
      if (result && "error" in result) throw new Error(result.error);
      if (result?.rewritten) done.push(t.rewrote(result.rewritten));
      left.delete("voice");
    }

    toast.dismiss(workId);
    if (done.length === 0) {
      toast.info(t.noChangeTodayTitle, {
        description: t.noChangeTodayDescription,
      });
      return "done";
    }
    toast.success(t.updated(done.join(", ")), {
      description: t.updatedDescription,
    });
    refresh();
    return "done";
  } catch (error) {
    // Тост окна к этому моменту уже закрыт: сюда попадают только из работы.
    if (workId !== undefined) toast.dismiss(workId);
    toast.error(error instanceof Error ? error.message : t.failed);
    // Недоделанное возвращаем в очередь: списанная работа, которая
    // не сделалась, — это отказ, похожий на успех. Второе «Сохранить»
    // отвечало бы «настройки сохранены», а выпуск остался бы прежним.
    for (const kind of left) queued.add(kind);
    return "failed";
  } finally {
    clearTimeout(holdTimer);
    running = false;
  }
}

/**
 * Сторож выхода. Живёт выше настроек, поэтому переживает уход на ленту
 * и может обновить её, когда работа закончится.
 */
export function RebuildOnLeave() {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const wasInSettings = useRef(false);

  useEffect(() => {
    const inSettings = pathname.startsWith("/settings");
    if (wasInSettings.current && !inSettings && queued.size > 0) {
      const kinds = [...queued];
      queued.clear();
      void run(kinds, () => router.refresh(), t.feed.rebuild);
    }
    wasInSettings.current = inSettings;
  }, [pathname, router, t]);

  return null;
}
