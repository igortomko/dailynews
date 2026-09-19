/** Общий справочник: по нему Jev классифицирует поток один раз на всех. */
export type Topic = {
  id: number;
  slug: string;
  label: string;
  hint: string;
  /** Цель по умолчанию для читателя, который добавляет тему из каталога. */
  weight: number;
  position: number;
  active: boolean;
};

/** Тема в ленте конкретного читателя: вес здесь — его цель по числу новостей. */
export type ReaderTopic = {
  id: number;
  slug: string;
  label: string;
  hint: string;
  weight: number;
  position: number;
};

export type Source = {
  id: number;
  kind: "rss" | "hackernews" | "reddit" | "x";
  label: string;
  url: string;
  config: Record<string, unknown>;
  active: boolean;
  /** Что вставил человек, до разбора. url — уже разрешённый адрес фида. */
  input_url: string | null;
  last_ok_at: string | null;
  last_count: number | null;
  last_error: string | null;
};

/** Сырой материал до скоринга. */
export type RawItem = {
  url: string;
  title: string;
  excerpt: string;
  points: number | null;
  comments: number | null;
  published_at: Date | null;
};

export const KINDS = ["fact", "forecast", "opinion", "announcement", "reprint"] as const;
export type Kind = (typeof KINDS)[number];

export const HORIZONS = ["noise", "months", "years"] as const;
export type Horizon = (typeof HORIZONS)[number];

/** Ответы Jev по одному материалу, как они ложатся в scores.axes. */
export type Axes = {
  topic: { choice: string; confidence: number; probabilities: Record<string, number> };
  kind: { choice: Kind; confidence: number; probabilities: Record<string, number> };
  horizon: { choice: Horizon; confidence: number; probabilities: Record<string, number> };
  novelty: { score: number; max: number; confidence: number };
  specifics: { score: number; max: number; confidence: number };
  depth: { score: number; max: number; confidence: number };
  actionable: { noul: number };
  clickbait: { noul: number };
};

export type Weights = {
  topic: number;
  novelty: number;
  specifics: number;
  actionable: number;
  horizon: number;
  kind: number;
  clickbait: number;
  depth: number;
};

/**
 * Веса по умолчанию. Обязаны совпадать с jsonb-дефолтом readers.weights:
 * расхождение проверяет npm run verify:db. Ими же считается scores.total —
 * скор каталога, от которого персональный отличается ровно весами.
 */
export const DEFAULT_WEIGHTS: Weights = {
  topic: 40, novelty: 20, specifics: 20, actionable: 10,
  horizon: 10, kind: 25, clickbait: -30, depth: 15,
};

export type Reader = {
  id: number;
  /** Приходит из драйвера строкой: bigint. Сравнивать только в SQL. */
  telegram_id: string | null;
  username: string | null;
  owner: boolean;
  reader_context: string;
  digest_size: number;
  language: string;
  /** 1 — объясняй с нуля, 5 — пиши как специалисту. Уходит в промпт дайджеста. */
  complexity: number;
  /** Манера письма. Незнакомое значение читается как «нейтральный». */
  style: string;
  weights: Weights;
  /** Адрес @kindle.com. Пусто — на читалку не уходит ничего. */
  kindle_address: string | null;
  /**
   * Слать ли на читалку сам выпуск. Адресом пользуется и ручная отправка
   * отдельной статьи, поэтому «не присылай выпуск» — это переключатель,
   * а не стёртый адрес.
   */
  kindle_digest: boolean;
  /** Локальная часть обратного адреса. Выдаётся один раз и заморожена. */
  kindle_sender: string | null;
  /** Тариф: пределы по источникам, интересам и размеру выпуска (src/lib/plans.ts).
   *  Персонален, как и всё остальное здесь: у каждого читателя свой. */
  plan: string;
  daily_cap_usd: number;
  onboarded_at: string | null;
  llm: { base_url?: string; model?: string; api_key?: string; reasoning_effort?: string };
};
