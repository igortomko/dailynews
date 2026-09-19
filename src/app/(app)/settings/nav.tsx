"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { FEATURES, type FeatureId, type Plan } from "@/lib/plans";
import { PaywallCrown } from "@/components/paywall";

const SECTIONS: { href: string; label: string; feature?: FeatureId }[] = [
  { href: "/settings/personalization", label: "Персонализация", feature: "personalization" },
  { href: "/settings/interests", label: "Интересы" },
  { href: "/settings/sources", label: "Источники" },
  { href: "/settings/delivery", label: "Доставка" },
  { href: "/settings/calibration", label: "Калибровка", feature: "calibration" },
  { href: "/settings/subscription", label: "Подписка" },
  { href: "/settings/about", label: "О проекте" },
];

/**
 * Закрытый раздел показывается с короной, а не прячется: спрятанный пункт
 * не даёт понять, что в продукте вообще есть — и за что предлагается
 * платить. Ссылка остаётся рабочей, на той стороне стоит заглушка;
 * клик по самой короне открывает окно с предложением, не уводя со страницы.
 */
export function SettingsNav({ plan }: { plan: Plan }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
      {SECTIONS.map((section) => {
        const active = pathname === section.href;
        const locked = section.feature !== undefined && !FEATURES[section.feature].has(plan);
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
            {locked && section.feature ? (
              <PaywallCrown feature={section.feature} plan={plan} className="ml-1.5" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
