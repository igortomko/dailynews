import type { ModelPrice } from "./types";
import type { AnalyticsDataset } from "./types";

export interface Selection {
  contract_version: string;
  preset: string;
  selected_modules: string[];
  view_choices: Record<string, string[]>;
  excluded_modules: Record<string, string>;
  provenance: string;
}
export interface CatalogModule {
  id: string;
  views: string[];
  runtime_views?: string[];
  depends_on: string[];
  view_dependencies?: Record<string, string[]>;
}
export interface Config {
  product: AnalyticsDataset["product"];
  selection: Selection;
  catalog: {
    modules: CatalogModule[];
    presets: Record<string, string[]>;
    preset_view_choices?: Record<string, Record<string, string[]>>;
  };
  csrfToken: string;
  mode: "demo" | "local";
  refresh?: { available: boolean; minimumIntervalSeconds: number };
  /** The host can mint and retire placements (POST /api/placements, /api/placements/retire). */
  placements?: { mint: boolean };
  /**
   * The owner's own model prices (PUT /api/prices). They override the product's
   * defaults and price only rows the product recorded without an amount.
   */
  prices?: { editable: boolean; overrides: Record<string, ModelPrice> };
}
export const moduleInfo: Record<
  string,
  { title: string; description: string; section: string }
> = {
  activity: {
    title: "Активность",
    description: "DAU, WAU, новые пользователи и ежедневные полезные действия.",
    section: "overview",
  },
  source_quality: {
    title: "Качество источников",
    description: "Входные когорты, зрелая активация и возвраты по каналам.",
    section: "acquisition",
  },
  learning: {
    title: "Обучение",
    description: "Карточки, паки, XP, оценки и прогресс учеников. Нужен адаптер обучения.",
    section: "product",
  },
  overview: {
    title: "Обзор",
    description: "Посетители, первый результат, деньги и динамика.",
    section: "overview",
  },
  channels: {
    title: "Каналы",
    description: "Какие типы привлечения дают результат.",
    section: "acquisition",
  },
  referrers: {
    title: "Источники",
    description: "Конкретные источники: от визита до оплаты.",
    section: "acquisition",
  },
  campaigns: {
    title: "Кампании",
    description: "UTM source, medium, campaign и content.",
    section: "acquisition",
  },
  keywords: {
    title: "Ключевые слова",
    description: "Метки utm_term. Поисковые запросы требуют коннектора.",
    section: "acquisition",
  },
  geography: {
    title: "География",
    description: "Страна, регион и город, если переданы источником.",
    section: "acquisition",
  },
  pages: {
    title: "Страницы",
    description: "Какие страницы приводят к полезному действию.",
    section: "acquisition",
  },
  technology: {
    title: "Устройства",
    description: "Браузер, ОС и устройство для проверки опыта.",
    section: "acquisition",
  },
  goals: {
    title: "Цели",
    description: "Полезные действия и вовлечение в landing.",
    section: "product",
  },
  funnels: {
    title: "Воронка",
    description: "Вход → первый результат → оплата за 7 дней.",
    section: "product",
  },
  retention: {
    title: "Возврат",
    description: "D1, D2 и продуктовый D7 по полностью наблюдаемым когортам.",
    section: "product",
  },
  lifecycle: {
    title: "Email lifecycle",
    description: "Welcome, активация и возврат: доставка и действия.",
    section: "product",
  },
  users: {
    title: "Пользователи",
    description: "Приватная карточка, профиль, источник, результат и история действий.",
    section: "audience",
  },
  journeys: {
    title: "Пути пользователей",
    description: "Последовательность действий выбранного пользователя.",
    section: "audience",
  },
  ai_crawlers: {
    title: "AI и crawlers",
    description: "Серверные запросы ботов отдельно от посетителей.",
    section: "acquisition",
  },
  link_builder: {
    title: "Конструктор ссылок",
    description: "UTM и ref, копирование и локальный список ссылок.",
    section: "links",
  },
  summary: {
    title: "Отчёт на одном экране",
    description: "Компактные агрегаты за выбранный период.",
    section: "report",
  },
  sharing: {
    title: "Экспорт отчёта",
    description: "PNG и печать в PDF. Публичные ссылки ещё не подключены.",
    section: "report",
  },
  data_health: {
    title: "Состояние данных",
    description: "Источники, свежесть, пропуски и качество сбора.",
    section: "health",
  },
};
export const sectionInfo = [
  {
    id: "overview",
    title: "Обзор",
    subtitle: "От привлечения до повторного результата",
  },
  {
    id: "acquisition",
    title: "Привлечение",
    subtitle: "Где находятся будущие клиенты",
  },
  {
    id: "product",
    title: "Продукт и возврат",
    subtitle: "Получают ли пользователи обещанный результат",
  },
  {
    id: "audience",
    title: "Аудитория",
    subtitle: "Кто получает результат и как к нему приходит",
  },
  {
    id: "report",
    title: "Отчёт",
    subtitle: "Выбранные показатели на одном экране",
  },
  {
    id: "links",
    title: "Ссылки кампаний",
    subtitle: "Создайте ссылку, чтобы узнать, что сработало",
  },
  {
    id: "health",
    title: "Состояние данных",
    subtitle: "Что подключено и чему можно доверять",
  },
];
export const viewLabels: Record<string, string> = {
  active_windows: "DAU / WAU / новые",
  activity_trend: "Новые и активные по дням",
  cohort_table: "Качество входных когорт",
  retention_windows: "D1 / D2 / D7",
  learning_overview: "Обзор обучения",
  learner_progress: "Прогресс учеников",
  visitors: "Посетители",
  revenue: "Оплаты − возвраты",
  conversion: "Конверсия в оплату",
  revenue_per_visitor: "Выручка / посетитель",
  bounce: "Отказы",
  session_time: "Активное время",
  activation: "Первый результат",
  trend: "Динамика",
  pageviews: "Просмотры",
  pages_per_visitor: "Страниц / посетитель",
  new_returning: "Вернувшиеся посетители",
  returning_share: "Доля вернувшихся",
  channel_share: "Доли каналов",
  channel_table: "Таблица каналов",
  referrer_table: "Источники",
  source: "Source",
  medium: "Medium",
  campaign: "Campaign",
  content: "Content",
  campaign_terms: "UTM term",
  search_terms: "Поисковые запросы",
  map: "Карта",
  country: "Страны",
  region: "Регионы",
  city: "Города",
  hostname: "Домены",
  page: "Страницы",
  entry_page: "Страницы входа",
  exit_link: "Исходящие клики",
  browser: "Браузеры",
  os: "Операционные системы",
  device: "Устройства",
  goal_list: "Цели",
  goal_trend: "Динамика целей",
  goal_properties: "Свойства целей",
  landing_engagement: "Вовлечение в landing",
  product_activation_payment: "Вход → результат → оплата",
  step_details: "Числа и потери",
  user_list: "Список",
  user_card: "Карточка",
  goal_completers: "Достигшие цели",
  timeline: "Путь",
  ai_answers: "Ответы AI",
  indexing: "Индексация",
  training: "Обучение",
  crawlers: "Список ботов",
  requested_pages: "Страницы ботов",
  simple_ref: "Простой ref",
  utm_builder: "UTM builder",
  saved_links: "Сохранённые ссылки",
  campaign_result: "Результат кампании",
  identity_period: "Продукт и период",
  daily_averages: "Средние за день",
  revenue_per_visitor_growth: "Выручка / посетитель",
  device_os_browser_revenue: "Устройства и выручка",
  top_sources: "Лучшие источники",
  top_countries: "Страны и выручка",
  visits_to_purchase: "Визитов до оплаты",
  time_to_purchase: "Время до оплаты",
  top_converting_goals: "Цели и оплата",
  conversion_heatmap: "Время конверсий",
  seven_day_return: "Возврат за 7 дней",
  lifecycle_results: "Результаты email",
  export_png: "PNG",
  export_pdf: "Печать / PDF",
  snapshot_link: "Публичная ссылка",
  revoke: "Отзыв ссылки",
  repeat_value_trend: "Динамика повторов",
  source_cohorts: "Когорты по источникам",
  welcome: "Welcome",
  return: "Возврат",
  delivery_health: "Доставка",
  ingestion: "Приём событий",
  coverage: "Покрытие",
  provider_sync: "Синхронизация провайдеров",
  redacted_debug: "Диагностика",
};

export function connectedViews(dataset: AnalyticsDataset, module: string, views: string[]): string[] {
  if (dataset.product.profile !== "telegram") return views;
  const pageData = dataset.events.some(event => event.name === "page_viewed");
  if (module === "pages" && !pageData) return [];
  if (module === "technology" && !dataset.events.some(event => event.browser || event.os || event.device)) return [];
  if (module !== "overview") return views;
  return views.filter(view => {
    if (["revenue", "conversion", "revenue_per_visitor"].includes(view) && !dataset.capabilities.payments) return false;
    if (["bounce", "session_time"].includes(view) && !dataset.capabilities.sessions) return false;
    if (["pageviews", "pages_per_visitor"].includes(view) && !pageData) return false;
    if (["new_returning", "returning_share"].includes(view) && !dataset.capabilities.identity) return false;
    return true;
  });
}
export function withDependencies(
  selection: Selection,
  catalog: Config["catalog"],
): Selection {
  const ids = new Set(
    selection.selected_modules.filter((id) => id !== "realtime"),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const module of catalog.modules.filter((item) => ids.has(item.id))) {
      const views = selection.view_choices[module.id] ?? module.views;
      const deps = [
        ...module.depends_on,
        ...views.flatMap((view) => module.view_dependencies?.[view] ?? []),
      ];
      for (const dependency of deps)
        if (!ids.has(dependency)) {
          ids.add(dependency);
          changed = true;
        }
    }
  }
  const selected_modules = catalog.modules
    .filter((item) => ids.has(item.id))
    .map((item) => item.id);
  return {
    ...selection,
    selected_modules,
    excluded_modules: Object.fromEntries(
      Object.entries(selection.excluded_modules).filter(([id]) => !ids.has(id)),
    ),
  };
}
export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
