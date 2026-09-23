"use client";

import dynamic from "next/dynamic";
import { TooltipProvider } from "@launch-kit/components/ui/tooltip";

// Кит — клиентское приложение (Vite в исходнике): он сам ходит в /api/config
// и /api/dataset, поэтому на сервере его рисовать нечем.
const Dashboard = dynamic(() => import("@launch-kit/App"), {
  ssr: false,
  loading: () => <div className="p-8 text-sm text-muted-foreground" role="status">Загрузка аналитики…</div>,
});

export function ProductDashboard() {
  return <TooltipProvider><Dashboard /></TooltipProvider>;
}
