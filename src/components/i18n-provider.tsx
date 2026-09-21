"use client";

import { createContext, useContext, type ReactNode } from "react";
import { dictOf, type Dict, type Locale } from "@/lib/i18n";

/**
 * Словарь для клиентских компонентов.
 *
 * Сам словарь не передаётся: он у клиента уже есть — оба языка лежат
 * в бандле. Передаётся только выбранный язык, а строки берутся из того же
 * файла, что и на сервере. Иначе каждая отрисовка тащила бы сотню строк
 * в разметке страницы заново.
 */
const LocaleContext = createContext<Locale>("en");

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** Словарь текущего читателя. Ключи те же, что и на сервере. */
export function useT(): Dict {
  return dictOf(useContext(LocaleContext));
}

/** Какой язык выбран сейчас: нужен переключателю, чтобы показать себя. */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}
