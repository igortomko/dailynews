import { useId, type ReactNode } from "react";
import { Area, AreaChart, XAxis } from "recharts";
import {
  Braces,
  CircleDollarSign,
  Command,
  Globe2,
  Monitor,
  MousePointer2,
} from "lucide-react";
import { Card } from "@launch-kit/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@launch-kit/components/ui/chart";
import { formatAmount } from "@launch-kit/lib/data";
import type {
  AnalyticsDataset,
  BreakdownRow,
  DashboardData,
} from "@launch-kit/lib/types";

type SummaryProps = {
  report: DashboardData;
  product: AnalyticsDataset["product"];
  mode: "demo" | "local";
  views: string[];
  segment: string;
  generatedAt?: string;
};
const PEACH = "#e78b72";
const num = (value: number | null, digits = 1) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(
        value,
      );
const pct = (value: number | null) =>
  value === null ? "—" : `${num(value, 2)}%`;
const readable = (value: string) =>
  ({
    Unknown: "Не определён",
    unknown: "Не определён",
    direct: "Прямой",
    "(none)": "Без метки",
  })[value] ?? value;
const date = (value: string | number) =>
  new Date(value).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const sourceGlyphs: Record<string, string> = {
  Google: "G",
  YouTube: "▶",
  X: "𝕏",
  Telegram: "➤",
  ChatGPT: "✳",
  Newsletter: "✉",
  Direct: "↗",
  direct: "↗",
};
const countryGlyphs: Record<string, string> = {
  "United States": "🇺🇸",
  Brazil: "🇧🇷",
  France: "🇫🇷",
  Germany: "🇩🇪",
  Portugal: "🇵🇹",
  "United Kingdom": "🇬🇧",
  Spain: "🇪🇸",
  Canada: "🇨🇦",
  Argentina: "🇦🇷",
  Netherlands: "🇳🇱",
  Australia: "🇦🇺",
  India: "🇮🇳",
  Russia: "🇷🇺",
};

function Tile({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={`min-w-0 gap-0 overflow-hidden rounded-[20px] border-[#f1efee] bg-white py-0 shadow-[0_2px_3px_#00000003] ${className}`}
    >
      {children}
    </Card>
  );
}

function RevenueShare({
  rows,
  title,
  icon,
  report,
}: {
  rows: BreakdownRow[];
  title: string;
  icon: ReactNode;
  report: DashboardData;
}) {
  const ranked = rows
    .filter((row) => row.revenueMinor !== null)
    .sort((a, b) => (b.revenueMinor ?? 0) - (a.revenueMinor ?? 0));
  const top = ranked[0];
  const total = ranked.reduce((sum, row) => sum + (row.revenueMinor ?? 0), 0);
  const canShare =
    total > 0 && ranked.every((row) => (row.revenueMinor ?? 0) >= 0);
  const percentage = (row: BreakdownRow) =>
    num(((row.revenueMinor ?? 0) / total) * 100, 0);
  return (
    <Tile className="flex min-h-[112px] flex-row items-center gap-4 px-4 py-4">
      <div className="flex size-[67px] shrink-0 items-center justify-center rounded-[19px] border border-[#edb4a0] bg-gradient-to-br from-[#ffd5c1] via-[#efa07f] to-[#dc825f] text-[#9f553f] shadow-[inset_2px_3px_0_#ffe1d2,3px_5px_0_#f7e1d6] [&_svg]:size-9 [&_svg]:stroke-[1.5]">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="mb-1 text-[9px] uppercase tracking-wide text-[#ac9e97]">
          {title}
        </p>
        <p className="text-[13px] leading-5 font-semibold text-[#34302d]">
          {top ? (
            <>
              {canShare
                ? `${percentage(top)}% выручки — `
                : "Больше выручки — "}
              {readable(top.key)}{" "}
              <span className="whitespace-nowrap">
                (
                {formatAmount(
                  top.revenueMinor,
                  report.currency,
                  report.currencyExponent,
                )}
                )
              </span>
            </>
          ) : (
            "Нет связанных оплат"
          )}
        </p>
        <p className="mt-1 text-[10px] leading-4 text-[#958982]">
          {canShare
            ? ranked
                .slice(1, 3)
                .map((row) => `${percentage(row)}% — ${readable(row.key)}`)
                .join(" · ") || "Вся наблюдаемая выручка в этом сегменте"
            : top
              ? "Доля не рассчитана при нулевой выручке или возвратах"
              : "Появятся после подключения данных"}
        </p>
      </div>
    </Tile>
  );
}

function Rankings({
  rows,
  kind,
  report,
}: {
  rows: BreakdownRow[];
  kind: "source" | "country";
  report: DashboardData;
}) {
  const moneyAvailable = report.overview.payers !== null;
  const revenue = rows
    .filter((row) => row.revenueMinor !== null && row.revenueMinor !== 0)
    .sort((a, b) => (b.revenueMinor ?? 0) - (a.revenueMinor ?? 0))
    .slice(0, 4);
  const conversion = rows
    .filter(
      (row) => row.conversionRate !== null && (row.cohortEligible ?? 0) > 0,
    )
    .sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0))
    .slice(0, 4);
  const columns = moneyAvailable ? [
    { title: "Больше выручки", values: revenue, metric: "money" as const },
    { title: "Выше конверсия", values: conversion, metric: "conversion" as const },
  ] : [
    { title: report.measurement?.audienceLabel ?? "Посетители", values: [...rows].sort((a, b) => b.visitors - a.visitors).slice(0, 4), metric: "visitors" as const },
    { title: report.measurement?.activationLabel ?? "Первый результат", values: [...rows].sort((a, b) => b.activated - a.activated).slice(0, 4), metric: "activated" as const },
  ];
  return (
    <Tile className="relative p-4">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-2 -bottom-10 rotate-[-20deg] text-[180px] leading-none font-semibold text-[#fcf1ec]"
      >
        {kind === "country" ? "◎" : "↗"}
      </span>
      <div className="relative grid grid-cols-2 gap-5">
        {columns.map((column) => (
          <div key={column.title} className="min-w-0">
            <p className="mb-3 text-[9px] font-medium uppercase tracking-wide text-[#a9a19d]">
              {column.title}
            </p>
            {column.values.length ? (
              <div className="space-y-3">
                {column.values.map((row) => (
                  <div
                    key={row.key}
                    className="flex min-w-0 items-center gap-1.5 text-[11px]"
                  >
                    <span
                      className={`w-4 shrink-0 text-center ${row.key === "YouTube" ? "text-red-500" : row.key === "Google" ? "text-blue-500" : "text-[#53504d]"}`}
                      aria-hidden="true"
                    >
                      {kind === "country"
                        ? (countryGlyphs[row.key] ?? "◦")
                        : (sourceGlyphs[row.key] ?? "↗")}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={readable(row.key)}
                    >
                      {readable(row.key)}
                    </span>
                    <span className="shrink-0 font-medium whitespace-nowrap tabular-nums">
                      {column.metric === "money"
                        ? formatAmount(
                            row.revenueMinor,
                            report.currency,
                            report.currencyExponent,
                          )
                        : column.metric === "conversion"
                          ? pct(row.conversionRate)
                          : num(row[column.metric], 0)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-[11px] leading-4 text-[#aaa19c]">
                {column.metric === "money" ? "Нет связанных оплат" : column.metric === "conversion" ? "Нет зрелой когорты" : "Нет данных в этом периоде"}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="relative mt-4 text-[9px] text-[#b1a8a2]">
        {kind === "country" ? "Страны" : "Источники"} · {moneyAvailable
          ? "конверсия за 7 дней, только зрелые когорты"
          : "активность и первые результаты за период, не когортная конверсия"}
      </p>
    </Tile>
  );
}

function RevenuePerVisitor({ report }: { report: DashboardData }) {
  const gradient = `summary-rpv-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const present = report.trend.some(
    (row) => row.revenuePerVisitorMinor !== null,
  );
  return (
    <>
      <Tile className="pt-4">
        <p className="px-4 text-[9px] uppercase tracking-wide text-[#aaa09a]">
          Выручка / посетитель · динамика
        </p>
        {present ? (
          <ChartContainer
            config={{
              revenuePerVisitorMinor: {
                label: "Выручка / посетитель",
                color: PEACH,
              },
            }}
            className="mt-1 h-[128px] w-full"
            aria-label={`Выручка на посетителя по дням, ${report.currency}`}
          >
            <AreaChart
              accessibilityLayer
              data={report.trend}
              margin={{ top: 15, right: 0, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#eeac94" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#fdf0e9" stopOpacity={0.65} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => date(String(value))}
                    formatter={(value) => (
                      <span className="font-semibold tabular-nums">
                        {formatAmount(
                          typeof value === "number" ? value : null,
                          report.currency,
                          report.currencyExponent,
                        )}
                      </span>
                    )}
                  />
                }
              />
              <Area
                type="linear"
                dataKey="revenuePerVisitorMinor"
                stroke="#ed9278"
                strokeWidth={2}
                fill={`url(#${gradient})`}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <p className="flex h-[129px] items-center justify-center px-6 text-center text-xs text-[#aaa19c]">
            Нет оплат, связанных с посетителями
          </p>
        )}
      </Tile>
      <Tile className="px-5 pt-4 pb-5 text-center">
        <p className="text-[43px] leading-tight font-semibold tracking-[-2px] text-[#e99178] tabular-nums">
          {formatAmount(
            report.overview.revenuePerVisitorMinor,
            report.currency,
            report.currencyExponent,
          )}
        </p>
        <p className="mt-1 text-xs text-[#8c817b]">выручка на посетителя</p>
        <p className="mt-2 text-[9px] text-[#b0a59e]">
          Связанные оплаты − возвраты / посетители периода
        </p>
      </Tile>
    </>
  );
}

export function ReferenceSummary({
  report,
  product,
  mode,
  views,
  segment,
  generatedAt,
}: SummaryProps) {
  const measurement = report.measurement;
  const moneyAvailable = report.overview.payers !== null;
  const moneyViews = new Set(["device_os_browser_revenue", "visits_to_purchase", "revenue_per_visitor_growth", "time_to_purchase", "conversion", "top_converting_goals", "conversion_heatmap"]);
  const has = (id: string) => views.includes(id) && (moneyAvailable || !moneyViews.has(id));
  const left =
    has("device_os_browser_revenue") ||
    has("visits_to_purchase") ||
    has("top_countries");
  const center =
    has("daily_averages") ||
    has("identity_period") ||
    has("revenue_per_visitor_growth");
  const right =
    has("top_sources") ||
    has("time_to_purchase") ||
    has("conversion") ||
    has("activation") ||
    has("seven_day_return");
  const columns = Number(left) + Number(center) + Number(right);
  const period = `${date(report.range.from)} — ${date(Date.parse(report.range.to) - 1)}`;
  return (
    <div
      id="summary"
      data-columns={columns}
      className="reference-summary min-w-0 rounded-[24px] bg-[#faf9f8] p-2 text-[#3b3632] sm:p-3"
    >
      {measurement && (
        <p className="mb-3 px-3 pt-1 text-xs leading-relaxed text-[#958982]">
          {measurement.description}
        </p>
      )}
      <div
        className={`grid items-start gap-2.5 ${columns === 3 ? "lg:grid-cols-3" : columns === 2 ? "lg:grid-cols-2" : "grid-cols-1"}`}
      >
        {left && (
          <div className="order-2 grid min-w-0 gap-2.5 lg:order-1">
            {has("device_os_browser_revenue") && (
              <>
                <RevenueShare
                  rows={report.breakdowns.device}
                  title="Устройства"
                  icon={<Monitor />}
                  report={report}
                />
                <RevenueShare
                  rows={report.breakdowns.os}
                  title="Операционные системы"
                  icon={<Command />}
                  report={report}
                />
                <RevenueShare
                  rows={report.breakdowns.browser}
                  title="Браузеры"
                  icon={<Globe2 />}
                  report={report}
                />
              </>
            )}
            {has("visits_to_purchase") && (
              <div className="grid grid-cols-[1.05fr_1fr] gap-2.5">
                <Tile className="flex min-h-[145px] flex-col items-center justify-center px-3 py-5 text-center">
                  <p className="text-[43px] leading-tight font-semibold tracking-[-2px] text-[#e99178] tabular-nums">
                    {pct(report.summary.firstVisitPurchaseRate)}
                  </p>
                  <p className="mt-2 max-w-36 text-[11px] leading-4 text-[#8b817b]">
                    купили в первую наблюдаемую сессию
                  </p>
                </Tile>
                <Tile className="flex flex-col justify-between p-4">
                  <p className="text-[9px] uppercase tracking-wide text-[#aaa09a]">
                    Связь оплаты с визитом
                  </p>
                  <MousePointer2 className="mt-3 size-5 text-[#e6a28b]" />
                  <p className="mt-1 text-[25px] font-semibold tracking-tight tabular-nums">
                    {num(report.summary.sessionLinkedPurchaseCount, 0)}{" "}
                    <span className="text-sm font-normal text-[#aaa09a]">
                      из {num(report.summary.firstPurchaseCount, 0)}
                    </span>
                  </p>
                  <p className="mt-1 text-[9px] leading-4 text-[#aaa09a]">
                    первых оплат с известной сессией
                  </p>
                </Tile>
              </div>
            )}
            {has("top_countries") && (
              <Rankings
                rows={report.breakdowns.country}
                kind="country"
                report={report}
              />
            )}
          </div>
        )}
        {center && (
          <div className="order-1 grid min-w-0 gap-2.5 lg:order-2">
            {has("daily_averages") && (
              <Tile className={`grid gap-3 px-5 pt-5 pb-4 text-center ${moneyAvailable ? "grid-cols-2" : "grid-cols-1"}`}>
                <div>
                  <Globe2 className="mx-auto mb-2 size-9 stroke-[1.5] text-[#e8a189]" />
                  <p className="text-[33px] leading-tight font-semibold tracking-[-1px] text-[#e78f76] tabular-nums">
                    {num(report.summary.averageDailyVisitors, 0)}
                  </p>
                  <p className="mt-1 text-[10px] text-[#8c817b]">
                    {measurement ? `${measurement.audienceLabel.toLowerCase()} · среднее в день` : "посетителей в день"}
                  </p>
                  {measurement && <p className="mt-2 text-[10px] text-[#958982]">
                    {measurement.audienceLabel} за период: {num(report.overview.visitors, 0)}
                  </p>}
                </div>
                {moneyAvailable && <div>
                  <CircleDollarSign className="mx-auto mb-2 size-9 stroke-[1.5] text-[#e8a189]" />
                  <p className="text-[31px] leading-tight font-semibold tracking-[-1px] text-[#e78f76] tabular-nums">
                    {formatAmount(
                      report.summary.averageDailyRevenueMinor,
                      report.currency,
                      report.currencyExponent,
                    )}
                  </p>
                  <p className="mt-1 text-[10px] text-[#8c817b]">
                    выручки в день
                  </p>
                </div>}
              </Tile>
            )}
            {has("identity_period") && (
              <Tile className="relative flex min-h-[291px] flex-col items-center justify-center border-[#f6e8e0] px-5 py-8 text-center">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,#fff7f2_0%,#fff7f2_30%,#fdf0e9_31%,#fdf0e9_55%,#fae7dd_56%,#fbeae3_100%)]"
                />
                <div className="relative mb-6 flex size-[91px] items-center justify-center rounded-[25px] border-[7px] border-[#efa287] bg-[#262221] text-white shadow-[inset_0_0_0_3px_#fbd5c3,0_8px_12px_#c88a7526]">
                  <Braces className="size-11 stroke-[3]" />
                </div>
                <h2 className="relative max-w-full text-[35px] leading-[1.1] font-semibold tracking-[-1.5px] break-words text-[#302926]">
                  {product.name}
                </h2>
                <p className="relative mt-4 text-xs text-[#9a7d6e] italic">
                  {period}
                </p>
                <p className="relative mt-2 text-[9px] uppercase tracking-[1.5px] text-[#ba9583]">
                  {mode === "demo"
                    ? "DEMO · синтетические данные"
                    : product.profile}{" "}
                  {moneyAvailable && ` · ${report.currency}`}
                </p>
                {mode === "local" && generatedAt && <p className="relative mt-2 text-[10px] text-[#9a7d6e]">
                  Snapshot: {new Date(generatedAt).toLocaleString("ru-RU", { timeZone: "UTC" })} UTC
                </p>}
              </Tile>
            )}
            {has("revenue_per_visitor_growth") && (
              <RevenuePerVisitor report={report} />
            )}
          </div>
        )}
        {right && (
          <div className="order-3 grid min-w-0 gap-2.5">
            {has("top_sources") && (
              <Rankings
                rows={report.breakdowns.source}
                kind="source"
                report={report}
              />
            )}
            {has("time_to_purchase") && (
              <Tile className="grid min-h-[146px] grid-cols-[1fr_1.1fr] items-center gap-5 px-5 py-5">
                <div>
                  <p className="text-[9px] uppercase tracking-wide text-[#aaa09a]">
                    Время до первой оплаты
                  </p>
                  <p className="mt-3 text-[11px] leading-4 text-[#94877e]">
                    От первого наблюдаемого входа до первой оплаты
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[52px] leading-none font-semibold tracking-[-2px] text-[#e99178] tabular-nums">
                    {num(report.summary.medianHoursToPurchase)}
                  </p>
                  <p className="mt-2 text-[11px] text-[#8b817b]">
                    часов · медиана
                  </p>
                </div>
              </Tile>
            )}
            {has("conversion") && (
              <Tile className="px-4 pt-4 pb-5 text-center">
                <p className="text-[51px] leading-tight font-semibold tracking-[-2px] text-[#e99178] tabular-nums">
                  {pct(report.overview.conversionRate)}
                </p>
                <p className="mt-1 text-xs text-[#8c817b]">
                  конверсия в оплату за 7 дней
                </p>
                <p className="mt-2 text-[9px] text-[#b0a59e]">
                  Вход → первый результат → оплата ·{" "}
                  {num(report.funnelCohort.eligible, 0)} зрелых входов
                </p>
              </Tile>
            )}
            {(has("activation") || has("seven_day_return")) && (
              <div
                className={`grid gap-2.5 ${has("activation") && has("seven_day_return") ? "grid-cols-2" : "grid-cols-1"}`}
              >
                {has("activation") && (
                  <Tile className="p-4">
                    <p className="text-[9px] uppercase tracking-wide text-[#aaa09a]">
                      {measurement?.activationLabel ?? "Первый результат"}
                    </p>
                    <p className="mt-4 text-[35px] leading-none font-semibold tracking-[-1px] text-[#e99178] tabular-nums">
                      {measurement ? pct(report.overview.activationRate) : num(report.overview.activated, 0)}
                    </p>
                    <p className="mt-3 text-[10px] leading-4 text-[#958982]">
                      {measurement && report.activationCohort
                        ? `${num(report.activationCohort.activated, 0)} из ${num(report.activationCohort.eligible, 0)} зрелых входов · окно ${report.activationCohort.windowHours} ч. Ещё наблюдаем: ${num(report.activationCohort.immature, 0)}.`
                        : product.firstValueLabel}
                    </p>
                    {measurement && <p className="mt-2 text-[10px] leading-4 text-[#958982]">
                      Первых достижений по дате результата за период: {num(report.overview.activated, 0)}.
                    </p>}
                  </Tile>
                )}
                {has("seven_day_return") && (
                  <Tile className="p-4">
                    <p className="text-[9px] uppercase tracking-wide text-[#aaa09a]">
                      {measurement?.retention.label ?? "Возврат за 7 дней"}
                    </p>
                    <p className="mt-4 text-[35px] leading-none font-semibold tracking-[-1px] text-[#e99178] tabular-nums">
                      {pct(report.retention.rate)}
                    </p>
                    <p className="mt-3 text-[10px] leading-4 text-[#958982]">
                      {num(report.retention.returned, 0)} из{" "}
                      {num(report.retention.eligible, 0)} вернулись за результатом
                    </p>
                    {measurement && <p className="mt-2 text-[10px] leading-4 text-[#958982]">
                      {measurement.retention.startHours}–{measurement.retention.endHours} ч после входа. Полное наблюдение: {measurement.retention.endHours} ч.
                    </p>}
                  </Tile>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <p className="mt-4 px-3 text-center text-[10px] leading-4 text-[#b0a49d]">
        {mode === "demo"
          ? "Синтетические данные"
          : "Локальный snapshot"}{" "}
        · {period} · UTC{moneyAvailable && ` · ${report.currency}`}. Сегмент:{" "}
        {segment || "Все источники и пользователи"}.
        {moneyAvailable ? " Выручка — оплаты минус возвраты, без конвертации валют." : " Платёжные данные недоступны."}
        {mode === "local" && generatedAt && ` Snapshot от ${new Date(generatedAt).toLocaleString("ru-RU", { timeZone: "UTC" })} UTC; перезагрузка не обновляет базу продукта.`}
      </p>
      {columns === 0 && (
        <p className="p-8 text-center text-sm text-muted-foreground">
          Выберите блоки отчёта в настройках.
        </p>
      )}
    </div>
  );
}
