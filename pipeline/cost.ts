import type { Usage } from "./digest";

/**
 * Цены моделей. Настройка, а не константа: провайдера меняют переменной
 * окружения, и зашитая цена превратила бы событие о расходе в выдумку.
 *
 * Значения по умолчанию — gemini-2.5-flash, $ за миллион токенов.
 */
const price = (name: string, fallback: number): number => {
  // Пустая строка — это «не задано», а не ноль. GitHub Actions подставляет
  // пустоту вместо несуществующей переменной, а Number("") — это 0:
  // все вызовы стали бы бесплатными, дневной потолок перестал бы
  // срабатывать, и увидеть это можно было бы только в счёте.
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const asked = Number(raw);
  // Проверка на число, а не `|| fallback`: ноль — законная цена
  // бесплатного тарифа, и подменять его дефолтом нельзя.
  return Number.isFinite(asked) && asked >= 0 ? asked : fallback;
};

/** Jev: выход не тарифицируется. */
export const JEV_INPUT_PRICE = 0.042;

export const jevCost = (inputTokens: number) => (inputTokens / 1e6) * JEV_INPUT_PRICE;

export const llmCost = (usage: Usage) =>
  (usage.input / 1e6) * price("LLM_INPUT_PRICE", 0.3) +
  (usage.output / 1e6) * price("LLM_OUTPUT_PRICE", 2.5);
