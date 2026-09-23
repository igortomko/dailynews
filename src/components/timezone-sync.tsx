"use client";

import { useEffect } from "react";
import { saveTimezone } from "@/lib/actions";

/**
 * Пояс читателя по первому заходу — тем, что знает о нём браузер.
 *
 * Бот пояса не знает (Telegram его не отдаёт), а спрашивать в онбординге —
 * лишнее решение на входе. Пустой пояс читается как Сан-Паулу, и выпуск
 * до этого захода приходит по нему. Ошибка молчит: не сохранилось —
 * повторится на следующем заходе, а поле в «Доставке» остаётся.
 */
export function TimezoneSync() {
  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) saveTimezone(timezone).catch(() => {});
  }, []);
  return null;
}
