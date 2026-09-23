"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@launch-kit/components/ui/chart";

export function CostsChart({ series, stages, labels }: {
  series: Record<string, number | string>[];
  stages: string[];
  labels: Record<string, string>;
}) {
  const config: ChartConfig = Object.fromEntries(
    stages.map((stage, i) => [stage, { label: labels[stage] ?? stage, color: i < 5 ? `var(--chart-${i + 1})` : "#c8c8c8" }]),
  );
  return (
    <ChartContainer config={config} className="h-64 w-full">
      <BarChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={(d: string) => d.slice(5)} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => (
          <span className="flex w-full justify-between gap-4"><span>{config[String(name)]?.label}</span><span className="tabular">${Number(value).toFixed(4)}</span></span>
        )} />} />
        <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
        {stages.map((stage) => <Bar key={stage} dataKey={stage} stackId="usd" fill={`var(--color-${stage})`} />)}
      </BarChart>
    </ChartContainer>
  );
}
