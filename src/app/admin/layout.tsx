import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isOwner } from "@/lib/analytics/owner";
import "./admin.css";

export const metadata: Metadata = { title: "Reporta · дашборд", robots: { index: false, follow: false } };

/**
 * Дашборд видит только владелец. Чужому — 404, а не «нет доступа»:
 * адрес ничего не должен сообщать тому, кому он не предназначен.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isOwner())) notFound();
  return <div className="launch-kit min-h-svh">{children}</div>;
}
