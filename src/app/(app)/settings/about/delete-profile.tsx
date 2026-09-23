"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteProfile } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/components/i18n-provider";

/**
 * Удаление профиля — последней карточкой «О проекте», рядом с политикой,
 * где и сказано, что удаляется. Не удалить — не прячем кнопку молча,
 * а называем причину и выход: у подписки это кабинет оплаты.
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
    <Card>
      <CardHeader>
        <CardTitle>{t.deleteTitle}</CardTitle>
        <CardDescription>{t.deleteDescription}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3 text-sm">
        {blocker === "owner" ? (
          <p className="text-muted-foreground">{t.deleteBlockedOwner}</p>
        ) : blocker === "subscription" ? (
          <>
            <p className="text-muted-foreground">{t.deleteBlockedSubscription}</p>
            {portalUrl ? (
              <Button size="sm" variant="outline" render={<a href={portalUrl} />}>
                {t.openPortal}
              </Button>
            ) : null}
          </>
        ) : (
          <Dialog open={open} onOpenChange={setOpen}>
            <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>
              {t.deleteButton}
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t.deleteConfirmTitle}</DialogTitle>
                <DialogDescription>{t.deleteConfirmText}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" disabled={busy} />}>
                  {t.deleteCancel}
                </DialogClose>
                <Button variant="destructive" onClick={remove} disabled={busy}>
                  {busy ? <Spinner /> : null}
                  {t.deleteConfirm}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}
