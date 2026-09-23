"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteProfile } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/components/i18n-provider";

/**
 * Удаление профиля — тихой ссылкой в строке с политикой и условиями,
 * а не карточкой: действие нужно раз в жизни, и карточкой на весь экран
 * оно звало к себе каждого, кто заходит посмотреть на сэкономленное время.
 * Красным она становится только под курсором.
 *
 * Что именно сотрётся и почему сейчас нельзя — говорит окно после нажатия,
 * и у владельца тоже: спрятанная ссылка на его экране выглядела бы так,
 * будто удаления в продукте нет.
 */
export function DeleteProfile({
  blocker,
  portalUrl,
}: {
  blocker: "owner" | "subscription" | null;
  portalUrl: string | null;
}) {
  const t = useT().plans.about;
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();

  const remove = () =>
    startTransition(async () => {
      // Успех уводит на вход редиректом, сюда возвращается только отказ.
      const result = await deleteProfile();
      if (result?.error) {
        toast.error(result.error);
        setOpen(false);
      }
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hover:text-destructive hover:underline focus-visible:text-destructive"
      >
        {t.deleteButton}
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.deleteConfirmTitle}</DialogTitle>
          <DialogDescription>
            {blocker === "owner"
              ? t.deleteBlockedOwner
              : blocker === "subscription"
                ? t.deleteBlockedSubscription
                : t.deleteDescription}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>
            {t.deleteCancel}
          </DialogClose>
          {blocker === "owner" ? null : blocker === "subscription" ? (
            portalUrl ? <Button render={<a href={portalUrl} />}>{t.openPortal}</Button> : null
          ) : (
            <Button variant="destructive" onClick={remove} disabled={busy}>
              {busy ? <Spinner /> : null}
              {t.deleteConfirm}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
