"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/components/i18n-provider";

/**
 * Несохранённая правка не уходит со страницы молча.
 *
 * Настройки сохраняются кнопкой, а не сами: пока запись шла с паузой после
 * последней правки, кнопка «Сохранить» описывала то, что уже произошло,
 * и отличить сохранённое от несохранённого было нечем. Цена решения —
 * правка, брошенная уходом со страницы, пропадает по-настоящему, поэтому
 * уход перехватывается и спрашивает.
 *
 * Регистрация модулем, а не контекстом: сторож живёт в раскладке настроек,
 * форма — внутри страницы, и прокидывать через три уровня ради двух функций
 * незачем. Тот же приём, что у очереди пересборки рядом.
 *
 * Кнопка «назад» браузера этим не ловится: переход по истории не даёт
 * ни нажатия на ссылку, ни `beforeunload`. Поймать её можно только ловушкой
 * в истории — лишняя запись на каждую правку и отсчёт шагов назад при уходе,
 * — и цена такой ловушки выше, чем дыра: из настроек уходят разделами слева,
 * а они ссылки. Появится жалоба — чиниться будет этим, и осознанно.
 */
type Save = () => Promise<boolean>;

let unsaved: Save | null = null;

/** Форма говорит: есть что терять, и вот чем это сохранить. */
export function markUnsaved(save: Save) {
  unsaved = save;
}

/** Форма говорит: терять нечего. Зовётся и при размонтировании. */
export function markSaved() {
  unsaved = null;
}

export function UnsavedGuard() {
  const t = useT();
  const router = useRouter();
  const [going, setGoing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    /**
     * Перехват на всплытии вниз (capture): ссылка Next уводит на своём
     * обработчике, и обычный слушатель получил бы событие после него —
     * переход уже начался бы.
     */
    const onClick = (event: MouseEvent) => {
      if (!unsaved || event.defaultPrevented || event.button !== 0) return;
      // Ctrl, ⌘ и Shift открывают в новой вкладке: эта страница остаётся
      // на месте вместе с правкой, и спрашивать не о чем.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const link = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank") return;

      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const to = `${url.pathname}${url.search}`;
      if (to === `${window.location.pathname}${window.location.search}`) return;

      event.preventDefault();
      setGoing(to);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    // Закрытие вкладки и перезагрузка: своего окна там не показать, браузер
    // спрашивает сам и своими словами. Без этого правка пропадала бы тише
    // всего — по случайному Cmd+W.
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!unsaved) return;
      event.preventDefault();
      // Safari и старый Chromium показывают своё окно только на непустом
      // `returnValue`: без него `preventDefault` там ничего не делает,
      // и защита есть ровно на вид.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  const leave = (to: string) => {
    markSaved();
    setGoing(null);
    router.push(to);
  };

  return (
    <Dialog open={going !== null} onOpenChange={(open) => !open && setGoing(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.settings.unsavedGuard.title}</DialogTitle>
          <DialogDescription>
            {t.settings.unsavedGuard.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {/* Кнопки называют оба исхода словами: «Да» и «Нет» здесь читаются
              только вместе с вопросом, а читают обычно одни кнопки. */}
          <DialogClose render={<Button variant="ghost" />} onClick={() => going && leave(going)}>
            {t.settings.unsavedGuard.discard}
          </DialogClose>
          <Button
            disabled={saving}
            onClick={async () => {
              if (!unsaved || !going) return;
              setSaving(true);
              // Пересборку выпуска ждать не нужно: она идёт минуту-две
              // и сама расскажет о себе тостом. Уходим сразу после записи.
              const ok = await unsaved().catch(() => false);
              setSaving(false);
              if (ok) leave(going);
              else setGoing(null);
            }}
          >
            {saving ? <Spinner data-icon="inline-start" /> : null}
            {t.settings.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
