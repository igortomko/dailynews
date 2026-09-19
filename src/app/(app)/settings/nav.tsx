"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/settings/personalization", label: "Персонализация" },
  { href: "/settings/sources", label: "Источники" },
  { href: "/settings/calibration", label: "Калибровка" },
  { href: "/settings/subscription", label: "Подписка" },
  { href: "/settings/about", label: "О проекте" },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
      {SECTIONS.map((section) => {
        const active = pathname === section.href;
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-md px-2 py-1.5 text-sm whitespace-nowrap transition-colors",
              // Полупрозрачный тон вместо сплошной заливки: сплошная на сером
              // фоне читается как отдельный светлый блок поверх страницы,
              // а не как выделение внутри неё.
              active
                ? "bg-foreground/[0.06] font-medium text-foreground"
                : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
