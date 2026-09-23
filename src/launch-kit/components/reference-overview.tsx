import { useId, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDown, ArrowUp, ChartNoAxesCombined } from "lucide-react";
import { Card } from "@launch-kit/components/ui/card";
import { Button } from "@launch-kit/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@launch-kit/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@launch-kit/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@launch-kit/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@launch-kit/components/ui/table";
import { formatAmount } from "@launch-kit/lib/data";
import type { DashboardData } from "@launch-kit/lib/types";

type MetricId =
  | "visitors"
  | "revenue"
  | "conversion"
  | "revenue_per_visitor"
  | "bounce"
  | "session_time"
  | "activation"
  | "pageviews"
  | "pages_per_visitor"
  | "new_returning"
  | "returning_share";
type MetricFormat = "number" | "money" | "percent" | "duration";
type ChartMode = MetricId | "combined";
type TrendRow = DashboardData["trend"][number];

interface MetricDefinition {
  id: MetricId;
  title: string;
  format: MetricFormat;
  color: string;
  definition: string;
  overview: (report: DashboardData) => number | null;
  daily: (row: TrendRow, report: DashboardData) => number | null;
}

const BLUE = "#89c8ff";
const SALMON = "#e88970";
const number = (value: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
const ratio = (numerator: number | null, denominator: number) =>
  numerator === null || denominator === 0 ? null : numerator / denominator;
const dayLabel = (date: string) =>
  new Date(date).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const duration = (value: number) => {
  const seconds = Math.round(value);
  return seconds < 60
    ? `${seconds} с`
    : `${Math.floor(seconds / 60)}м ${seconds % 60}с`;
};

const metrics: MetricDefinition[] = [
  {
    id: "visitors",
    title: "Посетители",
    format: "number",
    color: BLUE,
    definition:
      "Уникальные посетители за период. Дневные значения нельзя складывать: один человек может вернуться в другой день.",
    overview: (r) => r.overview.visitors,
    daily: (r) => r.visitors,
  },
  {
    id: "revenue",
    title: "Выручка",
    format: "money",
    color: SALMON,
    definition:
      "Подтверждённые оплаты минус возвраты за период, в выбранной валюте. Это не прибыль и не MRR.",
    overview: (r) => r.overview.revenueMinor,
    daily: (r) => r.revenueMinor,
  },
  {
    id: "conversion",
    title: "Конверсия",
    format: "percent",
    color: SALMON,
    definition:
      "Доля участников входной когорты, последовательно получивших первый результат и оплативших в течение 7 дней. Учитываются только пользователи с полным окном наблюдения. График — по дате входа.",
    overview: (r) => r.overview.conversionRate,
    daily: (r) => r.conversionRate,
  },
  {
    id: "revenue_per_visitor",
    title: "Выручка / посетитель",
    format: "money",
    color: SALMON,
    definition:
      "Выручка, связанная с посетителями выбранного периода, делённая на их число. Платежи без связи с посетителем исключены.",
    overview: (r) => r.overview.revenuePerVisitorMinor,
    daily: (r) => r.revenuePerVisitorMinor,
  },
  {
    id: "bounce",
    title: "Отказы",
    format: "percent",
    color: BLUE,
    definition:
      "Доля измеренных сессий с одним просмотром, без полезного действия и с активностью менее 10 секунд. Сессии без измерения активности исключены.",
    overview: (r) => r.overview.bounceRate,
    daily: (r) => r.bounceRate,
  },
  {
    id: "session_time",
    title: "Время сессии",
    format: "duration",
    color: BLUE,
    definition:
      "Среднее измеренное активное время сессии. Отсутствие измерения не считается нулевой длительностью.",
    overview: (r) => r.overview.sessionSeconds,
    daily: (r) => r.sessionSeconds,
  },
  {
    id: "activation",
    title: "Первый результат",
    format: "number",
    color: BLUE,
    definition:
      "Уникальные пользователи, получившие первый полезный результат продукта за период.",
    overview: (r) => r.overview.activated,
    daily: (r) => r.activated,
  },
  {
    id: "pageviews",
    title: "Просмотры",
    format: "number",
    color: BLUE,
    definition:
      "Количество просмотров страниц за период. Повторные просмотры учитываются.",
    overview: (r) => r.overview.pageviews,
    daily: (r) => r.pageviews,
  },
  {
    id: "pages_per_visitor",
    title: "Страниц / посетитель",
    format: "number",
    color: BLUE,
    definition:
      "Количество просмотров, делённое на число уникальных посетителей за тот же период.",
    overview: (r) => ratio(r.overview.pageviews, r.overview.visitors),
    daily: (r) => ratio(r.pageviews, r.visitors),
  },
  {
    id: "new_returning",
    title: "Вернувшиеся",
    format: "number",
    color: BLUE,
    definition:
      "Посетители с наблюдаемой активностью до начала выбранного периода. На графике — до начала каждого дня. Это возврат посетителей, а не когортный retention.",
    overview: (r) => r.overview.returningVisitors,
    daily: (r) => r.returningVisitors,
  },
  {
    id: "returning_share",
    title: "Доля вернувшихся",
    format: "percent",
    color: BLUE,
    definition:
      "Доля вернувшихся среди посетителей периода. На графике возврат определяется относительно начала каждого дня.",
    overview: (r) => r.overview.returningRate,
    daily: (r) => {
      const value = ratio(r.returningVisitors, r.visitors);
      return value === null ? null : value * 100;
    },
  },
];
const primaryIds: MetricId[] = [
  "visitors",
  "revenue",
  "conversion",
  "revenue_per_visitor",
  "bounce",
  "session_time",
];
function formatValue(
  value: number | null,
  metric: MetricDefinition,
  report: DashboardData,
): string {
  if (value === null) return "—";
  if (metric.format === "money")
    return formatAmount(value, report.currency, report.currencyExponent);
  if (metric.format === "percent") return `${number(value)}%`;
  if (metric.format === "duration") return duration(value);
  return number(value);
}

function MetricDelta({
  current,
  previous,
  metric,
}: {
  current: number | null;
  previous: number | null;
  metric: MetricDefinition;
}) {
  if (
    current === null ||
    previous === null ||
    (previous === 0 && current !== 0 && metric.format !== "percent")
  ) {
    return <span className="text-muted-foreground">— к прошлому периоду</span>;
  }
  const change =
    metric.format === "percent"
      ? current - previous
      : previous === 0
        ? 0
        : ((current - previous) / Math.abs(previous)) * 100;
  const improved = metric.id === "bounce" ? change < 0 : change > 0;
  const directional = change !== 0;
  const Icon = change < 0 ? ArrowDown : ArrowUp;
  return (
    <span
      className="inline-flex items-center gap-1"
      title="По сравнению с предыдущим периодом той же длины"
    >
      {number(Math.abs(change))}
      {metric.format === "percent" ? " п.п." : "%"}
      {directional && (
        <Icon
          aria-label={change < 0 ? "Снижение" : "Рост"}
          className={`size-3 ${improved ? "text-emerald-500" : "text-rose-400"}`}
        />
      )}
    </span>
  );
}

export function ReferenceOverview({
  report,
  previous,
  views,
}: {
  report: DashboardData;
  previous?: DashboardData;
  views: string[];
}) {
  const measurement = report.measurement;
  const configuredMetrics = metrics.map((metric) => {
    if (!measurement) return metric;
    if (metric.id === "visitors") return {
      ...metric,
      title: measurement.audienceLabel,
      definition: "Уникальные ученики с наблюдаемой активностью за период. Дневные значения нельзя складывать: один ученик может вернуться в другой день.",
    };
    if (metric.id === "activation") return {
      ...metric,
      title: measurement.activationLabel,
      definition: `Первые достижения «${measurement.activationLabel}» за период, по дате результата. Доля активированных считается отдельно по зрелой входной когорте с полными ${measurement.activationWindowHours} ч наблюдения.`,
    };
    return metric;
  });
  const definitions = Object.fromEntries(
    configuredMetrics.map((metric) => [metric.id, metric]),
  ) as Record<MetricId, MetricDefinition>;
  const chartConfig = Object.fromEntries(
    configuredMetrics.map((metric) => [metric.id, { label: metric.title, color: metric.color }]),
  ) satisfies ChartConfig;
  const enabled = configuredMetrics.filter((metric) => views.includes(metric.id));
  const isPrimary = (metric: MetricDefinition) => primaryIds.includes(metric.id) || Boolean(measurement && metric.id === "activation");
  const primary = enabled.filter(isPrimary);
  const extra = enabled.filter((metric) => !isPrimary(metric));
  const combinedAvailable =
    views.includes("visitors") && views.includes("revenue") && report.overview.revenueMinor !== null;
  const fallback: ChartMode = combinedAvailable
    ? "combined"
    : (enabled[0]?.id ?? "visitors");
  const [selected, setSelected] = useState<ChartMode>(fallback);
  const current =
    selected === "combined"
      ? combinedAvailable
        ? selected
        : fallback
      : enabled.some((metric) => metric.id === selected)
        ? selected
        : fallback;
  const active =
    current === "combined"
      ? [definitions.visitors, definitions.revenue]
      : [definitions[current]];
  const extraSelected = extra.find((metric) => metric.id === current);
  const gradientId = `overview-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const data = report.trend.map((row) => ({
    date: row.date,
    ...Object.fromEntries(
      configuredMetrics.map((metric) => [metric.id, metric.daily(row, report)]),
    ),
  }));
  const hasData = active.some((metric) =>
    report.trend.some((row) => metric.daily(row, report) !== null),
  );
  const axisFormatter = (value: number, metric: MetricDefinition) => {
    if (metric.format === "money")
      return formatAmount(value, report.currency, report.currencyExponent);
    if (metric.format === "percent") return `${number(value)}%`;
    if (metric.format === "duration") return duration(value);
    return new Intl.NumberFormat("ru-RU", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  };

  if (enabled.length === 0)
    return views.includes("trend") ? (
      <Card className="reference-overview rounded-[22px] p-8 text-center text-sm text-muted-foreground">
        Выберите хотя бы одну метрику обзора в настройках блоков.
      </Card>
    ) : null;

  return (
    <Card className="reference-overview min-w-0 gap-0 overflow-hidden rounded-[22px] border-[#e9e9e9] bg-white py-0 shadow-[0_2px_3px_#00000004]">
      <div
        className="reference-kpi-strip flex min-w-0 overflow-x-auto px-2 pt-5 pb-4 sm:px-3"
        role="group"
        aria-label="Метрика основного графика"
      >
        {(primary.length ? primary : extra.slice(0, 1)).map((metric) => {
          const isActive = active.some((item) => item.id === metric.id);
          return (
            <Tooltip key={metric.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setSelected(metric.id)}
                  className="group min-w-[144px] flex-1 border-r border-[#f3f3f3] px-3 pt-0.5 pb-1 text-left outline-offset-[-2px] last:border-r-0 focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-ring sm:px-4"
                >
                  <span
                    className={`inline-block border-b-2 pb-1 text-[13px] whitespace-nowrap ${isActive ? "text-[#373737]" : "text-[#8d8d8d] group-hover:text-[#515151]"}`}
                    style={{
                      borderColor: isActive ? metric.color : "transparent",
                    }}
                  >
                    {metric.title}
                  </span>
                  <span className="mt-0.5 block text-[29px] leading-tight font-semibold tracking-[-1.1px] whitespace-nowrap text-[#303030] tabular-nums">
                    {formatValue(metric.overview(report), metric, report)}
                  </span>
                  <span className="mt-1.5 block min-h-4 text-[11px] text-[#8b8b8b] tabular-nums">
                    {previous ? (
                      <MetricDelta
                        current={metric.overview(report)}
                        previous={metric.overview(previous)}
                        metric={metric}
                      />
                    ) : (
                      "За выбранный период"
                    )}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent
                className="max-w-80 leading-relaxed"
                sideOffset={8}
              >
                {metric.definition}
              </TooltipContent>
            </Tooltip>
          );
        })}
        {extra.length > 0 && (
          <div className="flex min-w-[150px] flex-col justify-start gap-1 px-4 pt-1">
            <Select
              value={extraSelected?.id ?? ""}
              onValueChange={(value) => {
                const metric = extra.find((item) => item.id === value);
                if (metric) setSelected(metric.id);
              }}
            >
              <SelectTrigger
                aria-label="Дополнительные метрики"
                className="h-7 max-w-44 border-0 px-0 text-xs text-muted-foreground shadow-none"
              >
                <SelectValue placeholder="Ещё метрики" />
              </SelectTrigger>
              <SelectContent>
                {extra.map((metric) => (
                  <SelectItem key={metric.id} value={metric.id}>
                    {metric.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {extraSelected && (
              <span className="text-[27px] leading-tight font-semibold tracking-tight tabular-nums">
                {formatValue(
                  extraSelected.overview(report),
                  extraSelected,
                  report,
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {measurement && report.activationCohort && views.includes("activation") && (
        <div className="mx-5 mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[#f2f2f2] pt-3 text-xs">
          <span className="font-semibold tabular-nums text-foreground">
            {report.overview.activationRate === null ? "—" : `${number(report.overview.activationRate)}%`}
          </span>
          <span className="text-muted-foreground">
            Активация входной когорты · {number(report.activationCohort.activated)} из {number(report.activationCohort.eligible)} с полными {report.activationCohort.windowHours} ч наблюдения
          </span>
          <span className="text-muted-foreground">
            Ещё наблюдаем: {number(report.activationCohort.immature)}
          </span>
        </div>
      )}

      {views.includes("trend") && (
        <div className="px-2 pb-3 sm:px-5 sm:pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-1 pb-2 text-[11px] text-muted-foreground">
            <div
              className="flex flex-wrap items-center gap-3"
              aria-live="polite"
            >
              {active.map((metric) => (
                <span
                  key={metric.id}
                  className="inline-flex items-center gap-1.5"
                >
                  <span
                    className="size-2 rounded-sm"
                    style={{ background: metric.color }}
                  />
                  {metric.title}
                  {metric.format === "money" ? `, ${report.currency}` : ""}
                </span>
              ))}
            </div>
            {combinedAvailable && (
              <Button
                size="sm"
                variant="ghost"
                className={`h-7 gap-1.5 px-2 text-[11px] ${current === "combined" ? "text-foreground" : "text-muted-foreground"}`}
                onClick={() => setSelected("combined")}
                aria-pressed={current === "combined"}
              >
                <ChartNoAxesCombined className="size-3.5" />
                Посетители + выручка
              </Button>
            )}
          </div>
          {hasData ? (
            <ChartContainer
              config={chartConfig}
              className="h-[290px] w-full sm:h-[345px] lg:h-[380px]"
              aria-label={`Динамика: ${active.map((metric) => metric.title).join(", ")}. Точные значения в таблице под графиком.`}
            >
              <ComposedChart
                accessibilityLayer
                data={data}
                margin={{ top: 20, right: 5, left: 2, bottom: 3 }}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={active[0].color}
                      stopOpacity={0.28}
                    />
                    <stop
                      offset="100%"
                      stopColor={active[0].color}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 5"
                  stroke="#e9e9e9"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) => dayLabel(String(date))}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={12}
                  minTickGap={35}
                />
                <YAxis
                  yAxisId="left"
                  width={active[0].format === "money" ? 64 : 42}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) =>
                    axisFormatter(Number(value), active[0])
                  }
                  domain={
                    active[0].format === "percent"
                      ? [
                          0,
                          (maximum: number) =>
                            Math.min(
                              100,
                              Math.max(1, Math.ceil(maximum * 1.15 * 10) / 10),
                            ),
                        ]
                      : [(minimum: number) => Math.min(0, minimum), "auto"]
                  }
                />
                {current === "combined" && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    width={65}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(value) =>
                      axisFormatter(Number(value), definitions.revenue)
                    }
                  />
                )}
                <ChartTooltip
                  cursor={{ stroke: "#ced0d4", strokeDasharray: "5 5" }}
                  content={
                    <ChartTooltipContent
                      className="min-w-52 rounded-xl border-none bg-[#292929] p-3 text-white shadow-lg"
                      labelFormatter={(value) => dayLabel(String(value))}
                      formatter={(value, name) => {
                        const metric = configuredMetrics.find(
                          (item) => item.id === String(name),
                        );
                        return metric ? (
                          <div className="flex w-full items-center gap-2 py-1">
                            <span
                              className="size-2.5 shrink-0 rounded-sm"
                              style={{ background: metric.color }}
                            />
                            <span className="mr-5 text-white/80">
                              {metric.title}
                            </span>
                            <span className="ml-auto font-semibold tabular-nums">
                              {formatValue(
                                typeof value === "number" ? value : null,
                                metric,
                                report,
                              )}
                            </span>
                          </div>
                        ) : null;
                      }}
                    />
                  }
                />
                {current === "combined" ? (
                  <>
                    <Bar
                      yAxisId="right"
                      dataKey="revenue"
                      fill={SALMON}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={27}
                      isAnimationActive={false}
                    />
                    <Line
                      yAxisId="left"
                      dataKey="visitors"
                      type="monotone"
                      stroke={BLUE}
                      strokeWidth={2.7}
                      dot={false}
                      activeDot={{ r: 4, stroke: "white", strokeWidth: 2 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </>
                ) : (
                  <Area
                    yAxisId="left"
                    dataKey={current}
                    type="linear"
                    stroke={active[0].color}
                    strokeWidth={2.7}
                    fill={`url(#${gradientId})`}
                    activeDot={{ r: 4, stroke: "white", strokeWidth: 2 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ChartContainer>
          ) : (
            <div className="flex h-[290px] flex-col items-center justify-center gap-2 px-8 text-center sm:h-[345px] lg:h-[380px]">
              <p className="text-sm font-medium">
                Для этой метрики пока нет данных
              </p>
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                Подключите необходимые события и проверьте их покрытие в
                «Состоянии данных». Отсутствующие значения не считаются нулём.
              </p>
            </div>
          )}

          <div className="flex justify-between gap-3 px-3 pt-2 text-[10px] text-[#9a9a9a]">
            <span>UTC · последний день может быть неполным</span>
            {current === "conversion" && (
              <span>
                Полное окно: {report.funnelCohort.eligible} · ещё наблюдаем:{" "}
                {report.funnelCohort.immature}
              </span>
            )}
          </div>
          {measurement && current === "activation" && (
            <p className="px-3 pt-2 text-[10px] leading-relaxed text-muted-foreground">
              График — число первых достижений «{measurement.activationLabel}» по дате результата. Процент активации выше относится к зрелой когорте по дате входа.
            </p>
          )}
          <details className="mx-3 mt-3 border-t border-[#f2f2f2] pt-2 text-xs">
            <summary className="w-fit cursor-pointer text-[#8c8c8c] outline-offset-4 hover:text-foreground">
              Точные значения
            </summary>
            <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
              {active.map((metric) => metric.definition).join(" ")}
            </p>
            <div className="mt-2 max-h-72 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата, UTC</TableHead>
                    {active.map((metric) => (
                      <TableHead key={metric.id} className="text-right">
                        {metric.title}
                        {metric.format === "money"
                          ? `, ${report.currency}`
                          : ""}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.trend.map((row) => (
                    <TableRow key={row.date}>
                      <TableCell>{dayLabel(row.date)}</TableCell>
                      {active.map((metric) => (
                        <TableCell
                          key={metric.id}
                          className="text-right tabular-nums"
                        >
                          {formatValue(
                            metric.daily(row, report),
                            metric,
                            report,
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        </div>
      )}
    </Card>
  );
}
