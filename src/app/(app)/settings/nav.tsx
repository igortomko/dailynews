"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { FEATURES, type FeatureId, type Plan } from "@/lib/plans";
import { PaywallCrown } from "@/components/paywall";
import { useT } from "@/components/i18n-provider";
import type { Dict } from "@/lib/i18n";

/**
 * Подпись берётся из словаря по ключу, а не лежит строкой: список один
 * на оба языка, и вторая его копия разъехалась бы с первой на первом же
 * новом разделе.
 */
const SECTIONS: { href: string; label: (t: Dict) => string; feature?: FeatureId }[] = [
  { href: "/settings/personalization", label: (t) => t.nav.personalization },
  { href: "/settings/sources", label: (t) => t.nav.sources },
  { href: "/settings/interests", label: (t) => t.nav.interests },
  { href: "/settings/delivery", label: (t) => t.nav.delivery, feature: "delivery" },
  { href: "/settings/channels", label: (t) => t.nav.channels, feature: "posts" },
  { href: "/settings/subscription", label: (t) => t.nav.subscription },
  { href: "/settings/about", label: (t) => t.nav.about },
];

/**
 * «Калибровки» в списке нет намеренно, а страница осталась и открывается
 * прямой ссылкой. Она отвечает на вопрос «угадывает ли отбор» — это мера
 * нашего качества, а не ручка читателя: увидев её, он начинает думать
 * о механике вместо новостей. Тариф на ней по-прежнему проверяется,
 * поэтому ссылка не обходит оплату.
 *
 * Закрытый раздел показывается с короной, а не прячется: спрятанный пункт
 * не даёт понять, что в продукте вообще есть — и за что предлагается
 * платить. Ссылка остаётся рабочей, на той стороне стоит заглушка;
 * клик по самой короне открывает окно с предложением, не уводя со страницы.
 */
export function SettingsNav({ plan }: { plan: Plan }) {
  const pathname = usePathname();
  const t = useT();

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
            {section.label(t)}
            {locked && section.feature ? (
              <PaywallCrown feature={section.feature} plan={plan} className="ml-1.5" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
