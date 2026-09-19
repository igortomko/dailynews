"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LockIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Gated } from "@/lib/plans";

const SECTIONS: { href: string; label: string; section?: Gated }[] = [
  { href: "/settings/personalization", label: "Персонализация", section: "personalization" },
  { href: "/settings/interests", label: "Интересы" },
  { href: "/settings/sources", label: "Источники" },
  { href: "/settings/delivery", label: "Доставка" },
  { href: "/settings/calibration", label: "Калибровка", section: "calibration" },
  { href: "/settings/subscription", label: "Подписка" },
  { href: "/settings/about", label: "О проекте" },
];

/**
 * Закрытый раздел показывается с замком, а не прячется: спрятанный пункт
 * не даёт понять, что в продукте вообще есть — и за что предлагается
 * платить. Ссылка остаётся рабочей, на той стороне стоит заглушка.
 */
export function SettingsNav({ open }: { open: Gated[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
      {SECTIONS.map((section) => {
        const active = pathname === section.href;
        const locked = section.section !== undefined && !open.includes(section.section);
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
            {locked ? (
              <LockIcon className="ml-1.5 inline size-3 align-[-1px] opacity-60" aria-label="закрыто тарифом" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
