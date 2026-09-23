"use client";

import { useEffect } from "react";
import { initializePaddle } from "@paddle/paddle-js";

/**
 * Ссылка оплаты Paddle (`/pricing?_ptxn=txn_…`).
 *
 * Эта страница — Default payment link аккаунта: сюда Paddle шлёт людей
 * из писем — обновить карту, оплатить продление, которое не прошло.
 * Paddle.js, увидев `_ptxn` в адресе, сам открывает оплату этой
 * транзакции; без него ссылка из письма вела бы на обычную страницу цен.
 */
export function PaddleLink({ token, environment }: { token: string; environment: "sandbox" | "production" }) {
  useEffect(() => {
    initializePaddle({ token, environment }).catch(() => undefined);
  }, [token, environment]);
  return null;
}
