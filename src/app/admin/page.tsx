import { ProductDashboard } from "./product";

export const dynamic = "force-dynamic";

/**
 * Продукт, расходы и ссылки рисует Launch Kit целиком — вкладками над
 * дашбордом. Здесь только возврат в ленту.
 */
export default function AdminPage() {
  return (
    <>
      <nav className="mx-auto flex max-w-[1160px] justify-end px-3 pt-4 sm:px-6" aria-label="Выход из дашборда">
        {/* Обычная ссылка, а не Link: полная загрузка выгружает стили кита, иначе они
            остались бы на ленте (печать ленты печатала бы пустую страницу). */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="text-xs text-muted-foreground hover:text-foreground">← В ленту</a>
      </nav>
      <ProductDashboard />
    </>
  );
}
