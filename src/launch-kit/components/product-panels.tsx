import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { Badge } from "@launch-kit/components/ui/badge";
import { Button } from "@launch-kit/components/ui/button";
import { Card } from "@launch-kit/components/ui/card";
import { Input } from "@launch-kit/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@launch-kit/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@launch-kit/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@launch-kit/components/ui/chart";
import { Empty, label, num, pct } from "@launch-kit/components/dashboard-widgets";
import type { AnalyticsDataset, DashboardData, LearnerSnapshot } from "@launch-kit/lib/types";

const dateTime = (value: string | null | undefined) => value
  ? new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC"
  : "Не наблюдалось";
const dayLabel = (value: string) => new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const compact = (value: number) => new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value);

function ProductCard({ title, description, children, action }: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return <Card className="min-w-0 gap-4 rounded-3xl border-border/75 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
    {children}
  </Card>;
}

function Stat({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <div className="min-w-0 rounded-2xl border border-[#e9eff4] bg-[#f8fbfd] px-4 py-3">
    <p className="text-xs text-muted-foreground">{title}</p>
    <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
  </div>;
}

const activityMetrics = {
  active: { label: "Активные", color: "#89c8ff" },
  newUsers: { label: "Новые", color: "#a6d1ad" },
  reviews: { label: "Оценки", color: "#e9a28a" },
};
type ActivityMetric = keyof typeof activityMetrics;

export function GrowthPanel({ report, views = ["active_windows", "activity_trend"] }: {
  report: DashboardData;
  views?: string[];
}) {
  const [metric, setMetric] = useState<ActivityMetric>("active");
  const growth = report.growth;
  if (!growth) return <ProductCard title="Активность продукта"><Empty title="Активность не рассчитана" /></ProductCard>;
  return <ProductCard title="Активность продукта" description={`Окна активности заканчиваются ${dateTime(growth.asOf)}. Новые пользователи и график относятся к выбранному периоду.`}>
    {views.includes("active_windows") && <div className="grid gap-3 sm:grid-cols-3">
      <Stat title="DAU" value={num(growth.dau)} detail="Уникальные активные пользователи за последние 24 часа." />
      <Stat title="WAU" value={num(growth.wau)} detail="Уникальные активные пользователи за последние 7 дней." />
      <Stat title="Новые за период" value={num(growth.newUsers)} detail="Первый наблюдаемый вход в продукт в выбранном периоде." />
    </div>}
    {views.includes("activity_trend") && <div className="min-w-0">
      <Tabs value={metric} onValueChange={(value) => setMetric(value as ActivityMetric)}>
        <TabsList aria-label="Метрика активности" className="mb-3 h-9 rounded-full bg-[#f8f8f8]">
          {Object.entries(activityMetrics).map(([key, item]) => <TabsTrigger key={key} value={key} className="rounded-full text-xs">{item.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {growth.daily.length ? <ChartContainer config={activityMetrics} className="h-[240px] w-full" aria-label={`${activityMetrics[metric].label} по дням, UTC`}>
        <BarChart accessibilityLayer data={growth.daily} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="#e9e9e9" />
          <XAxis dataKey="date" tickFormatter={dayLabel} tickLine={false} axisLine={false} minTickGap={32} />
          <YAxis tickFormatter={compact} tickLine={false} axisLine={false} allowDecimals={false} width={38} />
          <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => dayLabel(String(value))} />} />
          <Bar dataKey={metric} fill={activityMetrics[metric].color} radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
        </BarChart>
      </ChartContainer> : <Empty />}
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">Дневная активность — уникальные пользователи; оценки — события принятых ответов. Дневных активных нельзя складывать в уникальных пользователей периода.</p>
      <details className="mt-3 border-t pt-2 text-xs">
        <summary className="w-fit cursor-pointer text-muted-foreground">Точные значения</summary>
        <div className="mt-2 max-h-64 overflow-auto"><Table>
          <TableHeader><TableRow><TableHead>Дата, UTC</TableHead><TableHead className="text-right">Новые</TableHead><TableHead className="text-right">Активные</TableHead><TableHead className="text-right">Оценки</TableHead></TableRow></TableHeader>
          <TableBody>{growth.daily.map((row) => <TableRow key={row.date}><TableCell>{dayLabel(row.date)}</TableCell><TableCell className="text-right tabular-nums">{num(row.newUsers)}</TableCell><TableCell className="text-right tabular-nums">{num(row.active)}</TableCell><TableCell className="text-right tabular-nums">{num(row.reviews)}</TableCell></TableRow>)}</TableBody>
        </Table></div>
      </details>
    </div>}
  </ProductCard>;
}

export function RetentionPanel({ report }: { report: DashboardData }) {
  const growth = report.growth;
  if (!growth) return <ProductCard title="Возвращаются к обучению"><Empty title="Когорты возврата не рассчитаны" /></ProductCard>;
  return <ProductCard title="Возвращаются к обучению" description="В знаменателе только пользователи, для которых полностью завершилось окно наблюдения. Точка отсчёта указана у каждого окна.">
    <div className="grid gap-3 sm:grid-cols-3">
      {[growth.d1, growth.d2, growth.d7].map((cohort, index) => <Stat
        key={cohort.label}
        title={cohort.label}
        value={pct(cohort.rate)}
        detail={`${num(cohort.count)} из ${num(cohort.eligible)} зрелых пользователей. ${index < 2 ? "Активность" : "Повторное целевое действие"} через [${cohort.startHours}, ${cohort.endHours}) ч после ${cohort.anchor === "first_value" ? "первого результата" : "первого входа"}. Ещё наблюдаем: ${num(cohort.immature)}.`}
      />)}
    </div>
    <p className="text-[10px] leading-relaxed text-muted-foreground">Каждое окно считается независимо; молодой пользователь не считается невозвратившимся. Наблюдение до {dateTime(growth.asOf)}.</p>
  </ProductCard>;
}

type SourceSort = "source" | "starts" | "eligible" | "activation" | "d1" | "d2" | "d7";

export function SourceQualityPanel({ report }: { report: DashboardData }) {
  const [sort, setSort] = useState<SourceSort>("starts");
  const [descending, setDescending] = useState(true);
  const [search, setSearch] = useState("");
  const growth = report.growth;
  if (!growth) return <ProductCard title="Качество источников"><Empty title="Когорты источников не рассчитаны" /></ProductCard>;
  const columns: { key: SourceSort; title: string }[] = [
    { key: "source", title: "Канал / источник" },
    { key: "starts", title: "Входы" },
    { key: "eligible", title: `Зрелые ${growth.activation.windowHours} ч` },
    { key: "activation", title: "Активация" },
    { key: "d1", title: "D1" }, { key: "d2", title: "D2" }, { key: "d7", title: "D7" },
  ];
  const value = (row: typeof growth.sourceQuality[number], key: SourceSort) => key === "source" ? `${row.channel} ${row.source}` : key === "starts" ? row.starts : key === "eligible" ? row.activation.eligible : row[key].rate;
  const rows = growth.sourceQuality.filter((row) => `${row.channel} ${row.source}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => {
    const left = value(a, sort);
    const right = value(b, sort);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    const difference = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
    return descending ? -difference : difference;
  });
  return <ProductCard title="Качество источников" description={`Первый канал × источник. Активация — зрелое окно ${growth.activation.windowHours} ч; у D1/D2/D7 свои зрелые знаменатели.`} action={<div className="relative w-48 max-w-full"><Search className="absolute left-2.5 top-2.5 size-3 text-muted-foreground" /><Input aria-label="Поиск источников" placeholder="Поиск источника" value={search} onChange={(event) => setSearch(event.target.value)} className="h-8 pl-8 text-xs" /></div>}>
    {rows.length ? <Table className="min-w-[780px]">
      <TableHeader><TableRow>{columns.map((column) => <TableHead key={column.key} className={column.key === "source" ? "" : "text-right"} aria-sort={sort === column.key ? descending ? "descending" : "ascending" : "none"}>
        <button className="inline-flex items-center gap-1 whitespace-nowrap py-2 text-xs" onClick={() => { if (sort === column.key) setDescending(!descending); else { setSort(column.key); setDescending(column.key !== "source"); } }}>
          {column.title}{sort === column.key && (descending ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
        </button>
      </TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((row) => <TableRow key={`${row.channel}:${row.source}`}>
        <TableCell><p className="text-xs font-medium">{label(row.source)}</p><p className="mt-1 text-[10px] text-muted-foreground">{label(row.channel)}</p></TableCell>
        <TableCell className="text-right text-xs tabular-nums">{num(row.starts)}</TableCell>
        <TableCell className="text-right text-xs tabular-nums">{num(row.activation.eligible)}<p className="mt-1 text-[10px] text-muted-foreground">Ещё {num(row.activation.immature)}</p></TableCell>
        {([row.activation, row.d1, row.d2, row.d7]).map((cohort, index) => <TableCell key={index} className="text-right text-xs tabular-nums"><p className="font-medium">{pct(cohort.rate)}</p><p className="mt-1 text-[10px] text-muted-foreground">{num(cohort.count)} / {num(cohort.eligible)}</p></TableCell>)}
      </TableRow>)}</TableBody>
    </Table> : <Empty title={search ? "Источники не найдены" : "Нет входов в этом периоде"} />}
    <p className="text-[10px] leading-relaxed text-muted-foreground">Под процентом — достигли / зрелые входы. Unknown сохраняется при неизвестном источнике; связь источника с результатом не доказывает причинность.</p>
    <p className="text-[10px] leading-relaxed text-muted-foreground">{[growth.d1, growth.d2, growth.d7].map((cohort) => `${cohort.label}: [${cohort.startHours}, ${cohort.endHours}) ч после ${cohort.anchor === "first_value" ? "первого результата" : "входа"}`).join(" · ")}</p>
  </ProductCard>;
}

type ReportUser = DashboardData["users"][number];
export const ownerUserName = (user: ReportUser) => user.profile?.displayName
  || (user.profile?.username ? `@${user.profile.username.replace(/^@/, "")}` : user.id);
const username = (user: ReportUser) => user.profile?.username
  ? `@${user.profile.username.replace(/^@/, "")}`
  : undefined;

const stateLabels: Record<string, string> = {
  new: "Новые", learning: "Изучаются", review: "Повторение", relearning: "Переучивание",
  suspended: "Приостановлены", mastered: "Освоены",
};
const ratingLabels: Record<string, string> = {
  again: "Снова", hard: "Трудно", good: "Хорошо", easy: "Легко",
  forgot: "Не вспомнил",
};

function Distribution({ title, rows, labels }: {
  title: string;
  rows: { key: string; count: number }[];
  labels: Record<string, string>;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return <div className="min-w-0 rounded-2xl border p-4">
    <h3 className="text-xs font-medium">{title}</h3>
    {rows.length ? <div className="mt-3 space-y-3">{rows.map((row) => <div key={row.key}>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span>{labels[row.key.toLowerCase()] ?? row.key}</span><span className="tabular-nums">{num(row.count)} <span className="text-muted-foreground">· {total ? pct(row.count / total * 100) : "—"}</span></span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#a9d9ff]" style={{ width: `${total ? row.count / total * 100 : 0}%` }} /></div>
    </div>)}</div> : <p className="mt-3 text-xs text-muted-foreground">Нет данных на дату обновления.</p>}
  </div>;
}

function ReviewDays({ rows }: { rows: LearnerSnapshot["reviewDays"] }) {
  const days = [...rows].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  return <div className="min-w-0 rounded-2xl border p-4">
    <h3 className="text-xs font-medium">Оценки по дням</h3>
    <p className="mt-1 text-[10px] text-muted-foreground">Последние 30 дней с оценками из всей доступной истории.</p>
    {days.length ? <>
      <ChartContainer config={{ count: { label: "Оценки", color: "#89c8ff" } }} className="mt-3 h-[170px] w-full" aria-label="История оценок по дням, UTC">
        <BarChart accessibilityLayer data={days} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 5" />
          <XAxis dataKey="date" tickFormatter={dayLabel} tickLine={false} axisLine={false} minTickGap={36} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={32} />
          <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => dayLabel(String(value))} />} />
          <Bar dataKey="count" fill="#89c8ff" radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <details className="mt-2 text-[11px] text-muted-foreground"><summary className="w-fit cursor-pointer">Точные значения</summary><dl className="mt-2 grid max-h-40 grid-cols-2 gap-x-5 gap-y-1 overflow-auto">{days.map((row) => <div key={row.date} className="contents"><dt>{row.date}</dt><dd className="text-right tabular-nums">{num(row.count)}</dd></div>)}</dl></details>
    </> : <p className="py-8 text-center text-xs text-muted-foreground">Оценок в доступной истории пока нет.</p>}
  </div>;
}

function UserLearning({ learner, capturedAt }: { learner: LearnerSnapshot; capturedAt?: string }) {
  return <section className="space-y-4" aria-label="Накопленный прогресс ученика">
    <div><h3 className="text-sm font-semibold">Прогресс на дату обновления</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Данные на {dateTime(capturedAt)} за всю доступную историю. Прогресс не ограничен выбранным периодом активности.</p></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {[
        ["Карточки", learner.cards, "В коллекции ученика."],
        ["XP", learner.xp, "Личный игровой прогресс."],
        ["Знакомые", learner.familiar, "Словарные единицы по правилам продукта."],
        ["Освоенные", learner.mastered, "Словарные единицы по правилам продукта."],
        ["К повторению", learner.due, "На дату обновления данных."],
        ["Оценки", learner.reviews, "Все принятые оценки в доступной истории."],
        ["Lapses", learner.lapses, "Накопленные срывы повторения."],
      ].map(([title, value, detail]) => <Stat key={String(title)} title={String(title)} value={num(Number(value))} detail={String(detail)} />)}
    </div>
    <dl className="grid gap-2 text-xs sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Первая карточка</dt><dd className="mt-1">{dateTime(learner.firstCardAt)}</dd></div>
      <div><dt className="text-muted-foreground">Последняя оценка</dt><dd className="mt-1">{dateTime(learner.lastReviewedAt)}</dd></div>
    </dl>
    <ReviewDays rows={learner.reviewDays} />
    <div className="grid gap-3 sm:grid-cols-2"><Distribution title="Состояния карточек" rows={learner.states} labels={stateLabels} /><Distribution title="Распределение оценок" rows={learner.ratings} labels={ratingLabels} /></div>
    <div className="rounded-2xl border p-4">
      <h3 className="text-xs font-medium">Наборы ученика</h3>
      {learner.packs.length ? <Table className="mt-2"><TableHeader><TableRow><TableHead>Набор</TableHead><TableHead className="text-right">Карточки</TableHead><TableHead className="text-right">Добавлен</TableHead></TableRow></TableHeader><TableBody>{learner.packs.map((pack, index) => <TableRow key={`${pack.title}-${index}`}><TableCell className="max-w-52 whitespace-normal text-xs">{pack.title}</TableCell><TableCell className="text-right text-xs tabular-nums">{num(pack.cards)}</TableCell><TableCell className="text-right text-[11px] text-muted-foreground">{dateTime(pack.addedAt)}</TableCell></TableRow>)}</TableBody></Table> : <p className="mt-3 text-xs text-muted-foreground">Наборы не добавлены или не представлены в выгрузке.</p>}
    </div>
  </section>;
}

const eventLabels: Record<string, string> = {
  page_viewed: "Просмотр страницы", product_entered: "Первый вход", registered: "Регистрация",
  first_value: "Первый результат", value_repeated: "Повторный результат", goal_completed: "Достигнута цель",
  checkout_started: "Checkout", payment_succeeded: "Оплата", payment_refunded: "Возврат",
  session_activity: "Активность", outbound_clicked: "Переход по ссылке",
  email_sent: "Email отправлен", email_delivered: "Email доставлен", email_clicked: "Клик в email",
};

export function UserProfilePanel({ report, userId, learningEnabled = true }: {
  report: DashboardData;
  userId: string;
  learningEnabled?: boolean;
}) {
  const user = report.users.find((item) => item.id === userId);
  if (!user) return <Empty title="Пользователь не найден в этом срезе">Измените источник или период.</Empty>;
  const journey = report.journeys.find((item) => item.id === user.id);
  const profile = user.profile;
  const eventLabel = (event: NonNullable<typeof journey>["steps"][number]) => report.measurement?.funnel.steps.find((step) => step.event === event.name && step.goal === event.goal)?.label ?? event.goal ?? eventLabels[event.name] ?? event.name;
  const facts = [
    ["Источник", label(user.source)],
    ["Первый вход в продукт", dateTime(user.firstEntryAt)],
    ["Начало наблюдаемой истории", dateTime(user.firstSeen)],
    ["Последняя активность до конца периода", dateTime(user.lastSeen)],
    ["Создан профиль", dateTime(profile?.createdAt)],
    ["Onboarding", profile ? profile.onboardingCompletedAt ? `Завершён · ${dateTime(profile.onboardingCompletedAt)}` : "Не завершён на дату обновления" : "Нет данных"],
    ["Напоминания", profile?.reminders ? profile.reminders.enabled ? `Включены · ${profile.reminders.time} · ${profile.reminders.timezone}` : "Выключены" : "Нет данных"],
  ];
  return <div className="space-y-6">
    <section>
      <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h2 className="break-words text-xl font-semibold tracking-tight">{ownerUserName(user)}</h2>{username(user) && profile?.displayName && <p className="mt-1 text-sm text-muted-foreground">{username(user)}</p>}<p className="mt-1 break-all text-[10px] text-muted-foreground">ID: {user.id}</p></div>{profile?.locale && <Badge variant="outline">{profile.locale}</Badge>}</div>
      {profile && <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Профиль, onboarding и напоминания: данные на {dateTime(user.profileCapturedAt)}.</p>}
      <dl className="mt-4 grid gap-x-5 gap-y-4 text-xs sm:grid-cols-2">{facts.map(([title, value]) => <div key={title}><dt className="text-muted-foreground">{title}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl>
    </section>
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Наблюдаемая активность</h3>
      <div className="grid grid-cols-2 gap-3"><Stat title="События за период" value={num(user.events)} detail={`${dayLabel(report.range.from)} — ${dayLabel(new Date(Date.parse(report.range.to) - 1).toISOString())}, UTC.`} /><Stat title="События в истории" value={num(user.lifetimeEvents)} detail={`До ${dateTime(report.range.to)}; история может начинаться позже регистрации.`} /></div>
    </section>
    {learningEnabled && (user.learning ? <UserLearning learner={user.learning} capturedAt={user.learningCapturedAt} /> : <section className="rounded-2xl border p-4"><h3 className="text-sm font-medium">Прогресс обучения недоступен</h3><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Для этого пользователя нет данных обучения на выбранную дату. Текущие значения не подставляются в прошлый период.</p></section>)}
    <section>
      <h3 className="text-sm font-semibold">История событий</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">До {dateTime(report.range.to)}. {journey?.truncated ? `Показаны последние ${journey.steps.length} из ${journey.totalSteps} событий.` : `Показано ${num(journey?.totalSteps)} событий.`} История не ограничена началом выбранного периода.</p>
      {journey?.steps.length ? <ol className="mt-4 space-y-0">{[...journey.steps].reverse().map((step, index) => <li key={`${step.occurredAt}-${index}`} className="relative ml-2 border-l py-3 pl-5"><span aria-hidden="true" className="absolute top-4 -left-1 size-2 rounded-full bg-[#89c8ff]" /><p className="text-xs font-medium">{eventLabel(step)}</p><p className="mt-1 text-[10px] text-muted-foreground">{dateTime(step.occurredAt)}</p>{step.route && <p className="mt-1 break-words text-[10px] text-muted-foreground">{step.route}</p>}</li>)}</ol> : <p className="mt-4 text-xs text-muted-foreground">Событий до конца выбранного периода нет.</p>}
    </section>
  </div>;
}

type LearnerSort = "reviews" | "cards" | "mastered" | "due";

export function LearningPanel({ report, dataset, onUser, views = ["learning_overview", "learner_progress"] }: {
  report: DashboardData;
  dataset?: AnalyticsDataset;
  onUser: (id: string) => void;
  views?: string[];
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<LearnerSort>("reviews");
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(0);
  const learning = report.learning;
  if (!learning) return <ProductCard title="Прогресс обучения"><Empty title="Нет данных обучения для этого периода">{dataset?.learning ? `Доступны данные на ${dateTime(dataset.learning.capturedAt)}. Выберите период, заканчивающийся не раньше этой даты.` : "Подключите данные карточек и истории обучения."}</Empty></ProductCard>;
  const learners = report.users.filter((user) => user.learning && `${ownerUserName(user)} ${username(user) ?? ""} ${user.id}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => ((a.learning?.[sort] ?? 0) - (b.learning?.[sort] ?? 0)) * (descending ? -1 : 1));
  const pageSize = 8;
  const safePage = Math.min(page, Math.max(0, Math.ceil(learners.length / pageSize) - 1));
  const sortColumn = (key: LearnerSort) => { if (sort === key) setDescending(!descending); else { setSort(key); setDescending(true); } setPage(0); };
  return <ProductCard title="Прогресс обучения" description={`Данные на ${dateTime(learning.capturedAt)} для выбранных источников. Карточки и оценки за всю доступную историю; активность периода показана отдельно выше.`}>
    {views.includes("learning_overview") && <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat title="Ученики" value={num(learning.learners)} detail="Пользователи с данными обучения на дату обновления." />
        <Stat title="Карточки" value={num(learning.cards)} detail="Карточки в коллекциях этих учеников." />
        <Stat title="Оценки" value={num(learning.reviews)} detail="Накопленные принятые ответы учеников." />
        <Stat title="Знакомые" value={num(learning.familiar)} detail="Словарные единицы по правилам продукта." />
        <Stat title="Освоенные" value={num(learning.mastered)} detail="Словарные единицы по правилам продукта." />
        <Stat title="К повторению" value={num(learning.due)} detail="Состояние на дату обновления данных." />
      </div>
      <ReviewDays rows={learning.reviewDays} />
    </>}
    {views.includes("learner_progress") && <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="text-xs font-medium">Ученики · накопленный прогресс</h3><div className="relative w-56 max-w-full"><Search className="absolute left-2.5 top-2.5 size-3 text-muted-foreground" /><Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Имя, username или ID" aria-label="Поиск учеников по прогрессу" className="h-8 pl-8 text-xs" /></div></div>
      {learners.length ? <Table className="min-w-[660px]"><TableHeader><TableRow><TableHead>Ученик</TableHead>{([{ key: "cards", title: "Карточки" }, { key: "mastered", title: "Освоенные" }, { key: "due", title: "К повторению" }, { key: "reviews", title: "Оценки" }] as const).map((column) => <TableHead key={column.key} className="text-right" aria-sort={sort === column.key ? descending ? "descending" : "ascending" : "none"}><button className="inline-flex items-center gap-1 whitespace-nowrap py-2 text-xs" onClick={() => sortColumn(column.key)}>{column.title}{sort === column.key && (descending ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}</button></TableHead>)}<TableHead className="text-right">Последняя оценка</TableHead></TableRow></TableHeader><TableBody>{learners.slice(safePage * pageSize, (safePage + 1) * pageSize).map((user) => <TableRow key={user.id}><TableCell><button onClick={() => onUser(user.id)} className="max-w-52 truncate text-left text-xs font-medium underline-offset-4 hover:underline" title={user.id}>{ownerUserName(user)}</button>{username(user) && user.profile?.displayName && <p className="mt-1 text-[10px] text-muted-foreground">{username(user)}</p>}</TableCell>{(["cards", "mastered", "due", "reviews"] as const).map((key) => <TableCell key={key} className="text-right text-xs tabular-nums">{num(user.learning?.[key])}</TableCell>)}<TableCell className="text-right text-[11px] text-muted-foreground">{dateTime(user.learning?.lastReviewedAt)}</TableCell></TableRow>)}</TableBody></Table> : <Empty title="Ученики не найдены" />}
      {learners.length > pageSize && <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, learners.length)} из {learners.length}</span><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={safePage === 0} aria-label="Предыдущие ученики" onClick={() => setPage(safePage - 1)}>←</Button><Button size="sm" variant="ghost" disabled={(safePage + 1) * pageSize >= learners.length} aria-label="Следующие ученики" onClick={() => setPage(safePage + 1)}>→</Button></div></div>}
    </div>}
  </ProductCard>;
}
