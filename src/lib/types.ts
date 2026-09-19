export type Topic = {
  id: number;
  slug: string;
  label: string;
  hint: string;
  weight: number;
  position: number;
  active: boolean;
};

/** Отдача и тишина источника: считается запросом из pipeline/health.ts. */
export type { SourceHealth } from "../../pipeline/health";

/**
 * Со скольких дней молчание перестаёт быть выходными и становится поломкой.
 * Здесь, а не в pipeline/health.ts: число одно на прогон и на интерфейс,
 * а модуль запроса в клиентский бандл тянуть незачем.
 */
export const SILENT_DAYS = 5;

/**
 * Виды источников — один список на всё: тип, проверка в действии, форма
 * и ограничение колонки. Разъедется — форма предложит тип, который база
 * не примет, и читатель получит ошибку там, где ничего не нарушал.
 * За совпадением с миграцией и формой следит `npm test`.
 */
export const SOURCE_KINDS = ["rss", "hackernews", "reddit", "x", "telegram"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export type Source = {
  id: number;
  kind: SourceKind;
  label: string;
  url: string;
  config: Record<string, unknown>;
  active: boolean;
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

export type Profile = {
  id: number;
  reader_context: string;
  digest_size: number;
  language: string;
  /** 1 — объясняй с нуля, 5 — пиши как специалисту. Уходит в промпт дайджеста. */
  complexity: number;
  /** Манера письма. Незнакомое значение читается как «нейтральный». */
  style: string;
  weights: Weights;
  onboarded_at: string | null;
  llm: { base_url?: string; model?: string; api_key?: string };
};
