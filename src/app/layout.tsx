import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Лента",
  description: "Персональная новостная лента со скорингом по собственным осям",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="min-h-svh bg-background antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
