import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

/**
 * Без явного подключения --font-sans остаётся пустой, @apply font-sans
 * получает пустоту, и браузер рисует весь интерфейс шрифтом с засечками
 * по умолчанию. Выглядит это как «плохой контраст», хотя дело в шрифте.
 * Inter выбран за читаемость на мелких размерах и полную кириллицу.
 */
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
  display: "swap",
});

/**
 * Описание одно на всех и по-английски: карточку ссылки собирает чужой робот
 * без сессии, и языка читателя в этот момент не знает никто. Переводить его
 * по `Accept-Language` робота значит описывать продукт тем языком, на котором
 * говорит краулер, а не тот, кто перейдёт по ссылке.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://news.tomko.io"),
  title: "Reporta",
  description: "A personal news feed that pulls the signal out of the stream",
  icons: {
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/brand/favicon-180.png",
  },
  openGraph: {
    title: "Reporta",
    description: "A personal news feed that pulls the signal out of the stream",
    images: [{ url: "/brand/social-preview.png", width: 1200, height: 630, alt: "Reporta brand mark" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Reporta",
    description: "A personal news feed that pulls the signal out of the stream",
    images: ["/brand/social-preview.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-svh bg-background font-sans antialiased">
        {/*
          Тема идёт за системной и переключателя не имеет. Переменные .dark
          лежали в globals.css с первого дня, next-themes стоял в зависимостях,
          а провайдера не было ни одного: тёмная тема существовала в коде
          и не существовала на экране — ровно тот отказ, что выглядит
          как успех. Выпуск читают вечером, и белая страница в темноте бьёт
          по глазам сильнее, чем стоит любой переключатель.
          Своего выбора нет намеренно: настройка, которую читатель уже сделал
          в системе, не должна спрашиваться второй раз.
        */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {/* Задержка общая на всё приложение: подсказка, выскакивающая
              мгновенно, мельтешит при проходе курсора по ряду иконок.
              Полсекунды — это «я остановился и не понимаю», а не «я мимо». */}
          <TooltipProvider delay={500}>{children}</TooltipProvider>
          <Toaster position="bottom-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
