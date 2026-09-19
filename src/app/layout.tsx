import type { Metadata } from "next";
import Link from "next/link";
import { Toaster } from "@/components/ui/sonner";
import { logout } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import "./globals.css";

export const metadata: Metadata = {
  title: "Лента",
  description: "Персональная новостная лента со скорингом по собственным осям",
};

const NAV = [
  { href: "/", label: "Лента" },
  { href: "/interests", label: "Интересы" },
  { href: "/sources", label: "Источники" },
  { href: "/calibration", label: "Калибровка" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="min-h-svh bg-background antialiased">
        <header className="border-b">
          <nav className="mx-auto flex max-w-3xl flex-wrap items-center gap-4 px-4 py-3">
            {NAV.map((entry) => (
              <Link
                key={entry.href}
                href={entry.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {entry.label}
              </Link>
            ))}
            <form action={logout} className="ml-auto">
              <Button variant="ghost" size="sm" type="submit">
                Выйти
              </Button>
            </form>
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
