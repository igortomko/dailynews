export type Topic = {
  id: number;
  slug: string;
  label: string;
  hint: string;
  weight: number;
  position: number;
  active: boolean;
};

export type Source = {
  id: number;
  kind: "rss" | "hackernews" | "reddit" | "x";
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
  language: "ru" | "en" | "pt";
  weights: Weights;
  onboarded_at: string | null;
  llm: { base_url?: string; model?: string; api_key?: string };
};
