import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
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

export const metadata: Metadata = {
  title: "Лента",
  description: "Персональная новостная лента со скорингом по собственным осям",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-svh bg-background font-sans antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
