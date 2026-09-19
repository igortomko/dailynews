/**
 * Самопроверка того, что ломается молча: канонизация адресов, нормализация
 * заголовков и формула составного скора. Всё три — чистые функции, поэтому
 * им не нужны ни база, ни сеть, ни ключи.
 *
 *   npx tsx pipeline/selftest.ts
 */
import assert from "node:assert/strict";
import { canonUrl, normalizeTitle } from "./normalize";
import { composite } from "./score";
import { matchWritten } from "./digest";
import { checkLexicon, repeatsHeadline } from "./lexicon";
import { relativeTime } from "../src/lib/relative-time";
import type { Axes, Weights } from "../src/lib/types";

const weights: Weights = {
  topic: 40, novelty: 20, specifics: 20, actionable: 10,
  horizon: 10, kind: 25, clickbait: -30, depth: 15,
};

function axes(overrides: Partial<Axes> = {}): Axes {
  return {
    topic: { choice: "ai-infra", confidence: 0.9, probabilities: { "ai-infra": 0.9 } },
    kind: { choice: "fact", confidence: 0.9, probabilities: {} },
    horizon: { choice: "years", confidence: 0.8, probabilities: {} },
    novelty: { score: 2, max: 2, confidence: 0.8 },
    specifics: { score: 2, max: 2, confidence: 0.8 },
    depth: { score: 2, max: 2, confidence: 0.8 },
    actionable: { noul: 0.5 },
    clickbait: { noul: 0 },
    ...overrides,
  };
}

// --- канонизация адресов ---------------------------------------------------
assert.equal(
  canonUrl("http://www.Example.com/post/?utm_source=x&b=2&a=1#frag"),
  "https://example.com/post?a=1&b=2",
  "utm, www, протокол, фрагмент и порядок параметров",
);
assert.equal(canonUrl("https://example.com/a/amp/"), "https://example.com/a", "amp-зеркало");
assert.equal(
  canonUrl("https://example.com/x?fbclid=1&gclid=2"),
  "https://example.com/x",
  "рекламные метки",
);
// Одна и та же статья с трёх источников должна свернуться в одну строку.
assert.equal(
  canonUrl("https://www.site.com/news/?ref=hn"),
  canonUrl("http://site.com/news"),
  "совпадение разных источников",
);

// --- нормализация заголовков ----------------------------------------------
assert.equal(
  normalizeTitle("The New OpenAI Model Is Here!"),
  normalizeTitle("openai model here"),
  "стоп-слова и пунктуация",
);
assert.equal(
  normalizeTitle("Uranium prices surge"),
  normalizeTitle("Surge in uranium prices"),
  "порядок слов",
);
assert.notEqual(
  normalizeTitle("OpenAI ships GPT-6"),
  normalizeTitle("Anthropic ships Claude"),
  "разные новости не должны совпадать",
);
// Найдено сухим прогоном: два релиза одного проекта сходились к голому
// названию, потому что номер версии рассыпался и терялся целиком.
assert.notEqual(
  normalizeTitle("datasette 1.0a40"),
  normalizeTitle("datasette 0.65.5"),
  "разные версии одного проекта — не перепечатка",
);
assert.notEqual(
  normalizeTitle("GPT 5 released"),
  normalizeTitle("GPT 6 released"),
  "одна цифра может быть единственным отличием",
);
assert.ok(
  normalizeTitle("datasette 1.0a40").includes("10a40"),
  "номер версии должен пережить нормализацию одним токеном",
);

// --- составной скор --------------------------------------------------------
const fact = composite(axes(), weights, 1);
const reprint = composite(axes({ kind: { choice: "reprint", confidence: 0.9, probabilities: {} } }), weights, 1);
assert.ok(reprint < fact, "перепечатка должна проигрывать факту");

const opinion = composite(axes({ kind: { choice: "opinion", confidence: 0.9, probabilities: {} } }), weights, 1);
assert.ok(opinion < fact, "мнение должно проигрывать факту");

const clickbait = composite(axes({ clickbait: { noul: 1 } }), weights, 1);
assert.ok(clickbait < fact - 25, "кликбейт должен штрафоваться заметно");

const noise = composite(axes({ horizon: { choice: "noise", confidence: 0.8, probabilities: {} } }), weights, 1);
assert.ok(noise < fact, "шум дня должен проигрывать сигналу на годы");

const stale = composite(axes({ novelty: { score: 0, max: 2, confidence: 0.8 } }), weights, 1);
assert.ok(stale < fact, "пережёвывание известного должно проигрывать новому");

const vague = composite(axes({ specifics: { score: 0, max: 2, confidence: 0.8 } }), weights, 1);
assert.ok(vague < fact, "материал без цифр и источника должен проигрывать");

// «Прочее» теряет самую тяжёлую ось, но не убивается совсем: отличный
// материал вне заданных тем должен уметь пробиться наверх.
const other = composite(axes({ topic: { choice: "other", confidence: 0.9, probabilities: { other: 0.9 } } }), weights, 1);
assert.equal(other, fact - weights.topic * 0.9, "прочее теряет ровно тематическую ось");
assert.ok(other > 0, "прочее не должно обнуляться");

// Вес темы из онбординга должен двигать результат.
assert.ok(
  composite(axes(), weights, 1.5) > composite(axes(), weights, 0.5),
  "вес темы должен влиять на скор",
);

// --- сопоставление ответа модели с материалами --------------------------------
// Ломалось дважды и оба раза выглядело как плохой перевод, а не как ошибка кода.
const survivors = [
  { id: "136" as unknown as number, title: "A", excerpt: "aaa" },
  { id: "78" as unknown as number, title: "B", excerpt: "bbb" },
];

// Драйвер отдаёт id строкой, модель — числом.
const both = matchWritten(survivors, [
  { id: 136, title_ru: "Первый", summary: "раз" },
  { id: 78, title_ru: "Второй", summary: "два" },
]);
assert.equal(both.missing, 0, "числовой id модели должен совпасть со строковым из базы");
assert.equal(both.items.length, 2, "подстановка не должна дублировать переведённое");
assert.equal(both.items.find((i) => i.id === 136)?.title_ru, "Первый");

// Пропущенный материал подставляется, но считается пропущенным.
const partial = matchWritten(survivors, [{ id: "136" as unknown as number, title_ru: "Первый", summary: "раз" }]);
assert.equal(partial.missing, 1, "непереведённый материал должен быть посчитан");
assert.equal(partial.items.length, 2, "в дайджест попадают все материалы");
assert.equal(partial.items.find((i) => i.id === 78)?.title_ru, "B", "подстановка берёт исходный заголовок");

// Чужой id из ответа модели не должен ничего добавлять.
const stray = matchWritten(survivors, [{ id: 999, title_ru: "Чужой", summary: "—" }]);
assert.equal(stray.items.length, 2, "лишний id модели не должен попадать в дайджест");
assert.equal(stray.missing, 2, "оба материала остались без перевода");

// --- словарь машинного текста ------------------------------------------------
// «Ключевой» стояло в запрете промпта прямым текстом и всё равно прошло
// в дайджест: запрет полагается на память модели, словарь — нет.
assert.equal(checkLexicon("Для продуктов на LLM это ключевой вопрос").length, 1, "«ключевой» должен ловиться");
assert.equal(checkLexicon("Стоит отметить, что цена выросла").length, 1, "зачин должен ловиться");
assert.equal(checkLexicon("Исследования показывают рост").length, 1, "безымянная ссылка должна ловиться");
assert.equal(
  checkLexicon("Рождаемость упала втрое: 705 809 детей против 2,03 млн в 1974-м").length,
  0,
  "обычный текст с цифрами трогать нельзя",
);
assert.equal(checkLexicon("агент работал 27 минут").length, 1, "единица словом должна ловиться");
assert.equal(checkLexicon("петли на 5 и 10 км за 27 мин").length, 0, "сокращённые единицы трогать нельзя");
assert.equal(checkLexicon("10-километровые петли").length, 1, "прилагательное от единицы должно ловиться");

assert.ok(
  repeatsHeadline(
    "HYPE взял $90,92 после запуска ручных займов на Hyperliquid",
    "Hyperliquid разрешил занимать под залог HYPE, и токен обновил максимум на $90,92.",
  ),
  "пересказ заголовка должен ловиться",
);
assert.ok(
  !repeatsHeadline(
    "Антидепрессанты не перестраивают мозг: 8 700 сканов",
    "Структурные отличия объясняются тяжестью состояния и возрастом, а не препаратами.",
  ),
  "продолжение мысли пересказом считаться не должно",
);

// --- сокращённое время -------------------------------------------------------
const hourAgo = new Date(Date.now() - 2 * 3_600_000);
assert.equal(relativeTime(hourAgo), "2ч", "часы пишутся одной буквой");
assert.equal(relativeTime(new Date(Date.now() - 5 * 60_000)), "5м", "минуты пишутся одной буквой");
assert.equal(relativeTime(new Date(Date.now() - 3 * 86_400_000)), "3д", "дни пишутся одной буквой");
assert.ok(/[а-я]{3}/.test(relativeTime(new Date(Date.now() - 40 * 86_400_000))), "давнее пишется датой");

// --- расположение middleware ------------------------------------------------
// Проект использует srcDirectory, и Next подключает middleware только из src/.
// Лежащий в корне файл не вызывает ни ошибки, ни предупреждения: страницы
// просто отдаются всем. Один раз так и было.
import { existsSync } from "node:fs";
assert.ok(existsSync("src/middleware.ts"), "middleware должен лежать в src/");
assert.ok(!existsSync("middleware.ts"), "middleware в корне не подключается и вводит в заблуждение");

console.log("Самопроверка пройдена: 41 утверждение");
