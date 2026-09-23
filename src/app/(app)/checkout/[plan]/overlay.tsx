"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { initializePaddle } from "@paddle/paddle-js";
import { useT } from "@/components/i18n-provider";
import type { CheckoutParams } from "@/lib/billing";

/**
 * Открывает overlay Paddle сразу по приходу на страницу.
 *
 * Закрыл окно — вернулся к тарифам: пустая страница с надписью «Открываем
 * оплату…» после закрытия выглядела бы зависшей. Оплатил — тоже туда же:
 * тариф включит вебхук, и страница подписки его покажет.
 */
export function CheckoutOverlay({ checkout }: { checkout: CheckoutParams }) {
  const t = useT();
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let done = false;
    const back = () => {
      if (done) return;
      done = true;
      router.replace("/settings/subscription");
    };
    initializePaddle({
      token: checkout.token,
      environment: checkout.environment,
      eventCallback: (event) => {
        if (event.name === "checkout.closed") back();
        if (event.name === "checkout.error") setFailed(true);
      },
    })
      .then((paddle) => {
        if (!paddle) throw new Error("Paddle.js не загрузился");
        paddle.Checkout.open({
          items: [{ priceId: checkout.priceId, quantity: 1 }],
          customData: checkout.customData,
          ...(checkout.discountCode ? { discountCode: checkout.discountCode } : {}),
          ...(checkout.email ? { customer: { email: checkout.email } } : {}),
          settings: {
            variant: "one-page",
            successUrl: `${window.location.origin}/settings/subscription`,
          },
        });
      })
      .catch(() => setFailed(true));
  }, [checkout, router]);

  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center text-sm text-muted-foreground">
      <p role="status">{failed ? t.plans.checkout.failed : t.plans.checkout.opening}</p>
      <a href="/settings/subscription" className="underline underline-offset-4 hover:text-foreground">
        {t.plans.checkout.back}
      </a>
    </main>
  );
}
