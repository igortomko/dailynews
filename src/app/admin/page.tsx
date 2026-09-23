import Link from "next/link";
import { loadCosts } from "@/lib/analytics/costs";
import { CostsView } from "./costs-view";
import { ProductDashboard } from "./product";

export const dynamic = "force-dynamic";

/**
 * Две вкладки, а не одна длинная страница: продуктовую часть рисует
 * Launch Kit целиком со своей шапкой и прокруткой, и расходы под ней
 * оказались бы на десятом экране.
 */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const tab = (await searchParams).tab === "costs" ? "costs" : "product";
  return (
    <>
      <nav className="mx-auto flex max-w-[1160px] items-center gap-1 px-3 pt-4 text-sm sm:px-6" aria-label="Разделы дашборда">
        <TabLink href="/admin" active={tab === "product"}>Продукт</TabLink>
        <TabLink href="/admin?tab=costs" active={tab === "costs"}>Расходы на LLM</TabLink>
        {/* Обычная ссылка, а не Link: полная загрузка выгружает стили кита, иначе они
            остались бы на ленте (печать ленты печатала бы пустую страницу). */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="ml-auto text-xs text-muted-foreground hover:text-foreground">← В ленту</a>
      </nav>
      {tab === "costs" ? <CostsView costs={await loadCosts()} /> : <ProductDashboard />}
    </>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 ${active ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </Link>
  );
}
