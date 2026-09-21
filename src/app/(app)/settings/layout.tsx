import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleToggle } from "@/components/locale-toggle";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { logout } from "@/lib/actions";
import { currentReader } from "@/lib/session";

import { checkoutUrl, effectivePlan } from "@/lib/lemon";
import { PLAN_IDS } from "@/lib/plans";
import { PaywallProvider } from "@/components/paywall";
import { UnsavedGuard } from "@/components/unsaved-guard";
import { getDict } from "@/lib/i18n/server";
import { SettingsNav } from "./nav";

/**
 * Слева разделы, справа содержимое. Настройки открывают редко и с намерением
 * («поменять источники»), поэтому список разделов должен быть виден целиком,
 * а не прятаться под кнопку, как в ленте.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const reader = await currentReader();
  const plan = effectivePlan(reader);
  const t = await getDict();
  const onboarding = !reader.onboarded_at;
  // Ссылки на оплату собираются здесь: их строит сервер из переменных
  // окружения, а окно с предложением живёт в клиентских компонентах.
  const checkout = Object.fromEntries(
    PLAN_IDS.map((id) => [id, checkoutUrl(id, reader.id)]).filter(([, url]) => url),
  ) as Record<string, string>;
  return (
    <PaywallProvider checkout={checkout}>
      {/* Настройки сохраняются кнопкой, а не сами: уход с несохранённой
          правкой перехватывается здесь, над всеми разделами сразу. */}
      <UnsavedGuard />
      <PageHeader
        left={
          <div className="flex items-center gap-2">
            {/* Пока онбординг не пройден, лента недостижима: она сама
                возвращает сюда. Стрелка «назад к ленте» в этот момент —
                кнопка, которая обещает и не делает: нажал, и та же страница.
                Отказ, неотличимый от работы, поэтому её просто нет. */}
            {onboarding ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    nativeButton={false}
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t.nav.backToFeed}
                    // На телефоне 40, на указателе 32: под палец 28 —
                    // это иконка, а не цель. Так же сделаны шестерёнка
                    // в ленте и переключатель темы рядом.
                    className="size-10 text-muted-foreground hover:text-foreground sm:size-8"
                    // Лента подгружается заранее, пока правят настройки:
                    // возвращение — самый частый переход отсюда, и ждать
                    // ему нечего. Сохранение настроек сбрасывает подгруженное
                    // само (`revalidatePath`), устаревшая лента не покажется.
                    render={<Link href="/" prefetch={true} />}
                  />
                }
              >
                <ArrowLeftIcon />
              </TooltipTrigger>
              <TooltipContent>{t.nav.backToFeed}</TooltipContent>
            </Tooltip>
            )}
            <h1 className="text-sm font-medium">{onboarding ? t.nav.onboarding : t.nav.settings}</h1>
          </div>
        }
        // На телефоне колонка разделов идёт лентой поверху, и «Выйти» под ней
        // занимало целую строку ради одной кнопки. В шапке справа место уже
        // есть и пустует. На широком экране выход остаётся внизу колонки.
        right={
          <div className="flex items-center gap-1">
            {/* Переключатель темы стоит на обеих страницах: уйти в настройки
                и не найти его там, где он только что был, — это заставить
                вернуться за ним в ленту. */}
            {/* Язык интерфейса слева от темы: обе — настройки окружения,
                а не содержимого, и живут одной парой. В ленте этой пары нет:
                язык выбирают один раз, а место в её шапке занято тем,
                чем пользуются каждый день. */}
            <LocaleToggle className="h-10 sm:h-8" />
            <ThemeToggle className="size-10 sm:size-8" />
            <form action={logout} className="sm:hidden">
              <Button variant="ghost" size="sm" type="submit" className="h-10 px-3">
                {t.nav.signOut}
              </Button>
            </form>
          </div>
        }
      />

      <div className="mx-auto flex max-w-page flex-col gap-8 px-4 py-6 sm:flex-row sm:gap-10">
      {/* Колонка разделов прибита к экрану: в источниках список на два
          экрана, и «Выйти» с ним уезжало вниз страницы — на месте оставалась
          пустая колонка. Высота считается от окна за вычетом шапки (3rem)
          и полей (по 1.5rem), поэтому «Выйти» стоит внизу экрана, а не внизу
          документа. На узком экране разделы идут лентой поверху, и прибивать
          там нечего. */}
      <aside className="flex shrink-0 flex-col gap-1 sm:sticky sm:top-[4.5rem] sm:h-[calc(100dvh-6rem)] sm:w-44 sm:self-start">
        <SettingsNav plan={plan} />
        <form action={logout} className="mt-4 hidden sm:mt-auto sm:block">
          <Button variant="ghost" size="sm" type="submit" className="w-full justify-start px-2">
            {t.nav.signOut}
          </Button>
        </form>
      </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </PaywallProvider>
  );
}
