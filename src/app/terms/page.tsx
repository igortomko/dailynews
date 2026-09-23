import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Terms of Service · Reporta" };

export default function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  return <LegalPage kind="terms" searchParams={searchParams} />;
}
