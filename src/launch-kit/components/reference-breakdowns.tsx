import { useState } from "react";
import { Pie, PieChart } from "recharts";
import {
  ArrowDownWideNarrow,
  CircleDot,
  Compass,
  Flame,
  Globe2,
  Handshake,
  Link2,
  Mail,
  Monitor,
  MousePointer2,
  Play,
  Scan,
  Search,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { Card } from "@launch-kit/components/ui/card";
import { Button } from "@launch-kit/components/ui/button";
import { Input } from "@launch-kit/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@launch-kit/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@launch-kit/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@launch-kit/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@launch-kit/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@launch-kit/components/ui/tooltip";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@launch-kit/components/ui/chart";
import {
  Breakdown,
  Empty,
  label,
  num,
  pct,
} from "@launch-kit/components/dashboard-widgets";
import { formatAmount } from "@launch-kit/lib/data";
import type { BreakdownRow, DashboardData, Dimension } from "@launch-kit/lib/types";

export interface ReferenceBreakdownTab {
  id: string;
  label: string;
  dimension: Dimension;
  kind?: "donut" | "list";
}

const metrics = {
  visitors: "Посетители",
  revenueMinor: "Выручка",
  conversionRate: "Конверсия",
  activated: "Результат",
} as const;
type Metric = keyof typeof metrics;
const filterDimensions: readonly Dimension[] = [
  "source",
  "country",
  "device",
  "campaign",
];
const blues = [
  "#dff1ff",
  "#c7e7ff",
  "#a9d9ff",
  "#88c9ff",
  "#66b5fb",
  "#4b9dea",
  "#3485d4",
  "#2870b7",
  "#205c97",
  "#174875",
];
const compact = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

export function DimensionIcon({
  dimension,
  value,
}: {
  dimension: Dimension;
  value: string;
}) {
  const normalized = value.toLowerCase();
  if (dimension === "country") {
    const codes: Record<string, string> = {
      "united states": "US",
      "united kingdom": "GB",
      canada: "CA",
      france: "FR",
      portugal: "PT",
      brazil: "BR",
      germany: "DE",
      spain: "ES",
      australia: "AU",
      netherlands: "NL",
      singapore: "SG",
      turkey: "TR",
      denmark: "DK",
      argentina: "AR",
      morocco: "MA",
      italy: "IT",
      india: "IN",
      japan: "JP",
      mexico: "MX",
      poland: "PL",
      sweden: "SE",
      ireland: "IE",
      uk: "GB",
    };
    const code =
      codes[normalized] ??
      (/^[A-Z]{2}$/i.test(value) ? value.toUpperCase() : undefined);
    if (code)
      return (
        <span
          aria-hidden="true"
          className="inline-flex w-4 shrink-0 items-center justify-center text-sm leading-none"
        >
          {[...code]
            .map((letter) =>
              String.fromCodePoint(127397 + letter.charCodeAt(0)),
            )
            .join("")}
        </span>
      );
  }
  if (dimension === "source" && normalized === "x")
    return (
      <span
        aria-hidden="true"
        className="grid size-4 shrink-0 place-items-center rounded-[2px] bg-[#222] text-[11px] font-medium text-white"
      >
        X
      </span>
    );
  if (dimension === "source" && normalized === "youtube")
    return (
      <span
        aria-hidden="true"
        className="grid h-3 w-4 shrink-0 place-items-center rounded-[3px] bg-[#f04449]"
      >
        <Play className="size-2 fill-white text-white" />
      </span>
    );
  if (dimension === "source" && normalized === "google")
    return (
      <span
        aria-hidden="true"
        className="w-4 shrink-0 text-center font-semibold text-[#4285f4]"
      >
        G
      </span>
    );
  const Icon =
    dimension === "browser"
      ? normalized.includes("chrome")
        ? CircleDot
        : normalized.includes("safari")
          ? Compass
          : normalized.includes("firefox")
            ? Flame
            : Globe2
      : dimension === "device"
        ? normalized.includes("mobile") || normalized.includes("tablet")
          ? Smartphone
          : Monitor
        : dimension === "source"
          ? normalized.includes("chatgpt") ||
            normalized.includes("claude") ||
            normalized.includes("perplexity")
            ? Sparkles
            : normalized.includes("newsletter") || normalized.includes("email")
              ? Mail
              : normalized.includes("partner")
                ? Handshake
                : normalized.includes("direct")
                  ? MousePointer2
                  : Link2
          : dimension === "route" || dimension === "hostname"
            ? Link2
            : dimension === "term"
              ? Search
              : Globe2;
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-[#8093a5]" />;
}

export function ReferenceBreakdownCard({
  title,
  report,
  tabs,
  onFilter,
  initialTab,
}: {
  title: string;
  report: DashboardData;
  tabs: ReferenceBreakdownTab[];
  onFilter?: (dimension: Dimension, value: string) => void;
  initialTab?: string;
}) {
  const [choice, setChoice] = useState(initialTab ?? tabs[0]?.id);
  const [selectedMetric, setMetric] = useState<Metric>("visitors");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsSearch, setDetailsSearch] = useState("");
  const [detailsPage, setDetailsPage] = useState(0);
  const tab = tabs.find((item) => item.id === choice) ?? tabs[0];
  if (!tab) return null;

  const moneyAvailable = report.overview.payers !== null;
  const metric: Metric = !moneyAvailable && (selectedMetric === "revenueMinor" || selectedMetric === "conversionRate") ? "visitors" : selectedMetric;
  const metricLabels = {
    ...metrics,
    visitors: report.measurement?.audienceLabel ?? metrics.visitors,
    activated: report.measurement?.activationLabel ?? metrics.activated,
  };
  const rows = [...report.breakdowns[tab.dimension]].sort((a, b) => {
    if (a[metric] == null) return b[metric] == null ? 0 : 1;
    if (b[metric] == null) return -1;
    return b[metric] - a[metric];
  });
  const max = Math.max(...rows.map((row) => Math.abs(row[metric] ?? 0)), 1);
  const money = (value: number | null) =>
    formatAmount(value, report.currency, report.currencyExponent);
  const valueLabel = (value: number | null) => {
    if (value === null) return "—";
    if (metric === "revenueMinor") return money(value);
    if (metric === "conversionRate") return pct(value);
    return compact(value);
  };
  const filterable = Boolean(
    onFilter && filterDimensions.includes(tab.dimension),
  );
  const chooseRow = (row: BreakdownRow) => {
    if (filterable) onFilter?.(tab.dimension, row.key);
    else setDetailsOpen(true);
  };
  const hasValues = rows.some((row) => row[metric] !== null);
  const isDonut =
    tab.kind === "donut" &&
    metric !== "conversionRate" &&
    rows.every((row) => (row[metric] ?? 0) >= 0);
  const donutRows = rows.slice(0, 9).map((row, index) => ({
    name: label(row.key),
    value: row[metric] ?? 0,
    fill: blues[index],
  }));
  if (rows.length > 9)
    donutRows.push({
      name: "Другие",
      value: rows.slice(9).reduce((sum, row) => sum + (row[metric] ?? 0), 0),
      fill: blues[9],
    });
  const total = donutRows.reduce((sum, row) => sum + row.value, 0);
  const detailRows = rows.filter((row) => label(row.key).toLowerCase().includes(detailsSearch.toLowerCase()));
  const pageSize = 20;
  const safePage = Math.min(detailsPage, Math.max(0, Math.ceil(detailRows.length / pageSize) - 1));

  return (
    <Card
      aria-label={title}
      className="reference-breakdown min-w-0 gap-0 overflow-hidden rounded-3xl border-border/75 bg-white py-0 shadow-sm"
    >
      <h2 className="sr-only">{title}</h2>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 pb-3 pt-3">
        <Tabs
          value={tab.id}
          onValueChange={setChoice}
          className="min-w-0 max-w-full"
        >
          <TabsList
            aria-label={title}
            className="h-9 max-w-full justify-start overflow-x-auto rounded-full bg-[#f8f8f8] p-1"
          >
            {tabs.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className="h-7 shrink-0 rounded-full px-2.5 text-xs font-medium text-muted-foreground data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          value={metric}
          onValueChange={(value) => setMetric(value as Metric)}
        >
          <SelectTrigger
            aria-label={`Метрика: ${title}`}
            className="h-8 w-auto shrink-0 gap-1.5 border-0 bg-transparent px-1 text-xs shadow-none [&>svg:last-child]:hidden"
          >
            <SelectValue />
            <ArrowDownWideNarrow className="size-3.5 text-muted-foreground" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(metricLabels).filter(([key]) => moneyAvailable || !["revenueMinor", "conversionRate"].includes(key)).map(([key, name]) => (
              <SelectItem key={key} value={key}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={`${report.measurement && rows.length <= 4 && !isDonut ? "min-h-0" : "min-h-[342px]"} px-3`}>
        {rows.length === 0 ? (
          <Empty />
        ) : !hasValues ? (
          <Empty title="Метрика пока недоступна">
            Подключите источник данных для этой метрики.
          </Empty>
        ) : isDonut && total > 0 ? (
          <div>
            <ChartContainer
              config={{ value: { label: metricLabels[metric], color: blues[3] } }}
              className="mx-auto h-[250px] w-full max-w-[360px]"
              aria-label={`${tab.label}: ${metricLabels[metric]}`}
            >
              <PieChart accessibilityLayer>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-4">
                          <span>{String(name)}</span>
                          <strong>{valueLabel(Number(value))}</strong>
                        </div>
                      )}
                    />
                  }
                />
                <Pie
                  data={donutRows}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="58%"
                  outerRadius="87%"
                  paddingAngle={2}
                  stroke="white"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </PieChart>
            </ChartContainer>
            <div className="grid grid-cols-2 gap-x-5 gap-y-2 px-3 pb-3">
              {donutRows.map((row) => (
                <div
                  key={row.name}
                  className="flex min-w-0 items-center gap-2 text-xs"
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: row.fill }}
                  />
                  <span className="truncate">{row.name}</span>
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {pct((row.value / total) * 100)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {rows.slice(0, 10).map((row) => (
              <Tooltip key={row.key}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => chooseRow(row)}
                    aria-label={`${label(row.key)}: ${valueLabel(row[metric])}${filterable ? ", фильтровать" : ", подробнее"}`}
                    className="group relative flex h-[30px] w-full min-w-0 items-center justify-between gap-4 overflow-hidden rounded-r-md px-2 text-left text-sm outline-offset-2 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 rounded-r-md transition-[width] duration-200"
                      style={{
                        width: `${(Math.abs(row[metric] ?? 0) / max) * 100}%`,
                        backgroundColor:
                          metric === "revenueMinor" ? "#ffdfd4" : "#e7f4ff",
                      }}
                    />
                    <span className="relative flex min-w-0 items-center gap-2 font-medium">
                      <DimensionIcon
                        dimension={tab.dimension}
                        value={row.key}
                      />
                      <span className="truncate">{label(row.key)}</span>
                    </span>
                    <span className="relative shrink-0 tabular-nums font-medium">
                      {valueLabel(row[metric])}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-80 space-y-1 p-3">
                  <p className="mb-2 break-all font-medium">{label(row.key)}</p>
                  <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs">
                    <dt>{metricLabels.visitors}</dt>
                    <dd className="text-right">{num(row.visitors)}</dd>
                    <dt>{metricLabels.activated}</dt>
                    <dd className="text-right">{num(row.activated)}</dd>
                    {moneyAvailable && <><dt>Оплаты − возвраты</dt>
                    <dd className="text-right">{money(row.revenueMinor)}</dd>
                    <dt>Конверсия 7 дней</dt>
                    <dd className="text-right">{pct(row.conversionRate)}</dd>
                    <dt>Зрелых входов</dt>
                    <dd className="text-right">{num(row.cohortEligible)}</dd></>}
                  </dl>
                  <p className="pt-2 text-[10px] opacity-70">
                    {filterable
                      ? "Нажмите, чтобы отфильтровать весь дашборд"
                      : "Нажмите, чтобы открыть подробности"}
                  </p>
                </TooltipContent>
              </Tooltip>
            ))}
            {tab.kind === "donut" &&
              (metric === "conversionRate" ||
                rows.some((row) => (row[metric] ?? 0) < 0)) && (
                <p className="px-2 pt-2 text-[10px] text-muted-foreground">
                  {metric === "conversionRate"
                    ? "Конверсии сравниваются отдельно: они не складываются в доли."
                    : "Отрицательная выручка показана в списке."}
                </p>
              )}
          </div>
        )}
      </div>
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            className="mx-auto my-3 h-7 gap-1.5 rounded-lg text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            <Scan className="size-3.5" />
            Подробнее<span className="sr-only">: {title}</span>
          </Button>
        </SheetTrigger>
        <SheetContent
          side="top"
          className="gap-0 overflow-hidden rounded-2xl border p-0 sm:max-w-none"
          style={{
            top: "50%",
            left: "50%",
            right: "auto",
            transform: "translate(-50%, -50%)",
            width: "min(720px, calc(100vw - 24px))",
            maxHeight: "85dvh",
          }}
        >
          <SheetHeader className="border-b px-5 py-4 pr-12">
            <SheetTitle>{tab.label}</SheetTitle>
            <SheetDescription className="text-xs">
              {moneyAvailable
                ? "Первый источник · конверсия зрелой когорты за 7 дней."
                : "Первый источник · активность и первые результаты по дате события. Платёжные данные недоступны."}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto [&_[data-slot=card]]:rounded-none [&_[data-slot=card]]:border-0 [&_[data-slot=card]]:shadow-none [&_[data-slot=card-header]]:hidden">
            {!moneyAvailable ? (
              <div className="space-y-3 p-5">
                <Input
                  aria-label={`Поиск: ${tab.label}`}
                  placeholder="Поиск"
                  value={detailsSearch}
                  onChange={(event) => { setDetailsSearch(event.target.value); setDetailsPage(0); }}
                  className="h-8 text-xs"
                />
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{tab.label}</TableHead>
                    <TableHead className="text-right">{metricLabels.visitors}</TableHead>
                    <TableHead className="text-right">{metricLabels.activated}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {detailRows.slice(safePage * pageSize, (safePage + 1) * pageSize).map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>
                          {filterable ? <button className="text-left underline-offset-4 hover:underline" onClick={() => { onFilter?.(tab.dimension, row.key); setDetailsOpen(false); }}>{label(row.key)}</button> : label(row.key)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{num(row.visitors)}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(row.activated)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!detailRows.length && <Empty title="Ничего не найдено" />}
                {detailRows.length > pageSize && <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, detailRows.length)} из {detailRows.length}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={safePage === 0} onClick={() => setDetailsPage(safePage - 1)} aria-label="Предыдущие строки">←</Button>
                    <Button size="sm" variant="ghost" disabled={(safePage + 1) * pageSize >= detailRows.length} onClick={() => setDetailsPage(safePage + 1)} aria-label="Следующие строки">→</Button>
                  </div>
                </div>}
              </div>
            ) : <Breakdown
              key={tab.id}
              title={tab.label}
              report={report}
              dimensions={[{ key: tab.dimension, title: tab.label }]}
              onFilter={
                onFilter
                  ? (dimension, value) => {
                      onFilter(dimension, value);
                      setDetailsOpen(false);
                    }
                  : undefined
              }
            />}
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
