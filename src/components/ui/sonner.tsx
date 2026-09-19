"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Тост обратный странице, а не «как карточка»: на светлой теме — чёрный.
 *
 * Белая плашка с тонкой рамкой на светлой странице читалась как ещё один
 * блок интерфейса: она появлялась и исчезала, а сказанное в ней не доходило.
 * Тосту нечем настаивать на себе, кроме контраста, — он не двигает вёрстку
 * и не ждёт нажатия. Поэтому цвета взяты обратные странице: фон из
 * --foreground, текст из --background. Названы переменными, а не чёрным
 * с белым: заведись тёмная тема — тост останется заметным, перевернувшись
 * вместе со страницей, а не сольётся с ней. Это же делает и всплывающая
 * подсказка — две вещи, которые лежат поверх страницы, выглядят одинаково.
 *
 * Иконка остаётся единственным цветным пятном: на общем чёрном фоне успех
 * и ошибка иначе неотличимы, а разбирать это по тексту — лишняя работа.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4 text-emerald-400" />
        ),
        info: (
          <InfoIcon className="size-4 text-sky-400" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4 text-amber-400" />
        ),
        error: (
          <OctagonXIcon className="size-4 text-red-400" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--foreground)",
          "--normal-text": "var(--background)",
          "--normal-border": "transparent",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          // Подпись под заголовком у sonner приглушена своим цветом,
          // рассчитанным на светлую плашку: на чёрной она проваливается
          // в фон. Тот же текст, что и заголовок, только прозрачнее.
          description: "!text-background/70",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
