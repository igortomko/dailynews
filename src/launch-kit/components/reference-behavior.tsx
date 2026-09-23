import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowRight, ArrowUp, Search } from "lucide-react";
import { Card } from "@launch-kit/components/ui/card";
import { Button } from "@launch-kit/components/ui/button";
import { Badge } from "@launch-kit/components/ui/badge";
import { Input } from "@launch-kit/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@launch-kit/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@launch-kit/components/ui/select";
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
import { Empty, label, num, pct } from "@launch-kit/components/dashboard-widgets";
import { DimensionIcon } from "@launch-kit/components/reference-breakdowns";
import { formatAmount } from "@launch-kit/lib/data";
import { ownerUserName } from "@launch-kit/components/product-panels";
import type { DashboardData } from "@launch-kit/lib/types";

const tabNames = {
  goals: "Цели",
  funnels: "Воронка",
  users: "Пользователи",
  journeys: "Пути",
};
type Tab = keyof typeof tabNames;
type UserSort = "lastSeen" | "name" | "events" | "cards" | "reviews" | "mastered" | "due";
const goalColors = [
  "#39c967",
  "#f16d66",
  "#a37bee",
  "#f3b34a",
  "#5dcee0",
  "#db72b9",
  "#8fba67",
  "#8b97a6",
];
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const timeLabel = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
const elapsedLabel = (from: string, to: string) => {
  const minutes = Math.max(0, (Date.parse(to) - Date.parse(from)) / 60_000);
  if (minutes < 1) return "< 1 мин";
  if (minutes < 60) return `${num(Math.round(minutes))} мин`;
  if (minutes < 24 * 60) return `${num(Math.round(minutes / 60))} ч`;
  return `${num(Math.round(minutes / 1440))} д`;
};
const goalLabel = (key: string, report: DashboardData) =>
  report.measurement?.funnel.steps.find(
    (step) => (step.goal ?? step.event) === key || step.key === key,
  )?.label ?? key;

function GoalView({
  report,
  search,
  goalViews,
}: {
  report: DashboardData;
  search: string;
  goalViews: string[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const hasList = goalViews.includes("goal_list");
  const hasTrend = goalViews.includes("goal_trend");
  const chosen = hasList
    ? report.goals.find((goal) => goal.key === selected)
    : undefined;
  const goals = report.goals.filter((goal) =>
    `${goal.key} ${goalLabel(goal.key, report)}`.toLowerCase().includes(search.toLowerCase()),
  );
  const chartGoals = chosen ? [chosen] : goals.slice(0, 8);
  const max = Math.max(...report.goals.map((goal) => goal.count), 1);
  const color = (key: string) =>
    goalColors[
      Math.max(
        0,
        report.goals.findIndex((goal) => goal.key === key),
      ) % goalColors.length
    ];
  const config: ChartConfig = Object.fromEntries(
    chartGoals.map((goal, index) => [
      `goal${index}`,
      { label: goalLabel(goal.key, report), color: color(goal.key) },
    ]),
  );
  const chartRows = report.goalTrend.map((row) => ({
    date: row.date,
    ...Object.fromEntries(
      chartGoals.map((goal, index) => [
        `goal${index}`,
        row.values[goal.key] ?? 0,
      ]),
    ),
  }));
  if (!hasList && !hasTrend)
    return (
      <Empty title="Представление целей не выбрано">
        Включите список или график целей в настройках блоков.
      </Empty>
    );
  if (!report.goals.length)
    return (
      <Empty title="Пока нет событий целей">
        Передайте события полезных действий продукта.
      </Empty>
    );
  return (
    <div
      className={`grid min-w-0 gap-4 ${hasList && hasTrend ? "lg:grid-cols-[minmax(0,1fr)_minmax(220px,32%)]" : ""}`}
    >
      {hasTrend && (
        <div className="min-w-0">
          <ChartContainer config={config} className="h-[320px] w-full">
            <LineChart
              accessibilityLayer
              data={chartRows}
              margin={{ top: 12, right: 10, bottom: 4, left: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 5" />
              <XAxis
                dataKey="date"
                tickFormatter={dateLabel}
                axisLine={false}
                tickLine={false}
                minTickGap={36}
                tickMargin={8}
              />
              <YAxis
                width={34}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => dateLabel(String(value))}
                  />
                }
              />
              {chartGoals.map((goal, index) => (
                <Line
                  key={goal.key}
                  dataKey={`goal${index}`}
                  type="monotone"
                  stroke={`var(--color-goal${index})`}
                  strokeWidth={1.8}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
          <p className="mt-1 text-[10px] text-muted-foreground">
            События по дням, UTC.{" "}
            {chosen
              ? "Нажмите выбранную цель ещё раз, чтобы показать остальные."
              : hasList
                ? "Показаны до 8 целей; выберите любую цель в списке."
                : "Показаны до 8 целей. Используйте поиск, чтобы уточнить выбор."}
          </p>
        </div>
      )}
      {hasList && (
        <div className="max-h-[342px] min-w-0 overflow-y-auto rounded-2xl border p-1">
          {goals.length ? (
            goals.map((goal) => (
              <button
                key={goal.key}
                onClick={() =>
                  setSelected(selected === goal.key ? null : goal.key)
                }
                aria-pressed={selected === goal.key}
                className="relative mb-1 flex h-9 w-full min-w-0 items-center justify-between gap-3 overflow-hidden rounded-lg px-2.5 text-left text-xs hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                title={`${goalLabel(goal.key, report)}: ${num(goal.count)} событий, ${num(goal.visitors)} человек`}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 rounded-r-lg"
                  style={{
                    width: `${(goal.count / max) * 100}%`,
                    backgroundColor: color(goal.key),
                    opacity: selected === goal.key ? 0.3 : 0.18,
                  }}
                />
                <span className="relative min-w-0 truncate font-medium">
                  {goalLabel(goal.key, report)}
                </span>
                <span className="relative shrink-0 tabular-nums font-medium">
                  {num(goal.count)}
                </span>
              </button>
            ))
          ) : (
            <p className="p-4 text-xs text-muted-foreground">
              Ничего не найдено.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FunnelView({
  report,
  firstValueLabel,
  funnelViews,
}: {
  report: DashboardData;
  firstValueLabel: string;
  funnelViews: string[];
}) {
  const stages = report.funnel;
  const hasGraph = funnelViews.includes("product_activation_payment");
  const hasStepDetails = funnelViews.includes("step_details");
  if (!hasGraph && !hasStepDetails)
    return <Empty title="Представление воронки не выбрано" />;
  if (!stages.length) return <Empty title="Воронка пока не настроена" />;
  if (report.measurement?.funnel.mode === "independent") {
    const measurement = report.measurement;
    const entered = report.funnelCohort.entered;
    return (
      <div className="space-y-4 py-2">
        <div>
          <h3 className="text-sm font-medium">{measurement.funnel.label}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Независимые этапы · {num(entered)} учеников с первым входом в выбранном периоде. Каждый этап рассчитан от этой общей когорты; прохождение предыдущего этапа не требуется.
          </p>
        </div>
        <div className="space-y-3" aria-label="Независимые этапы от входной когорты">
          {stages.map((stage) => {
            const stageLabel = measurement.funnel.steps.find((step) => step.key === stage.key)?.label ?? stage.label;
            const share = stage.count === null || entered === 0 ? null : stage.count / entered * 100;
            return (
              <div key={stage.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-4 text-xs">
                  <span className="min-w-0 font-medium">{stageLabel}</span>
                  <span className="shrink-0 tabular-nums">
                    {num(stage.count)} <span className="text-muted-foreground">· {pct(share)}</span>
                  </span>
                </div>
                {hasGraph && (
                  <div className="h-7 overflow-hidden rounded-md bg-[#f4f7fa]" aria-label={`${stageLabel}: ${num(stage.count)} из ${num(entered)}`}>
                    {share !== null && <div className="h-full rounded-md bg-[#a9d9ff]" style={{ width: `${Math.min(100, Math.max(0, share))}%` }} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Числа этапов могут увеличиваться. Это охват независимых действий, без последовательного drop-off.
          {" "}Окно активации: {measurement.activationWindowHours} ч; зрелых входов {num(report.funnelCohort.eligible)}, ещё наблюдаем {num(report.funnelCohort.immature)}. Процент зрелой активации — в обзоре.
        </p>
      </div>
    );
  }
  const max = Math.max(...stages.map((stage) => stage.count ?? 0), 1);
  const stepWidth = 1000 / stages.length;
  const names: Record<string, string> = {
    entry: "Вход в продукт",
    product_entered: "Вход в продукт",
    first_value: firstValueLabel,
    checkout: "Checkout",
    checkout_started: "Checkout",
    paid: "Оплата",
    payment_succeeded: "Оплата",
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {num(report.funnelCohort.eligible)} зрелых входов · окно{" "}
          {report.funnelCohort.windowDays} дней
        </span>
        <span className="font-medium text-foreground">
          {pct(stages.at(-1)?.conversionRate)} конверсия
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          {hasGraph && (
            <div className="relative h-[250px]">
              <svg
                viewBox="0 0 1000 250"
                preserveAspectRatio="none"
                className="h-full w-full"
                role="img"
                aria-label="Убывание участников по шагам воронки"
              >
                {stages.map((stage, index) => {
                  if (stage.count === null) return null;
                  const next = stages[index + 1]?.count ?? stage.count;
                  const height = (stage.count / max) * 112;
                  const nextHeight = (next / max) * 112;
                  const x = index * stepWidth;
                  const end = x + stepWidth;
                  const path = `M ${x} ${125 - height} L ${x + stepWidth * 0.15} ${125 - height} C ${x + stepWidth * 0.55} ${125 - height} ${x + stepWidth * 0.55} ${125 - nextHeight} ${end} ${125 - nextHeight} L ${end} ${125 + nextHeight} C ${x + stepWidth * 0.55} ${125 + nextHeight} ${x + stepWidth * 0.55} ${125 + height} ${x + stepWidth * 0.15} ${125 + height} L ${x} ${125 + height} Z`;
                  return (
                    <g key={stage.key}>
                      <path
                        d={path}
                        fill={
                          [
                            "#e8f6ff",
                            "#bce3ff",
                            "#87c8fa",
                            "#56a9f1",
                            "#368edb",
                          ][Math.min(index, 4)]
                        }
                      />
                      <line
                        x1={x}
                        x2={x}
                        y1="0"
                        y2="250"
                        stroke="#f1f3f5"
                        strokeWidth="1"
                      />
                    </g>
                  );
                })}
              </svg>
              {stages.map((stage, index) =>
                index > 0 && stage.dropoffRate !== null ? (
                  <span
                    key={stage.key}
                    className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-white/75 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                    style={{ left: `${(index / stages.length) * 100}%` }}
                  >
                    −{pct(stage.dropoffRate)}
                    <ArrowRight className="size-3" />
                  </span>
                ) : null,
              )}
            </div>
          )}
          <div
            className="grid border-t"
            style={{
              gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`,
            }}
          >
            {stages.map((stage) => (
              <div
                key={stage.key}
                className="border-r px-3 py-3 last:border-r-0"
              >
                {hasStepDetails && (
                  <div className="text-sm font-semibold tabular-nums">
                    {num(stage.count)}{" "}
                    <span className="font-normal text-muted-foreground">
                      человек
                    </span>
                  </div>
                )}
                <div
                  className="mt-1 truncate text-xs text-muted-foreground"
                  title={names[stage.key] ?? stage.label}
                >
                  {names[stage.key] ?? stage.label}
                </div>
                {hasStepDetails && !hasGraph && stage.dropoffRate !== null && (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Потеря {pct(stage.dropoffRate)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Ещё {num(report.funnelCohort.immature)} входов наблюдаем до завершения
        окна. Порядок шагов соответствует контракту продукта.
      </p>
    </div>
  );
}

export function ReferenceBehavior({
  report,
  identity,
  firstValueLabel,
  enabledTabs,
  learningEnabled = true,
  onUser,
  goalViews = ["goal_list", "goal_trend"],
  funnelViews = ["product_activation_payment", "step_details"],
}: {
  report: DashboardData;
  identity: boolean;
  firstValueLabel: string;
  enabledTabs: string[];
  learningEnabled?: boolean;
  onUser: (id: string) => void;
  goalViews?: string[];
  funnelViews?: string[];
}) {
  const [choice, setChoice] = useState<Tab>(report.measurement ? "funnels" : "journeys");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [userSort, setUserSort] = useState<UserSort>("lastSeen");
  const [sortDescending, setSortDescending] = useState(true);
  const [milestone, setMilestone] = useState(
    report.measurement?.funnel.steps.find((step) => step.event === "first_value")?.key ?? "payment_succeeded",
  );
  const tabs = (Object.keys(tabNames) as Tab[]).filter((tab) =>
    enabledTabs.includes(tab),
  );
  const active = tabs.includes(choice) ? choice : tabs[0];
  if (!active) return null;

  const moneyAvailable = report.overview.payers !== null;
  const milestones = report.measurement?.funnel.steps ?? [
    ...(moneyAvailable ? [{ key: "payment_succeeded", label: "Оплата", event: "payment_succeeded" }] : []),
    { key: "first_value", label: firstValueLabel, event: "first_value" },
    { key: "value_repeated", label: "Повторный результат", event: "value_repeated" },
  ];
  const selectedMilestone = milestones.find((step) => step.key === milestone) ?? milestones[0];
  const matchesMilestone = (step: { name: string; goal?: string }) =>
    step.name === selectedMilestone?.event && (!("goal" in selectedMilestone) || !selectedMilestone.goal || step.goal === selectedMilestone.goal);
  const journeyById = new Map(
    report.journeys.map((journey) => [journey.id, journey]),
  );
  const matched = report.users.filter(
    (user) =>
      active !== "journeys" ||
      journeyById.get(user.id)?.milestones.some(matchesMilestone),
  );
  const enhancedUsers = Boolean(report.measurement || report.users.some((user) => user.profile || user.learning));
  const hasLearning = learningEnabled && report.users.some((user) => user.learning);
  const showLearning = active === "users" && hasLearning;
  const userSortOptions: { key: UserSort; label: string }[] = [
    { key: "lastSeen", label: "Последняя активность" },
    { key: "name", label: "Имя" },
    { key: "events", label: "События периода" },
    ...(hasLearning ? [
      { key: "cards" as const, label: "Карточки за всё время" },
      { key: "reviews" as const, label: "Оценки за всё время" },
      { key: "mastered" as const, label: "Освоенные" },
      { key: "due" as const, label: "К повторению" },
    ] : []),
  ];
  const sortValue = (user: DashboardData["users"][number]) => userSort === "name" ? ownerUserName(user) : userSort === "lastSeen" ? Date.parse(user.lastSeen) : userSort === "events" ? user.events : user.learning?.[userSort] ?? null;
  const users = matched.filter((user) =>
    `${user.id} ${ownerUserName(user)} ${user.profile?.username ?? ""} ${user.source} ${user.country} ${user.device}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  ).sort((a, b) => {
    const left = sortValue(a);
    const right = sortValue(b);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    const difference = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
    return sortDescending ? -difference : difference;
  });
  const pageSize = 5;
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(users.length / pageSize) - 1),
  );
  const visible = users.slice(safePage * pageSize, (safePage + 1) * pageSize);

  return (
    <Card
      aria-label="Поведение пользователей"
      className="reference-behavior min-w-0 gap-0 overflow-hidden rounded-3xl border-border/75 bg-white py-0 shadow-sm"
    >
      <h2 className="sr-only">Поведение пользователей</h2>
      <div className="flex min-w-0 flex-wrap items-center gap-2 p-3">
        <Tabs
          value={active}
          onValueChange={(value) => {
            setChoice(value as Tab);
            setSearch("");
            setPage(0);
          }}
          className="min-w-0 max-w-full"
        >
          <TabsList
            aria-label="Поведение пользователей"
            className="h-9 max-w-full justify-start overflow-x-auto rounded-full bg-[#f8f8f8] p-1"
          >
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="h-7 shrink-0 rounded-full px-2.5 text-xs font-medium text-muted-foreground data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                {tabNames[tab]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {active === "journeys" && (
          <Select
            value={selectedMilestone?.key}
            onValueChange={(value) => {
              setMilestone(value);
              setPage(0);
            }}
          >
            <SelectTrigger
              aria-label="Цель пути"
              className="h-8 w-auto max-w-full gap-2 rounded-full bg-muted/40 px-3 text-xs shadow-none"
            >
              <span className="text-muted-foreground">Цель:</span>
              <SelectValue />
              <span className="text-muted-foreground">
                {num(matched.length)}
              </span>
            </SelectTrigger>
            <SelectContent>
              {milestones.map((step) => (
                <SelectItem key={step.key} value={step.key}>
                  {step.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {active !== "funnels" && (
          <div className="relative ml-auto w-44 max-w-full">
            <Search className="absolute left-2.5 top-2.5 size-3 text-muted-foreground" />
            <Input
              aria-label={
                active === "goals" ? "Поиск целей" : "Поиск пользователей"
              }
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder={active === "goals" ? "Поиск целей" : enhancedUsers ? "Имя, username, ID" : "Поиск"}
              className="h-8 bg-muted/15 pl-8 text-xs"
            />
          </div>
        )}
        {(active === "users" || active === "journeys") && enhancedUsers && <div className="flex items-center gap-1">
          <Select value={userSort} onValueChange={(value) => { setUserSort(value as UserSort); setSortDescending(value !== "name"); setPage(0); }}>
            <SelectTrigger aria-label="Сортировка пользователей" className="h-8 w-auto max-w-52 gap-2 border-0 px-2 text-xs shadow-none"><SelectValue /></SelectTrigger>
            <SelectContent>{userSortOptions.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="size-8" aria-label={sortDescending ? "Сортировать по возрастанию" : "Сортировать по убыванию"} onClick={() => { setSortDescending(!sortDescending); setPage(0); }}>{sortDescending ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}</Button>
        </div>}
      </div>
      <div className="min-w-0 px-4 pb-4">
        {active === "goals" ? (
          <GoalView report={report} search={search} goalViews={goalViews} />
        ) : active === "funnels" ? (
          <FunnelView
            report={report}
            firstValueLabel={firstValueLabel}
            funnelViews={funnelViews}
          />
        ) : !identity ? (
          <Empty title="Идентификация не подключена">
            Для пользователей и путей нужны устойчивые псевдонимы событий.
          </Empty>
        ) : !users.length ? (
          <Empty
            title={
              search
                ? "Ничего не найдено"
                : active === "journeys"
                  ? "Пути к выбранной цели пока не найдены"
                  : "Пока нет пользователей"
            }
          >
            Выберите другую цель, измените фильтры или передайте события
            продукта.
          </Empty>
        ) : (
          <>
            <Table className={showLearning ? "min-w-[940px]" : "min-w-[640px]"}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={`${showLearning ? "min-w-48" : "w-[45%]"} pl-0 text-[11px]`}>
                    {report.measurement ? "Ученик" : "Посетитель"}
                  </TableHead>
                  <TableHead className="text-[11px]">Источник</TableHead>
                  {active === "users" && enhancedUsers && <TableHead className="text-right text-[11px]">События периода</TableHead>}
                  {showLearning && <><TableHead className="text-right text-[11px]">Карточки</TableHead><TableHead className="text-right text-[11px]">Освоенные</TableHead><TableHead className="text-right text-[11px]">К повторению</TableHead><TableHead className="text-right text-[11px]">Оценки</TableHead></>}
                  {moneyAvailable && <TableHead className="text-[11px]">Потратил</TableHead>}
                  {active === "journeys" && (
                    <TableHead className="whitespace-nowrap text-[11px]">
                      До события
                    </TableHead>
                  )}
                  <TableHead className="whitespace-nowrap text-[11px]">
                    {active === "journeys"
                      ? "Достиг цели, UTC"
                      : enhancedUsers ? "Последняя активность, UTC" : "Последний визит, UTC"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((user) => {
                  const journey = journeyById.get(user.id);
                  const completed = journey?.milestones.find(matchesMilestone);
                  return (
                    <TableRow
                      key={user.id}
                      className="border-0 hover:bg-transparent"
                    >
                      <TableCell className="py-3.5 pl-0">
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            aria-hidden="true"
                            className="grid size-10 shrink-0 place-items-center rounded-full border border-[#d5e7f5] bg-[#eaf5fd] text-sm font-semibold text-[#637d91]"
                          >
                            {user.profile ? ownerUserName(user).slice(0, 2).toUpperCase() : user.id.slice(-2).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                onClick={() => onUser(user.id)}
                                className="max-w-56 truncate text-left text-xs font-semibold underline-offset-4 hover:underline"
                                title={user.id}
                              >
                                {ownerUserName(user)}
                              </button>
                              {moneyAvailable && (journey?.steps.some(
                                (step) => step.name === "payment_succeeded",
                              ) ||
                                (user.spentMinor !== null &&
                                  user.spentMinor > 0)) && (
                                <Badge
                                  variant="outline"
                                  className="rounded-sm border-[#f2ceb9] bg-[#fff4ed] px-1.5 py-0 text-[9px] font-normal text-[#c9784b]"
                                >
                                  Покупатель
                                </Badge>
                              )}
                            </div>
                            {user.profile && <p className="mt-1 max-w-52 truncate text-[10px] text-muted-foreground">{user.profile.username ? `@${user.profile.username.replace(/^@/, "")}` : user.id}</p>}
                            {!report.measurement && <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                              <DimensionIcon
                                dimension="country"
                                value={user.country}
                              />
                              {label(user.country)}
                              <DimensionIcon
                                dimension="device"
                                value={user.device}
                              />
                              {label(user.device)}
                            </p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="inline-flex items-center gap-2">
                          <DimensionIcon
                            dimension="source"
                            value={user.source}
                          />
                          {label(user.source)}
                        </span>
                      </TableCell>
                      {active === "users" && enhancedUsers && <TableCell className="text-right text-xs tabular-nums">{num(user.events)}</TableCell>}
                      {showLearning && (["cards", "mastered", "due", "reviews"] as const).map((key) => <TableCell key={key} className="text-right text-xs tabular-nums">{num(user.learning?.[key])}</TableCell>)}
                      {moneyAvailable && <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        {formatAmount(
                          user.spentMinor,
                          report.currency,
                          report.currencyExponent,
                        )}
                      </TableCell>}
                      {active === "journeys" && (
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {completed && journey?.steps[0]
                            ? elapsedLabel(
                                user.firstSeen,
                                completed.occurredAt,
                              )
                            : "—"}
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {timeLabel(
                          active === "journeys" && completed
                            ? completed.occurredAt
                            : user.lastSeen,
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {users.length > pageSize && (
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  {safePage * pageSize + 1}–
                  {Math.min((safePage + 1) * pageSize, users.length)} из{" "}
                  {users.length}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Предыдущие пользователи"
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                  >
                    ←
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Следующие пользователи"
                    disabled={(safePage + 1) * pageSize >= users.length}
                    onClick={() => setPage(safePage + 1)}
                  >
                    →
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
        {(active === "users" || active === "journeys") && identity && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            {report.users.some((user) => user.profile) ? "Имена из локального профиля; без профиля показывается псевдоним." : "Псевдонимы событий."}{" "}
            {active === "journeys"
              ? `Пути доступны для ${report.journeys.length} пользователей; в каждом до 60 последних событий истории. До события — от начала наблюдаемой истории.`
              : enhancedUsers ? "События — за выбранный период; последняя активность — из всей наблюдаемой истории до его конца." : "Время визита относится к последнему событию в выбранном периоде."}
            {showLearning && ` Прогресс обучения — данные на ${report.learning?.capturedAt ? timeLabel(report.learning.capturedAt) + " UTC" : "неизвестную дату"}, за всю доступную историю.`}
            {!moneyAvailable && " Платёжные данные недоступны."}
          </p>
        )}
      </div>
    </Card>
  );
}
