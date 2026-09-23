import { useState } from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Bot, FileText, Sparkles } from "lucide-react";
import { Card } from "@launch-kit/components/ui/card";
import { Button } from "@launch-kit/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@launch-kit/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@launch-kit/components/ui/chart";
import { Empty, num } from "@launch-kit/components/dashboard-widgets";
import type { DashboardData } from "@launch-kit/lib/types";

const colors = ["#8b909f", "#658fff", "#ea8b71", "#ab91d9", "#68b9ad"];
const categories = [
  { id: "answer", view: "ai_answers", label: "AI answers" },
  { id: "indexing", view: "indexing", label: "Indexing" },
  { id: "training", view: "training", label: "Training" },
];
export function ReferenceCrawlers({
  report,
  available,
  views,
  filtered,
}: {
  report: DashboardData;
  available: boolean;
  views: string[];
  filtered: boolean;
}) {
  const [category, setCategory] = useState("answer");
  const [pages, setPages] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const tabs = categories.filter((item) => views.includes(item.view));
  const current = tabs.some((item) => item.id === category)
    ? category
    : tabs[0]?.id;
  const rows = report.crawlers.filter(
    (row) => !current || row.category === current,
  );
  const series = report.crawlerSeries
    .filter((row) => !current || row.category === current)
    .map((row, index) => ({
      ...row,
      id: `c${index}`,
      color: colors[index % colors.length],
    }));
  const selected = series.some((row) => row.key === focus) ? focus : null;
  const data = report.crawlerTrend.map((row) => ({
    date: row.date,
    ...Object.fromEntries(
      series.map((item) => [item.id, row.values[item.key] ?? 0]),
    ),
  }));
  const config = Object.fromEntries(
    series.map((row) => [row.id, { label: row.name, color: row.color }]),
  );
  return (
    <Card
      className="reference-crawlers min-w-0 gap-0 overflow-hidden rounded-[22px] border-[#e9e9e9] bg-white py-0 shadow-[0_2px_3px_#00000004]"
      aria-label="AI и crawlers"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 p-3">
        {tabs.length > 0 ? (
          <Tabs
            value={current}
            onValueChange={(value) => {
              setCategory(value);
              setFocus(null);
            }}
            className="min-w-0 max-w-full"
          >
            <TabsList className="max-w-full overflow-x-auto">
              {tabs.map((item) => (
                <TabsTrigger value={item.id} key={item.id}>
                  <Sparkles className="size-3" />
                  {item.label}
                  <span className="ml-1 text-[11px] text-[#aaa]">
                    {!available || filtered ? "—" : num(
                      report.crawlers
                        .filter((row) => row.category === item.id)
                        .reduce((sum, row) => sum + row.count, 0),
                    )}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <span className="px-2 text-sm">Crawlers</span>
        )}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-dashed text-xs"
            onClick={() => {
              setFocus(null);
              setPages(false);
            }}
          >
            <Bot className="size-3.5" />
            Crawlers
          </Button>
          {views.includes("requested_pages") && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Страницы crawlers"
              aria-pressed={pages}
              onClick={() => setPages(!pages)}
            >
              <FileText className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      {!available ? (
        <Empty title="Серверные логи не подключены" />
      ) : filtered ? (
        <Empty title="Недоступно для сегмента пользователей">
          Запросы ботов не связаны с identity пользователей. Сбросьте фильтр,
          чтобы увидеть их отдельно.
        </Empty>
      ) : rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="grid min-w-0 gap-3 px-3 pb-3 md:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
          <ChartContainer
            config={config}
            className="h-[285px] w-full md:h-[320px]"
            aria-label="Запросы crawlers по дням"
          >
            <LineChart
              data={data}
              accessibilityLayer
              margin={{ top: 18, right: 10, left: 0, bottom: 6 }}
            >
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 5"
                stroke="#e9e9e9"
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                minTickGap={30}
                tickFormatter={(value) =>
                  new Date(String(value)).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  })
                }
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={32}
                allowDecimals={false}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => String(value).slice(0, 10)}
                  />
                }
              />
              {series.map((item) => (
                <Line
                  key={item.id}
                  dataKey={item.id}
                  type="monotone"
                  stroke={item.color}
                  strokeWidth={1.7}
                  strokeOpacity={
                    selected && selected !== item.key?.toString() ? 0.12 : 1
                  }
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
          <div className="min-w-0 rounded-[18px] border p-2">
            {rows.map((row, index) => {
              const key = `${row.category}:${row.name}`;
              return (
                <div key={key}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm ${selected === key ? "bg-[#edf1f6]" : "hover:bg-[#f6f6f6]"}`}
                    onClick={() => setFocus(selected === key ? null : key)}
                    aria-pressed={selected === key}
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{ background: colors[index % colors.length] }}
                    />
                    <span className="truncate">{row.name}</span>
                    <span className="ml-auto tabular-nums">
                      {num(row.count)}
                    </span>
                  </button>
                  {views.includes("requested_pages") && pages &&
                    row.routes.map((route) => (
                      <div
                        key={route.key}
                        className="mx-3 flex gap-2 border-t py-2 text-[11px] text-muted-foreground"
                      >
                        <span className="truncate">{route.key}</span>
                        <span className="ml-auto">{num(route.count)}</span>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="px-5 pb-3 text-[10px] text-[#999]">
        Запросы серверных ботов · не посетители и не подтверждение цитирования в
        AI.
      </p>
    </Card>
  );
}
