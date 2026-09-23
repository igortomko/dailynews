"use client";

import dynamic from "next/dynamic";
import { TooltipProvider } from "@launch-kit/components/ui/tooltip";
import { DashboardSkeleton } from "@launch-kit/components/dashboard-skeleton";

// Кит — клиентское приложение (Vite в исходнике): он сам ходит в /api/config
// и /api/dataset, поэтому на сервере его рисовать нечем.
const Dashboard = dynamic(() => import("@launch-kit/App"), {
  ssr: false,
  // Тот же скелет, что кит рисует, пока ждёт данные: иначе экран сменил бы
  // одно ожидание на другое.
  loading: () => <DashboardSkeleton />,
});

export function ProductDashboard() {
  return <TooltipProvider><Dashboard /></TooltipProvider>;
}
