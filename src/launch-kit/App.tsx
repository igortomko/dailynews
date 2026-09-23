import { GrowthPanel, RetentionPanel, SourceQualityPanel, LearningPanel, UserProfilePanel } from "@launch-kit/components/product-panels";
import { ReferenceSummary } from "@launch-kit/components/reference-summary";
import { ReferenceOverview } from "@launch-kit/components/reference-overview";
import { ReferenceBreakdownCard } from "@launch-kit/components/reference-breakdowns";
import { ReferenceBehavior } from "@launch-kit/components/reference-behavior";
import { ReferenceCrawlers } from "@launch-kit/components/reference-crawlers";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronLeft,
  Lightbulb,
  BarChart3,
  Check,
  ChevronRight,
  Download,
  Link2,
  Loader2,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import { toPng } from "html-to-image";
import { Button } from "@launch-kit/components/ui/button";
import { Badge } from "@launch-kit/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@launch-kit/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@launch-kit/components/ui/sheet";
import { Switch } from "@launch-kit/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@launch-kit/components/ui/table";
import {
  Empty,
  Metric,
  Panel,
  label,
  num,
  pct,
} from "@launch-kit/components/dashboard-widgets";
import { LinkBuilder } from "@launch-kit/components/link-builder";
import { CostsPanel } from "@launch-kit/components/costs-panel";
import { DashboardSkeleton } from "@launch-kit/components/dashboard-skeleton";
import { PlacementsPanel } from "@launch-kit/components/placements-panel";
import { buildCosts } from "@launch-kit/lib/costs";
import { buildDashboard, formatAmount, validateDataset } from "@launch-kit/lib/data";
import { makeDemoDataset } from "@launch-kit/lib/demo";
import {
  getJson,
  connectedViews,
  moduleInfo,
  viewLabels,
  withDependencies,
  type Config,
  type Selection,
} from "@launch-kit/lib/config";
import type {
  AnalyticsDataset,
  AnalyticsFilters,
  Dimension,
} from "@launch-kit/lib/types";

const profileLabels: Record<string, string> = {
  saas: "SaaS",
  mobile: "Mobile",
  telegram: "Telegram",
  desktop: "Desktop",
  api: "API",
};
const capabilityLabels: Record<string, string> = {
  sessions: "Сессии",
  payments: "Платежи",
  identity: "Связь пользователей",
  lifecycle: "Email lifecycle",
  crawlers: "Серверные боты",
  geography: "География",
};
function Picker({
  value,
  onChange,
  label: title,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={title} className="max-w-52 bg-white text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function ModulePicker({
  config,
  dataset,
  open,
  onOpenChange,
  onSave,
}: {
  config: Config;
  dataset: AnalyticsDataset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (selection: Selection) => Promise<void>;
}) {
  const [draft, setDraft] = useState(config.selection);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setDraft(config.selection);
      setError("");
    }
  }, [open, config.selection]);
  function preset(name: string) {
    setDraft(
      withDependencies(
        {
          ...draft,
          preset: name,
          selected_modules: config.catalog.presets[name],
          view_choices: config.catalog.preset_view_choices?.[name] ?? {},
          excluded_modules: {},
          provenance: "user",
        },
        config.catalog,
      ),
    );
  }
  function toggle(id: string, checked: boolean) {
    const next: Selection = {
      ...draft,
      preset: "custom",
      provenance: "user",
      view_choices: { ...draft.view_choices },
      selected_modules: checked
        ? [...draft.selected_modules, id]
        : draft.selected_modules.filter((item) => item !== id),
      excluded_modules: { ...draft.excluded_modules },
    };
    if (checked) {
      const module = config.catalog.modules.find((item) => item.id === id);
      next.view_choices[id] = module?.runtime_views ?? module?.views ?? [];
      setDraft(withDependencies(next, config.catalog));
      return;
    }
    next.excluded_modules[id] = "Excluded by owner in dashboard";
    const removed = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const module of config.catalog.modules)
        if (
          next.selected_modules.includes(module.id) &&
          module.depends_on.some((dependency) => removed.has(dependency))
        ) {
          next.selected_modules = next.selected_modules.filter(
            (item) => item !== module.id,
          );
          removed.add(module.id);
          changed = true;
        }
    }
    for (const module of config.catalog.modules) {
      if (removed.has(module.id)) delete next.view_choices[module.id];
      else if (next.selected_modules.includes(module.id))
        next.view_choices[module.id] = (
          next.view_choices[module.id] ?? module.views
        ).filter(
          (view) =>
            !(module.view_dependencies?.[view] ?? []).some((dep) =>
              removed.has(dep),
            ),
        );
    }
    setDraft(next);
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader className="border-b p-6">
          <SheetTitle>Ваш dashboard</SheetTitle>
          <SheetDescription>
            Подключите готовые блоки. Выбор сохраняется в проекте; подключение
            данных — отдельный шаг.
          </SheetDescription>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ["minimum", "Минимум"],
              ["acquisition", "Привлечение"],
              ["all", "Все блоки"],
            ].map(([id, title]) => (
              <Button
                key={id}
                size="sm"
                variant={draft.preset === id ? "default" : "outline"}
                onClick={() => preset(id)}
              >
                {title}
              </Button>
            ))}
          </div>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-6">
          <p className="mb-5 text-xs text-muted-foreground">
            Realtime исключён: без глобуса, online и ленты событий. Зависимости
            блоков подключаются вместе с ними.
          </p>
          <div className="divide-y">
            {config.catalog.modules
              .filter((module) => module.id !== "realtime")
              .map((module) => {
                const info = moduleInfo[module.id];
                if (!info) return null;
                const selected = draft.selected_modules.includes(module.id);
                const requested = draft.view_choices[module.id] ?? module.views;
                const supported = connectedViews(dataset, module.id, requested);
                const hidden = requested.filter(view => !supported.includes(view));
                return (
                  <div key={module.id} className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <label
                        htmlFor={`module-${module.id}`}
                        className="cursor-pointer"
                      >
                        <p className="text-sm font-medium">{info.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {info.description}
                        </p>
                        {selected && hidden.length > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Пока нет данных: {hidden.map(view => viewLabels[view] ?? view).join(", ")}. Эти представления скрыты.
                          </p>
                        )}
                      </label>
                      <Switch
                        id={`module-${module.id}`}
                        checked={selected}
                        onCheckedChange={(checked) =>
                          toggle(module.id, checked)
                        }
                      />
                    </div>
                    {selected && (
                      <details className="mt-3 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          Состав блока
                        </summary>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {module.views.map((view) => {
                            const ready = (
                              module.runtime_views ?? module.views
                            ).includes(view);
                            const checked = (
                              draft.view_choices[module.id] ?? module.views
                            ).includes(view);
                            return (
                              <label
                                key={view}
                                className={`flex items-center gap-2 ${ready ? "" : "text-muted-foreground"}`}
                              >
                                <input
                                  type="checkbox"
                                  className="accent-[#405d34]"
                                  checked={checked}
                                  disabled={!ready}
                                  onChange={(e) => {
                                    const views =
                                      draft.view_choices[module.id] ??
                                      module.views;
                                    const next = {
                                      ...draft,
                                      preset: "custom",
                                      provenance: "user",
                                      view_choices: {
                                        ...draft.view_choices,
                                        [module.id]: e.target.checked
                                          ? [...views, view]
                                          : views.filter(
                                              (item) => item !== view,
                                            ),
                                      },
                                    };
                                    setDraft(
                                      withDependencies(next, config.catalog),
                                    );
                                  }}
                                />
                                <span>
                                  {viewLabels[view] ?? view}
                                  {!ready && " · позже"}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
        <div className="border-t p-6">
          <p role="alert" className="mb-2 text-xs text-destructive">
            {error}
          </p>
          <Button
            className="w-full"
            disabled={saving || draft.selected_modules.length === 0}
            onClick={() => void save()}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Сохранить · {draft.selected_modules.length} блоков
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [dataset, setDataset] = useState<AnalyticsDataset | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("dashboard");
  // Product, model spend and acquisition links are separate areas, shown only
  // when the dataset carries the extension; a product without them sees no tabs.
  const [area, setArea] = useState<"product" | "costs" | "links">("product");
  const dashboardScroll = useRef(0);
  function openSection(next: string) {
    if (section === "dashboard") dashboardScroll.current = window.scrollY;
    setSection(next);
    requestAnimationFrame(() =>
      window.scrollTo({
        top: next === "dashboard" ? dashboardScroll.current : 0,
      }),
    );
  }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))
      )
        return;
      if (
        document.querySelector('[role="dialog"]') ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === "Escape" && section !== "dashboard")
        openSection("dashboard");
      if (
        event.key.toLowerCase() === "i" &&
        config?.selection.selected_modules.includes("summary")
      )
        openSection(section === "report" ? "dashboard" : "report");
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [section, config]);
  const [filters, setFilters] = useState<AnalyticsFilters>({ rangeDays: 30 });
  const [modulesOpen, setModulesOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  // On by default: an owner leaves this tab open, and a dashboard that needs a
  // click to show today's numbers shows yesterday's. Runs only while visible.
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshBusy = useRef(false);
  async function refresh(fromSource = false) {
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    setLoading(true);
    setError("");
    try {
      if (fromSource && config?.refresh?.available) {
        await getJson("/api/refresh", { method: "POST", headers: { "X-CSRF-Token": config.csrfToken }, body: "{}" });
      }
      const [nextConfig, raw] = await Promise.all([
        getJson<Config>("/api/config"),
        getJson<unknown>("/api/dataset"),
      ]);
      const parsed = validateDataset(raw);
      const nextDataset =
        parsed.mode === "demo"
          ? {
              ...makeDemoDataset(nextConfig.product.profile),
              product: nextConfig.product,
            }
          : parsed;
      setConfig(nextConfig);
      setDataset(nextDataset);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось загрузить данные",
      );
    } finally {
      refreshBusy.current = false;
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!autoRefresh || !config?.refresh?.available) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, config?.csrfToken, config?.refresh?.available]);
  const calculated = useMemo(() => {
    if (!dataset) return { report: null, unfiltered: null, error: "" };
    try {
      const report = buildDashboard(dataset, filters);
      const start = Date.parse(report.range.from);
      const end = Date.parse(report.range.to);
      const previousStart = start - (end - start);
      const observedStart = Math.min(
        ...dataset.events.map((event) => Date.parse(event.occurredAt)),
      );
      return {
        report,
        previous:
          observedStart <= previousStart
            ? buildDashboard(dataset, {
                ...filters,
                from: new Date(previousStart).toISOString(),
                to: report.range.from,
              })
            : undefined,
        unfiltered: buildDashboard(dataset, {
          rangeDays: filters.rangeDays,
          from: filters.from,
          to: filters.to,
        }),
        error: "",
      };
    } catch (err) {
      return {
        report: null,
        unfiltered: null,
        error: `Ошибка качества данных: ${err instanceof Error ? err.message : "некорректный набор"}`,
      };
    }
  }, [dataset, filters]);
  const { report, unfiltered } = calculated;
  if ((!config || !dataset) && !error) return <DashboardSkeleton />;
  if (!config || !dataset || !report || !unfiltered)
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center">
          <BarChart3 className="mx-auto mb-5 size-9 text-primary" />
          <h1 className="text-lg font-semibold">Launch Kit Analytics</h1>
          <p role="alert" className="my-4 text-sm text-muted-foreground">
            {error || calculated.error || "Загружаем конфигурацию и данные…"}
          </p>
          {(error || calculated.error) && (
            <>
              <p className="mb-4 text-xs text-muted-foreground">
                Исправьте источник событий и повторите загрузку. Демо не
                подменяет реальные данные.
              </p>
              <Button onClick={() => void refresh()}>Повторить</Button>
            </>
          )}
        </div>
      </div>
    );
  const views = (id: string) => {
    const module = config.catalog.modules.find((item) => item.id === id);
    if (!config.selection.selected_modules.includes(id)) return [];
    return connectedViews(dataset, id, (config.selection.view_choices[id] ?? module?.views ?? []).filter(
      view => (module?.runtime_views ?? module?.views ?? []).includes(view),
    ));
  };
  const enabled = (id: string) => views(id).length > 0;
  const hasView = (id: string, view: string) => views(id).includes(view);
  const measurement = report.measurement;
  const isMeasurementSnapshot = dataset.mode === "local" && Boolean(measurement);
  const moneyAvailable = report.overview.payers !== null;
  const snapshotDate = new Date(dataset.generatedAt).toLocaleString("ru-RU", {
    timeZone: "UTC",
  });
  const filterDimension = (dimension: Dimension, value: string) => {
    if (["source", "country", "device", "campaign"].includes(dimension))
      setFilters({ ...filters, [dimension]: value });
  };
  const retention = (
    <Panel
      title={measurement?.retention.label ?? "Возвращаются за результатом"}
      description={measurement
        ? `Принятая оценка через ${measurement.retention.startHours}–${measurement.retention.endHours} ч после первого входа`
        : "Повторное полезное действие через 24 часа — 7 дней"}
    >
      <div className="flex items-end gap-3">
        <p className="tabular text-4xl font-semibold tracking-tight text-primary">
          {pct(report.retention.rate)}
        </p>
        <p className="mb-1 text-xs text-muted-foreground">
          {num(report.retention.returned)} из {num(report.retention.eligible)}
          <br />
          зрелых пользователей
        </p>
      </div>
      <div className="mt-5 h-2 rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary/60"
          style={{ width: `${report.retention.rate ?? 0}%` }}
        />
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        {measurement
          ? `Когорта первого входа. В расчёте только ученики с полными ${measurement.retention.endHours} ч наблюдения; более молодые когорты исключены.`
          : "От первого результата, а не от регистрации. Молодые когорты и открытие email в расчёт не входят."}
      </p>
    </Panel>
  );
  async function exportPng() {
    const node = document.getElementById("summary");
    if (!node) return;
    setExporting(true);
    setExportStatus("");
    try {
      const url = await toPng(node, {
        backgroundColor: "#faf9f8",
        pixelRatio: 2,
        filter: (element) => !element.hasAttribute?.("data-no-export"),
      });
      const link = document.createElement("a");
      link.href = url;
      link.download = "product-summary.png";
      link.click();
      setExportStatus("PNG сохранён. Файл содержит только видимые агрегаты.");
    } catch (err) {
      setExportStatus(
        `Экспорт не удался: ${err instanceof Error ? err.message : "ошибка браузера"}. Доступна печать в PDF.`,
      );
    } finally {
      setExporting(false);
    }
  }

  const tabsFor = (
    items: {
      id: string;
      label: string;
      dimension: Dimension;
      module: string;
      view: string;
      kind?: "donut" | "list";
    }[],
  ) => items.filter((item) => hasView(item.module, item.view));
  const acquisitionTabs = tabsFor([
    {
      id: "channel",
      label: "Channel",
      dimension: "medium",
      module: "channels",
      view: hasView("channels", "channel_share")
        ? "channel_share"
        : "channel_table",
      kind: hasView("channels", "channel_share") ? "donut" : "list",
    },
    {
      id: "referrer",
      label: "Referrer",
      dimension: "source",
      module: "referrers",
      view: "referrer_table",
    },
    {
      id: "campaign",
      label: "Campaign",
      dimension: "campaign",
      module: "campaigns",
      view: "campaign",
    },
    {
      id: "keyword",
      label: "Keyword",
      dimension: "term",
      module: "keywords",
      view: "campaign_terms",
    },
    {
      id: "content",
      label: "Content",
      dimension: "content",
      module: "campaigns",
      view: "content",
    },
    ...(!hasView("referrers", "referrer_table")
      ? [
          {
            id: "source",
            label: "Source",
            dimension: "source" as const,
            module: "campaigns",
            view: "source",
          },
        ]
      : []),
    ...(!enabled("channels")
      ? [
          {
            id: "medium",
            label: "Medium",
            dimension: "medium" as const,
            module: "campaigns",
            view: "medium",
          },
        ]
      : []),
  ]);
  const geoTabs = tabsFor([
    {
      id: "country",
      label: "Country",
      dimension: "country",
      module: "geography",
      view: "country",
    },
    {
      id: "region",
      label: "Region",
      dimension: "region",
      module: "geography",
      view: "region",
    },
    {
      id: "city",
      label: "City",
      dimension: "city",
      module: "geography",
      view: "city",
    },
  ]);
  const pageTabs = tabsFor([
    {
      id: "hostname",
      label: "Hostname",
      dimension: "hostname",
      module: "pages",
      view: "hostname",
    },
    {
      id: "page",
      label: "Page",
      dimension: "route",
      module: "pages",
      view: "page",
    },
  ]);
  const techTabs = tabsFor([
    {
      id: "browser",
      label: "Browser",
      dimension: "browser",
      module: "technology",
      view: "browser",
    },
    {
      id: "os",
      label: "OS",
      dimension: "os",
      module: "technology",
      view: "os",
    },
    {
      id: "device",
      label: "Device",
      dimension: "device",
      module: "technology",
      view: "device",
    },
  ]);
  function shiftPeriod(direction: number) {
    if (!report || !dataset) return;
    const duration =
      Date.parse(report.range.to) - Date.parse(report.range.from);
    const to = Math.min(
      Date.parse(dataset.generatedAt),
      Date.parse(report.range.to) + direction * duration,
    );
    setFilters({
      ...filters,
      from: to === Date.parse(dataset.generatedAt) ? undefined : new Date(to - duration).toISOString(),
      to: to === Date.parse(dataset.generatedAt) ? undefined : new Date(to).toISOString(),
    });
  }
  const period = (
    <div className="flex min-w-0 items-center rounded-lg border bg-white shadow-xs">
      <Button
        variant="ghost"
        size="icon"
        className="rounded-r-none"
        aria-label="Предыдущий период"
        onClick={() => shiftPeriod(-1)}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Picker
        label="Период"
        value={String(filters.rangeDays ?? 30)}
        onChange={(value) =>
          setFilters({
            ...filters,
            rangeDays: Number(value),
            from: undefined,
            to: undefined,
          })
        }
        options={[
          { value: "7", label: filters.from ? "7 дней" : "Последние 7 дней" },
          { value: "30", label: filters.from ? "30 дней" : "Последние 30 дней" },
          { value: "90", label: filters.from ? "90 дней" : "Последние 90 дней" },
        ]}
      />
      <Button
        variant="ghost"
        size="icon"
        className="rounded-l-none"
        aria-label="Следующий период"
        disabled={
          Date.parse(report.range.to) >= Date.parse(dataset.generatedAt)
        }
        onClick={() => shiftPeriod(1)}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
  const areas = [
    { id: "product" as const, label: "Продукт" },
    ...(dataset.modelCosts ? [{ id: "costs" as const, label: "Расходы" }] : []),
    ...(dataset.placements ? [{ id: "links" as const, label: "Ссылки" }] : []),
  ];
  const areaNav = areas.length > 1 && section !== "report" ? (
    <nav className="mb-5 flex gap-1" aria-label="Разделы дашборда" data-no-export>
      {areas.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={area === item.id ? "page" : undefined}
          onClick={() => { setArea(item.id); window.scrollTo({ top: 0 }); }}
          className={`rounded-lg px-3 py-1.5 text-sm ${area === item.id ? "bg-white font-medium shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
        >
          {item.label}
        </button>
      ))}
    </nav>
  ) : null;
  const subjectLabel = (id: string) => dataset.profiles?.find((profile) => profile.subjectId === id)?.displayName ?? id;
  const costs = area === "costs" ? buildCosts(dataset, report.range.from, report.range.to) : null;
  if ((area === "costs" && costs) || (area === "links" && dataset.placements))
    return (
      <div className="min-h-screen">
        <main className="analytics-page mx-auto min-w-0 max-w-[1160px] px-3 pb-24 pt-7 sm:px-6 sm:pt-12">
          {areaNav}
          <header className="mb-5 flex flex-wrap items-center gap-3 sm:gap-4">
            <h1 className="mr-1 inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-base font-semibold tracking-tight shadow-xs">
              <BarChart3 className="size-5" />
              {config.product.name}
            </h1>
            {area === "costs" && period}
          </header>
          {costs ? (
            <CostsPanel report={costs} days={report.range.days} subjectLabel={subjectLabel} />
          ) : (
            <PlacementsPanel dataset={dataset} mint={config.placements?.mint === true} csrfToken={config.csrfToken} onChanged={() => refresh()} />
          )}
        </main>
      </div>
    );
  return (
    <div className="min-h-screen">
      <main
        className={`analytics-page mx-auto min-w-0 px-3 pb-24 pt-7 sm:px-6 sm:pt-12 ${section === "report" ? "max-w-[1600px]" : "max-w-[1160px]"}`}
      >
        {areaNav}
        <header className="mb-5 flex flex-wrap items-center gap-3 sm:gap-4">
          {section !== "dashboard" ? (
            <Button
              variant="outline"
              size="icon"
              aria-label="Вернуться к дашборду"
              onClick={() => openSection("dashboard")}
            >
              <X className="size-4" />
            </Button>
          ) : null}
          <h1 className="mr-1 inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-base font-semibold tracking-tight shadow-xs">
            <BarChart3 className="size-5" />
            {config.product.name}
          </h1>
          {section !== "links" && period}
          {section === "dashboard" && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              По дням
            </span>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label={config.refresh?.available ? "Обновить из базы" : "Обновить данные"}
            title={config.refresh?.available ? "Прочитать свежие данные продукта" : "Перечитать доступные данные"}
            disabled={loading}
            onClick={() => void refresh(true)}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {config.refresh?.available && (
            <Button variant="outline" size="sm" aria-pressed={autoRefresh} onClick={() => setAutoRefresh(!autoRefresh)}>
              {autoRefresh ? "Авто · 1 мин" : "Автообновление выкл."}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1">
            {enabled("link_builder") && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Ссылки кампаний"
                title="Ссылки кампаний"
                onClick={() =>
                  openSection(section === "links" ? "dashboard" : "links")
                }
              >
                <Link2 className="size-4" />
              </Button>
            )}
            {enabled("data_health") && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Состояние данных"
                title="Состояние данных"
                onClick={() =>
                  openSection(section === "health" ? "dashboard" : "health")
                }
              >
                <Activity className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Выбрать блоки"
              title="Выбрать блоки"
              onClick={() => setModulesOpen(true)}
            >
              <Settings2 className="size-4" />
            </Button>
          </div>
        </header>
        <div className="analytics-content space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"
            >
              Не удалось обновить: {error}. Ниже показаны предыдущие данные.
            </div>
          )}
          <div className="dashboard-context flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-muted-foreground">
            <span>
              {config.mode === "demo"
                ? "Демо · синтетические данные"
                : `${config.refresh?.available ? "Данные из базы" : "Локальный snapshot"} · ${snapshotDate} UTC`}{" "}
              · {profileLabels[config.product.profile]}
            </span>
            {section !== "links" && (
              <>
                <Picker
                  label="Источник"
                  value={filters.source ?? "__all__"}
                  onChange={(value) =>
                    setFilters({
                      ...filters,
                      source: value === "__all__" ? undefined : value,
                    })
                  }
                  options={[
                    { value: "__all__", label: "Все источники" },
                    ...unfiltered.breakdowns.source.map((row) => ({
                      value: row.key,
                      label: label(row.key),
                    })),
                  ]}
                />
                {moneyAvailable && <Picker
                  label="Валюта"
                  value={filters.currency ?? dataset.product.currency}
                  onChange={(value) =>
                    setFilters({ ...filters, currency: value })
                  }
                  options={[
                    ...new Set([
                      dataset.product.currency,
                      ...dataset.events
                        .map((event) => event.currency)
                        .filter((currency): currency is string =>
                          Boolean(currency),
                        ),
                    ]),
                  ].map((currency) => ({ value: currency, label: currency }))}
                />}
                <span>
                  {report.range.from.slice(0, 10)} —{" "}
                  {report.range.to.slice(0, 10)} · UTC
                </span>
                {(["source", "country", "device", "campaign"] as const)
                  .filter((key) => filters[key])
                  .map((key) => (
                    <Button
                      key={key}
                      size="sm"
                      variant="secondary"
                      className="h-6 text-[11px]"
                      onClick={() =>
                        setFilters({ ...filters, [key]: undefined })
                      }
                    >
                      {label(filters[key]!)}
                      <X className="size-3" />
                    </Button>
                  ))}
              </>
            )}
          </div>
          {measurement && section !== "report" && (
            <p className="rounded-xl border border-border/70 bg-white px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              {measurement.description}
              {dataset.mode === "local" && (config.refresh?.available ? " Обновить из базы — повторное чтение данных продукта." : " Обновление перечитывает локальный snapshot.")}
            </p>
          )}
          {section === "dashboard" && (
            <>
              {enabled("overview") && (
                <ReferenceOverview
                  report={report}
                  previous={calculated.previous}
                  views={views("overview")}
                />
              )}
              {enabled("activity") && <GrowthPanel report={report} views={views("activity")} />}
              {(acquisitionTabs.length > 0 || geoTabs.length > 0) && (
                <div className={`reference-pair grid gap-4 ${acquisitionTabs.length > 0 && geoTabs.length > 0 ? "md:grid-cols-2" : ""}`}>
                  <ReferenceBreakdownCard
                    title="Привлечение"
                    report={report}
                    tabs={acquisitionTabs}
                    initialTab="referrer"
                    onFilter={filterDimension}
                  />
                  {geoTabs.length > 0 &&
                    (!dataset.capabilities.geography ? (
                      <Panel title="География">
                        <Empty title="География не подключена" />
                      </Panel>
                    ) : (
                      <ReferenceBreakdownCard
                        title="География"
                        report={report}
                        tabs={geoTabs}
                        initialTab="country"
                        onFilter={filterDimension}
                      />
                    ))}
                </div>
              )}
              {(pageTabs.length > 0 || techTabs.length > 0) && (
                <div className="reference-pair grid gap-4 md:grid-cols-2">
                  <ReferenceBreakdownCard
                    title="Страницы"
                    report={report}
                    tabs={pageTabs}
                    initialTab="page"
                    onFilter={filterDimension}
                  />
                  <ReferenceBreakdownCard
                    title="Технологии"
                    report={report}
                    tabs={techTabs}
                    initialTab="browser"
                    onFilter={filterDimension}
                  />
                </div>
              )}
              {enabled("source_quality") && <SourceQualityPanel report={report} />}
              <ReferenceBehavior
                report={report}
                learningEnabled={enabled("learning")}
                identity={dataset.capabilities.identity}
                firstValueLabel={config.product.firstValueLabel}
                enabledTabs={["goals", "funnels", "users", "journeys"].filter(
                  id => id === "users" ? hasView("users", "user_list") : enabled(id),
                )}
                funnelViews={views("funnels")}
                goalViews={views("goals")}
                onUser={(id) => {
                  if (hasView("users", "user_card") || enabled("journeys"))
                    setUserId(id);
                }}
              />
              {enabled("learning") && <LearningPanel report={report} dataset={dataset} onUser={setUserId} views={views("learning")} />}
              {enabled("ai_crawlers") && (
                <ReferenceCrawlers
                  report={report}
                  available={dataset.capabilities.crawlers}
                  views={views("ai_crawlers")}
                  filtered={Boolean(
                    filters.source ||
                    filters.country ||
                    filters.device ||
                    filters.campaign,
                  )}
                />
              )}
              {(enabled("retention") || enabled("lifecycle")) && (
                <details open={Boolean(measurement)} className="rounded-xl border bg-white px-5 py-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    {enabled("lifecycle") ? "Retention и email lifecycle" : "Retention · D1 / D2 / D7"}
                  </summary>
                  <div className="mt-5 space-y-4">
                    {enabled("retention") && (hasView("retention", "retention_windows") ? <RetentionPanel report={report} /> : retention)}
                    {enabled("lifecycle") && (
                      <Panel
                        title="Email lifecycle"
                        description="Клики и полезные действия после письма. Открытия не считаем результатом."
                        className="min-[1180px]:col-span-2"
                      >
                        {!dataset.capabilities.lifecycle ? (
                          <Empty title="Email не подключён">
                            Передайте delivery-события Resend и связанные
                            действия. Dashboard не отправляет письма.
                          </Empty>
                        ) : report.lifecycle.length === 0 ? (
                          <Empty />
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {[
                                  "Кампания",
                                  "Отправлено",
                                  "Доставлено",
                                  "Кликнули",
                                  "Результат",
                                  "Оплатили",
                                  "Bounce",
                                  "Отписались",
                                ].map((title) => (
                                  <TableHead key={title} className="text-xs">
                                    {title}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {report.lifecycle.map((row) => (
                                <TableRow key={row.campaign}>
                                  <TableCell className="text-xs font-medium">
                                    {row.campaign}
                                  </TableCell>
                                  {[
                                    row.sent,
                                    row.delivered,
                                    row.clicked,
                                    row.activated,
                                    row.paid,
                                    row.bounced,
                                    row.unsubscribed,
                                  ].map((value, index) => (
                                    <TableCell
                                      key={index}
                                      className="tabular text-xs"
                                    >
                                      {num(value)}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                        <p className="mt-4 text-[11px] text-muted-foreground">
                          Связь с действиями в течение 7 дней после клика —
                          наблюдение, не доказанная причинность. Окно ограничено
                          выбранным периодом.
                        </p>
                      </Panel>
                    )}
                  </div>
                </details>
              )}
            </>
          )}
          {section === "report" && (
            <>
              <ReferenceSummary
                report={report}
                product={config.product}
                mode={config.mode}
                generatedAt={dataset.generatedAt}
                views={views("summary")}
                segment={
                  (["source", "country", "device", "campaign"] as const)
                    .filter((key) => filters[key])
                    .map((key) => `${key}: ${filters[key]}`)
                    .join(" · ") || "Все источники и пользователи"
                }
              />
              {enabled("sharing") && (
                <div className="flex flex-wrap items-center gap-3">
                  {hasView("sharing", "export_png") && (
                    <Button
                      onClick={() => void exportPng()}
                      disabled={exporting}
                    >
                      {exporting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Download className="size-4" />
                      )}
                      Скачать PNG
                    </Button>
                  )}
                  {hasView("sharing", "export_pdf") && (
                    <Button variant="outline" onClick={() => window.print()}>
                      Печать / PDF
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Публичные ссылки не подключены.
                  </span>
                  <p
                    role="status"
                    className="w-full text-xs text-muted-foreground"
                  >
                    {exportStatus}
                  </p>
                </div>
              )}
            </>
          )}

          {section === "links" && (
            <LinkBuilder
              product={config.product.name}
              enabledViews={views("link_builder")}
            />
          )}

          {section === "health" && (
            <div className="grid gap-5 min-[1180px]:grid-cols-2">
              {hasView("data_health", "coverage") && (
                <Panel
                  title="Источники данных"
                  description={
                    config.mode === "demo"
                      ? "Ни один внешний сервис не подключён. Ниже возможности demo-набора."
                      : isMeasurementSnapshot
                        ? (config.refresh?.available ? "Обновление читает источник через серверный адаптер. Данные учеников доступны только владельцу." : "Данные включены в локальный snapshot.")
                        : "Возможности, объявленные локальным адаптером."
                  }
                >
                  <div className="divide-y">
                    {Object.entries(dataset.capabilities).map(
                      ([key, value]) => (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-3 py-3 text-xs"
                        >
                          <span>{capabilityLabels[key]}</span>
                          <Badge
                            variant={value ? "secondary" : "outline"}
                            className="text-[10px]"
                          >
                            {config.mode === "demo"
                              ? value
                                ? "Демо"
                                : "Нет в демо"
                              : value
                                ? isMeasurementSnapshot ? "В snapshot" : "Объявлено адаптером"
                                : isMeasurementSnapshot ? "Нет в snapshot" : "Не подключено"}
                          </Badge>
                        </div>
                      ),
                    )}
                  </div>
                </Panel>
              )}
              {hasView("data_health", "ingestion") && (
                <Panel title="Качество и свежесть">
                  <div className="grid grid-cols-2 gap-3">
                    <Metric
                      title="События"
                      value={num(dataset.events.length)}
                      note="В загруженном наборе."
                    />
                    <Metric
                      title={isMeasurementSnapshot ? "Проверка данных" : "Ошибки приёма"}
                      value={isMeasurementSnapshot ? "Пройдена" : num(report.health.errors)}
                      note={isMeasurementSnapshot
                        ? "Показанный snapshot прошёл проверку структуры событий и расчётов при загрузке."
                        : "За жизнь текущего процесса сервера."}
                    />
                    <Metric
                      title="Повторы удалены"
                      value={num(report.health.replayedEvents)}
                      note={isMeasurementSnapshot ? "Дубликаты event IDs в загруженном наборе." : "Устойчивые event и payment IDs."}
                    />
                    {(!isMeasurementSnapshot || moneyAvailable) && <Metric
                      title="Возвраты без оплаты"
                      value={num(report.health.orphanRefunds)}
                      note="Не включены в деньги до сопоставления."
                    />}
                  </div>
                  {isMeasurementSnapshot && <p className="mt-4 text-xs text-muted-foreground">
                    Данные на {snapshotDate} UTC. {config.refresh?.available ? "Кнопка обновления повторно читает источник и проверяет новый набор данных." : "Кнопка обновления перечитывает локальный файл и повторяет проверку."}
                  </p>}
                  <p className="mt-4 text-xs text-muted-foreground">
                    {isMeasurementSnapshot ? "Последнее событие в snapshot:" : "Последнее событие:"}{" "}
                    {report.health.lastEventAt
                      ? new Date(report.health.lastEventAt).toLocaleString(
                          "ru-RU",
                          { timeZone: "UTC" },
                        ) + " UTC"
                      : "ещё не получено"}
                  </p>
                </Panel>
              )}
              <Panel
                title={isMeasurementSnapshot ? "Как обновляются данные" : "Подключение продукта"}
                description={isMeasurementSnapshot ? (config.refresh?.available ? "Серверный адаптер читает источник по запросу владельца." : "Локальная копия данных с фиксированной датой выгрузки.") : "Готовый интерфейс остаётся тем же. Меняется адаптер событий."}
                className="min-[1180px]:col-span-2"
              >
                <div className="grid gap-5 md:grid-cols-3">
                  {(isMeasurementSnapshot ? (config.refresh?.available ? [
                    ["01", "Обновите из источника", "Кнопка обновления запускает серверный адаптер. Подключение и его ключи остаются на сервере."],
                    ["02", "Дождитесь нового снимка", "Dashboard показывает время полученных данных. При ошибке сохраняется предыдущий результат."],
                    ["03", "Проверьте дату и качество", "Новый набор проходит проверку формата. Автообновление можно включить отдельно; оно работает только в открытой вкладке."],
                  ] : [
                    ["01", "Подготовьте новый snapshot", "Новая выгрузка продукта заменяет локальный файл данных; дата snapshot берётся из этой выгрузки."],
                    ["02", "Перезагрузите файл", "Кнопка обновления перечитывает локальный snapshot. Она не запускает выгрузку и не обращается к базе продукта."],
                    ["03", "Проверьте дату и качество", "Формат событий и расчёты проверяются при загрузке. При ошибке остаётся предыдущий snapshot с сообщением об ошибке обновления."],
                  ]) : [
                    [
                      "01",
                      "Определите первый результат",
                      config.product.firstValueLabel,
                    ],
                    [
                      "02",
                      "Передайте события",
                      "Backend отправляет разрешённые поля на /api/events с серверным ключом. В браузер ключ не попадает.",
                    ],
                    [
                      "03",
                      "Проверьте действие целиком",
                      "Реальное действие → сохранённое событие → изменение показателя в local-режиме.",
                    ],
                  ]).map(([step, title, text]) => (
                    <div key={step} className="rounded-lg bg-muted p-4">
                      <p className="mb-3 text-[10px] text-primary">{step}</p>
                      <p className="mb-2 text-sm font-medium">{title}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {text}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                  {isMeasurementSnapshot
                    ? (config.refresh?.available ? "Показатели относятся к последнему успешному чтению источника. Проверка формата данных не заменяет проверку полноты событий в самом продукте." : "Snapshot доступен локально на 127.0.0.1. Проверка файла подтверждает пригодность этой выгрузки для расчёта; состояние production-сбора событий здесь не измеряется.")
                    : "Этот сервер доступен только на 127.0.0.1. Для production нужны owner-auth, разграничение проектов, серверные агрегаты и проверенный адаптер провайдера. Объявленный payments не означает подключение Stripe, Lemon Squeezy или Stars."}
                </p>
              </Panel>
              {hasView("data_health", "redacted_debug") && (
                <Panel
                  title="Ограничения расчёта"
                  className="min-[1180px]:col-span-2"
                >
                  <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                    {report.health.warnings.map((warning) => (
                      <li key={warning}>• {warning}</li>
                    ))}
                  </ul>
                  {report.money.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {report.money.map((row) => (
                        <Badge key={row.currency} variant="outline">
                          {row.currency}:{" "}
                          {formatAmount(
                            row.netMinor,
                            row.currency,
                            row.currencyExponent,
                          )}
                        </Badge>
                      ))}
                    </div>
                  )}
                </Panel>
              )}
            </div>
          )}
          {section === "health" && (
            <Panel title="Сохранённые представления следующего этапа">
              <div className="space-y-2 text-xs text-muted-foreground">
                {config.catalog.modules
                  .filter((module) =>
                    config.selection.selected_modules.includes(module.id),
                  )
                  .map((module) => {
                    const pending = (
                      config.selection.view_choices[module.id] ?? module.views
                    ).filter(
                      (view) =>
                        !(module.runtime_views ?? module.views).includes(view),
                    );
                    return pending.length ? (
                      <p key={module.id}>
                        {moduleInfo[module.id]?.title}:{" "}
                        {pending
                          .map((view) => viewLabels[view] ?? view)
                          .join(", ")}
                        .
                      </p>
                    ) : null;
                  })}
              </div>
            </Panel>
          )}
        </div>
        <footer className="mt-7 flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground">
          <span>Launch Kit Analytics</span>
          <span>
            {config.mode === "demo" ? "Demo" : "Snapshot"} ·{" "}
            {new Date(dataset.generatedAt).toLocaleString("ru-RU", {
              timeZone: "UTC",
            })}{" "}
            UTC
          </span>
        </footer>
      </main>
      {enabled("summary") && section === "dashboard" && (
        <Button
          className="summary-launch fixed bottom-5 left-1/2 z-10 size-11 -translate-x-1/2 rounded-xl bg-[#292929] shadow-md hover:bg-[#444]"
          size="icon"
          aria-label="Открыть сводку"
          title="Сводка на одном экране"
          onClick={() => openSection("report")}
        >
          <Lightbulb className="size-5" />
        </Button>
      )}
      <ModulePicker
        config={config}
        dataset={dataset}
        open={modulesOpen}
        onOpenChange={setModulesOpen}
        onSave={async (selection) => {
          const response = await getJson<{ selection: Selection }>(
            "/api/selection",
            {
              method: "PUT",
              headers: { "X-CSRF-Token": config.csrfToken },
              body: JSON.stringify(selection),
            },
          );
          setConfig({ ...config, selection: response.selection });
        }}
      />
      <Sheet
        open={userId !== null}
        onOpenChange={(open) => {
          if (!open) setUserId(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Карточка пользователя</SheetTitle>
            <SheetDescription>Приватная операторская карточка · вне экспортируемой сводки</SheetDescription>
          </SheetHeader>
          <div className="space-y-5 p-4">
            {userId && <UserProfilePanel report={report} userId={userId} learningEnabled={enabled("learning")} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
