import { useState, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ArrowDownWideNarrow, ArrowUpRight, Info, Search } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@launch-kit/components/ui/card";
import { Button } from "@launch-kit/components/ui/button";
import { Badge } from "@launch-kit/components/ui/badge";
import { Input } from "@launch-kit/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@launch-kit/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@launch-kit/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@launch-kit/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@launch-kit/components/ui/chart";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@launch-kit/components/ui/tooltip";
import { formatAmount } from "@launch-kit/lib/data";
import type { BreakdownRow, DashboardData, Dimension } from "@launch-kit/lib/types";

export const num = (value: number | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(
        value,
      );
export const pct = (value: number | null | undefined) =>
  value == null ? "—" : `${num(value)}%`;
export const label = (value: string) =>
  ({
    Unknown: "Не определён",
    unknown: "Не определён",
    direct: "Прямой",
    organic: "Органика",
    referral: "Рекомендации",
    email: "Email",
    social: "Соцсети",
    paid: "Реклама",
    "(none)": "Без метки",
  })[value] ?? value;
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`soft-card min-w-0 gap-4 py-5 ${className}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 px-5">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {description && (
            <CardDescription className="text-xs leading-relaxed">
              {description}
            </CardDescription>
          )}
        </div>
        {action}
      </CardHeader>
      <CardContent className="min-w-0 px-5">{children}</CardContent>
    </Card>
  );
}
export function Empty({
  title = "Пока нет данных",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center">
      <Info className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
        {children ?? "Измените фильтры или передайте первые события продукта."}
      </p>
    </div>
  );
}
export function Metric({
  title,
  value,
  note,
  accent = false,
}: {
  title: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border p-4 ${accent ? "border-[#dbe5d3] bg-[#e7f4ff]" : "bg-card"}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{title}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button aria-label={`Определение: ${title}`}>
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{note}</TooltipContent>
        </Tooltip>
      </div>
      <p className="tabular truncate text-[27px] font-semibold tracking-tight">
        {value}
      </p>
      <p className="mt-2 line-clamp-2 min-h-8 text-[11px] leading-4 text-muted-foreground">
        {note}
      </p>
    </div>
  );
}
const config = {
  visitors: { label: "Посетители", color: "var(--chart-1)" },
  activated: { label: "Первый результат", color: "#8395b2" },
  revenue: { label: "Оплаты − возвраты", color: "var(--chart-2)" },
  pageviews: { label: "Просмотры", color: "var(--chart-1)" },
  conversionRate: { label: "Конверсия, %", color: "var(--chart-2)" },
  revenuePerVisitor: { label: "Выручка / посетитель", color: "var(--chart-2)" },
  bounceRate: { label: "Отказы, %", color: "#8f9dba" },
  sessionSeconds: { label: "Время, с", color: "#8f9dba" },
  returningVisitors: { label: "Вернувшиеся", color: "var(--chart-1)" },
} satisfies ChartConfig;
export function Trend({
  report,
  compact = false,
}: {
  report: DashboardData;
  compact?: boolean;
}) {
  const [metric, setMetric] = useState("visitors");
  const data = report.trend.map((row) => ({
    ...row,
    revenue:
      row.revenueMinor === null
        ? null
        : row.revenueMinor / 10 ** report.currencyExponent,
    revenuePerVisitor:
      row.revenuePerVisitorMinor === null
        ? null
        : row.revenuePerVisitorMinor / 10 ** report.currencyExponent,
  }));
  const current = compact ? "revenue" : metric;
  return (
    <Panel
      title={
        compact
          ? `Оплаты − возвраты · ${report.currency}`
          : "Динамика результата"
      }
      description={
        compact ? undefined : "UTC · последний день может быть неполным"
      }
      action={
        !compact && (
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger
              aria-label="Метрика графика"
              className="h-8 max-w-48 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(config).map(([key, item]) => (
                <SelectItem key={key} value={key}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    >
      {data.every((row) => row[current as keyof typeof row] == null) ? (
        <Empty title="Метрика недоступна">
          Подключите необходимые события и проверьте покрытие в разделе
          «Состояние данных».
        </Empty>
      ) : (
        <ChartContainer
          config={config}
          className={`${compact ? "h-[155px]" : "h-[245px]"} w-full`}
        >
          <AreaChart
            accessibilityLayer
            data={data}
            margin={{ left: 2, right: 12, top: 16, bottom: 0 }}
          >
            <defs>
              <linearGradient
                id={`fill-${current}-${compact}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={`var(--color-${current})`}
                  stopOpacity={0.22}
                />
                <stop
                  offset="100%"
                  stopColor={`var(--color-${current})`}
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 5" />
            <XAxis
              dataKey="date"
              tickFormatter={(date) =>
                new Date(String(date)).toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                })
              }
              axisLine={false}
              tickLine={false}
              minTickGap={38}
              tickMargin={12}
            />
            <YAxis
              width={42}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => num(Number(value))}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              dataKey={current}
              type="monotone"
              strokeWidth={2.5}
              stroke={`var(--color-${current})`}
              fill={`url(#fill-${current}-${compact})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
      {!compact && (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Точные значения</summary>
          <div className="mt-2 max-h-52 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата UTC</TableHead>
                  <TableHead>Посетители</TableHead>
                  <TableHead>Результат</TableHead>
                  <TableHead>{report.currency}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.date}>
                    <TableCell>{row.date.slice(0, 10)}</TableCell>
                    <TableCell>{num(row.visitors)}</TableCell>
                    <TableCell>{num(row.activated)}</TableCell>
                    <TableCell>
                      {formatAmount(
                        row.revenueMinor,
                        report.currency,
                        report.currencyExponent,
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      )}
    </Panel>
  );
}
export function Breakdown({
  title,
  report,
  dimensions,
  onFilter,
  compact = false,
}: {
  title: string;
  report: DashboardData;
  dimensions: { key: Dimension; title: string }[];
  onFilter?: (dimension: Dimension, value: string) => void;
  compact?: boolean;
}) {
  const [choice, setChoice] = useState(dimensions[0]?.key);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<
    "visitors" | "revenueMinor" | "activated" | "conversionRate"
  >("visitors");
  const [page, setPage] = useState(0);
  if (!dimensions.length) return null;
  const dimension = dimensions.some((item) => item.key === choice)
    ? choice
    : dimensions[0].key;
  const rows = [...report.breakdowns[dimension]]
    .filter((row) => row.key.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1));
  const pageSize = compact ? 5 : 8;
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / pageSize) - 1),
  );
  const visible = rows.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const max = Math.max(...rows.map((row) => row.visitors), 1);
  const sortButton = (key: typeof sort, title: string) => (
    <button
      className="inline-flex items-center gap-1 whitespace-nowrap text-[11px]"
      onClick={() => setSort(key)}
    >
      {title}
      {sort === key && <ArrowDownWideNarrow className="size-3" />}
    </button>
  );
  return (
    <Panel
      title={title}
      description={
        compact
          ? undefined
          : "Атрибуция по первому входу · CR зрелой когорты за 7 дней"
      }
      action={<Badge variant="secondary">{rows.length}</Badge>}
    >
      {dimensions.length > 1 && (
        <Tabs
          value={dimension}
          onValueChange={(value) => {
            setChoice(value as Dimension);
            setPage(0);
          }}
          className="mb-3"
        >
          <TabsList className="max-w-full overflow-x-auto">
            {dimensions.map((item) => (
              <TabsTrigger key={item.key} value={item.key} className="text-xs">
                {item.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {!compact && (
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            aria-label={`Поиск: ${title}`}
            className="h-8 pl-8 text-xs"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Поиск"
          />
        </div>
      )}
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-full pl-0 text-[11px]">
                  {dimensions.find((item) => item.key === dimension)?.title}
                </TableHead>
                <TableHead className="text-right">
                  {sortButton("visitors", "Люди")}
                </TableHead>
                {!compact && (
                  <TableHead className="text-right">
                    {sortButton("activated", "Результат")}
                  </TableHead>
                )}
                <TableHead className="pr-0 text-right">
                  {sortButton("revenueMinor", report.currency)}
                </TableHead>
                {!compact && (
                  <TableHead className="text-right">
                    {sortButton("conversionRate", "CR 7д")}
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row: BreakdownRow) => (
                <TableRow key={row.key}>
                  <TableCell className="relative max-w-[240px] py-2.5 pl-0">
                    <div
                      className="absolute inset-y-2 left-0 rounded-sm bg-[#e7f4ff]"
                      style={{ width: `${(row.visitors / max) * 90}%` }}
                    />
                    <button
                      className="relative flex max-w-full items-center gap-2 truncate py-1 pr-2 text-xs font-medium text-left disabled:cursor-default"
                      disabled={
                        !onFilter ||
                        !["source", "country", "device", "campaign"].includes(
                          dimension,
                        )
                      }
                      onClick={() => onFilter?.(dimension, row.key)}
                      title={label(row.key)}
                    >
                      {label(row.key)}
                      {onFilter &&
                        ["source", "country", "device", "campaign"].includes(
                          dimension,
                        ) && (
                          <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
                        )}
                    </button>
                  </TableCell>
                  <TableCell className="tabular text-right text-xs">
                    {num(row.visitors)}
                  </TableCell>
                  {!compact && (
                    <TableCell className="tabular text-right text-xs">
                      {num(row.activated)}
                    </TableCell>
                  )}
                  <TableCell className="tabular pr-0 text-right text-xs">
                    {formatAmount(
                      row.revenueMinor,
                      report.currency,
                      report.currencyExponent,
                    )}
                  </TableCell>
                  {!compact && (
                    <TableCell className="tabular text-right text-xs">
                      {pct(row.conversionRate)}
                      <span
                        className="ml-1 text-[9px] text-muted-foreground"
                        title="Зрелых входов в когорте"
                      >
                        n={row.cohortEligible ?? "—"}
                      </span>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!compact && rows.length > pageSize && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {safePage * pageSize + 1}–
                {Math.min((safePage + 1) * pageSize, rows.length)} из{" "}
                {rows.length}
              </span>
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Назад: ${title}`}
                  disabled={safePage === 0}
                  onClick={() => setPage(safePage - 1)}
                >
                  ←
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Далее: ${title}`}
                  disabled={(safePage + 1) * pageSize >= rows.length}
                  onClick={() => setPage(safePage + 1)}
                >
                  →
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
export function Funnel({
  report,
  firstValueLabel,
}: {
  report: DashboardData;
  firstValueLabel: string;
}) {
  const labels: Record<string, string> = {
    entry: "Вход в продукт",
    product_entered: "Вход в продукт",
    first_value: firstValueLabel,
    checkout: "Checkout",
    checkout_started: "Checkout",
    paid: "Оплата",
    payment_succeeded: "Оплата",
  };
  return (
    <Panel
      title="Где теряется результат"
      description={`Воронка 7 дней · ${num(report.funnelCohort.eligible)} зрелых входов · ${num(report.funnelCohort.immature)} ещё наблюдаем`}
    >
      <div className="space-y-5">
        {report.funnel.map((row, i) => (
          <div key={row.key}>
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <span>
                <span className="mr-2 text-muted-foreground">0{i + 1}</span>
                {labels[row.key] ?? row.label}
              </span>
              <span className="tabular font-semibold">
                {num(row.count)}{" "}
                <span className="ml-2 font-normal text-muted-foreground">
                  {pct(row.conversionRate)}
                </span>
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{
                  width: `${row.conversionRate ?? 0}%`,
                  opacity: 1 - i * 0.13,
                }}
              />
            </div>
            {i > 0 && row.dropoffRate !== null && (
              <p className="mt-1 text-right text-[10px] text-muted-foreground">
                Потеря на шаге {pct(row.dropoffRate)}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Только первые входы с полным окном наблюдения. Оплата следует за первым
        результатом; для pay-first продукта порядок нужно адаптировать в
        контракте.
      </p>
    </Panel>
  );
}

export function ChannelShare({ report }: { report: DashboardData }) {
  const rows = report.breakdowns.medium;
  const total = rows.reduce((sum, row) => sum + row.visitors, 0);
  const colors = [
    "#72925c",
    "#a7bd8f",
    "#ed9d72",
    "#8f9dba",
    "#d7cbb5",
    "#b3c3c1",
  ];
  return (
    <Panel
      title="Доли каналов"
      description="Посетители по первому наблюдаемому источнику"
    >
      {total === 0 ? (
        <Empty />
      ) : (
        <>
          <div className="flex h-8 overflow-hidden rounded-lg">
            {rows.map((row, index) => (
              <div
                key={row.key}
                style={{
                  width: `${(row.visitors / total) * 100}%`,
                  background: colors[index % colors.length],
                }}
                title={`${label(row.key)}: ${pct((row.visitors / total) * 100)}`}
              />
            ))}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {rows.map((row, index) => (
              <div key={row.key} className="flex items-center gap-2 text-xs">
                <span
                  className="size-2.5 rounded-sm"
                  style={{ background: colors[index % colors.length] }}
                />
                <span>{label(row.key)}</span>
                <span className="ml-auto tabular text-muted-foreground">
                  {pct((row.visitors / total) * 100)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
