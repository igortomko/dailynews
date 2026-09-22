import type { Usage } from "./digest";

/**
 * Цены моделей. Настройка, а не константа: провайдера меняют переменной
 * окружения, и зашитая цена превратила бы событие о расходе в выдумку.
 *
 * Значения по умолчанию — gemini-2.5-flash, $ за миллион токенов: провайдер
 * в коде тоже он, и цена по умолчанию обязана быть от той же модели.
 * У проекта провайдер другой, и цены стоят переменными — в `.env`,
 * в `.env.production` и в переменных репозитория, потому что считают
 * расход все трое: прогон в Actions, догрузка в вебе и ручной запуск.
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

/**
 * Рассуждение уже входит в `output`: провайдер считает его выходом, и
 * прибавлять его отдельно значило бы посчитать дважды.
 *
 * Кэшированный вход тарифицируется отдельно, только когда для текущей
 * модели настроена её цена. Без неё оставляем полную цену входа: так
 * дневной потолок будет консервативным, а не выдуманно дешёвым.
 */
export const llmCost = (usage: Usage) => {
  const input = Math.max(0, usage.input);
  // Провайдер иногда возвращает cache-hit breakdown одновременно с
  // округлённым prompt_tokens. Нельзя дать этому полю сделать вход отрицательным.
  const cached = Math.min(input, Math.max(0, usage.cached));
  const uncached = input - cached;
  const inputPrice = price("LLM_INPUT_PRICE", 0.3);
  return (uncached / 1e6) * inputPrice +
    (cached / 1e6) * price("LLM_CACHE_INPUT_PRICE", inputPrice) +
    (usage.output / 1e6) * price("LLM_OUTPUT_PRICE", 2.5);
};
