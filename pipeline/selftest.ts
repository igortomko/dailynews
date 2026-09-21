/**
 * Самопроверка того, что ломается молча: канонизация адресов, нормализация
 * заголовков и формула составного скора. Всё три — чистые функции, поэтому
 * им не нужны ни база, ни сеть, ни ключи.
 *
 *   npx tsx pipeline/selftest.ts
 */
import assertStrict from "node:assert/strict";
import { classifyDrop, syntheticUrl, titleOf } from "../src/lib/drops";

/**
 * Утверждения считает сам файл, а не человек в конце.
 *
 * Число в последней строке вели руками, и оно разъезжалось с правдой каждый
 * раз, когда две ветки правили тесты одновременно: считать по тексту нельзя —
 * часть утверждений живёт в циклах и срабатывает по нескольку раз. Разъехалось
 * уже трижды, и каждый раз выглядело как «тестов стало меньше».
 */
let checks = 0;
const count = <T>(fn: T): T =>
  ((...args: unknown[]) => {
    checks++;
    return (fn as (...a: unknown[]) => unknown)(...args);
  }) as T;
const assert: typeof assertStrict = new Proxy(assertStrict, {
  apply: (target, thisArg, args) => {
    checks++;
    return Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args);
  },
  get: (target, prop, receiver) => {
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? count(value) : value;
  },
}) as typeof assertStrict;
import {
  effectivePlan, effectiveVoice, readEvent, signatureValid, checkoutUrl, endingAt,
} from "../src/lib/lemon";
import { appOrigin } from "../src/lib/auth";
import { numberCollisions } from "../db/schema-gap";
import { dropStrayReady } from "../db/free-port";
import { alsoLine, laterBy, otherSources, storyLines, storyTitle } from "../src/lib/story";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonUrl, normalizeTitle } from "./normalize";
import { dupVerdict, sameStoryQuestion } from "./dedup";
import { composite } from "./score";
import { matchWritten, parseDigest, textFor, type Survivor } from "./digest";
import { clipText, excerptFrom, refusedForGood, SHORT_EXCERPT } from "./enrich";
import { checkLexicon, repeatsHeadline, readability } from "./lexicon";
import { parseFeed, stripHtml } from "./fetch";
import { articleHtml, parseTimedText, pickTrack, videoIdOf } from "./youtube";
import { BAR_GAP, MIN_PER_TOPIC, handleLeft, normalize, moveBoundary } from "../src/lib/topic-budget";
import {
  channelHandle, checkSecret, looksLikeSource, parseUpdate, SUBSCRIBED_PREFIX, verdictOf,
} from "../src/lib/telegram";
import { pickSurvivors, type Candidate } from "./select";
import { digestHtml, kindleDigestVerdict } from "./kindle";
import { QUALITY_SAMPLE, qualitySample } from "./summary-quality";
import { SLEEP_DAYS, sleepVerdict } from "../src/lib/sleep";
import { issuesToday } from "../src/lib/plans";
import { plural } from "../src/lib/plural";
import { kindleSenderName, kindleSetupStep } from "../src/lib/kindle-setup";
import { llmCost } from "./cost";
import { DEFAULT_WEIGHTS } from "../src/lib/types";
import { COMPLEXITY, LANGUAGES, SOURCE_LANGUAGE, STYLES, complexityAt, styleOf } from "../src/lib/voice";
import { firstSet } from "./digest";
import { relativeTime } from "../src/lib/relative-time";
import { toSlug } from "../src/lib/slug";
import { STARTER_TOPICS, starterBySlug, suggestOrder } from "../src/lib/starter-topics";
import type { Axes, Weights } from "../src/lib/types";
import { asUrl, diagnose, feedLinks, guesses, looksLikeFeed, planFor } from "./discover";
import { countOf, explain, parseTelegram } from "./fetch";
import {
  NETWORK_IDS, NETWORKS, overLimit, postLength, readableOf, tabsOf,
} from "../src/lib/networks";
import { parseDrafts, unverifiedNumbers } from "./post";
import { asCard, cardBlock, cardFromVoice, corpusOf, medianViews, parseCard } from "./voice-card";
import { addressOf, decodeWords, imapDate, lettersFrom, parseLetter, responseEnd } from "./mail";

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

// --- дедуп серой зоны ------------------------------------------------------
// Вопрос собирается из шортлиста, и ключ варианта обязан вести обратно
// к номеру материала: разъедется ключ с разбором — дубль пометится
// оригиналом соседа, и заметить это будет нечем.
const greyQuestion = sameStoryQuestion(
  { id: 900, title: "AI hallucination nearly triggers US Military operation", excerpt: "…" },
  [
    { id: 26, title: "US Military had close call after using AI", excerpt: "…" },
    { id: 44, title: "OpenJev", excerpt: "…" },
  ],
);
assert.deepEqual(
  Object.keys(greyQuestion.questions.same.criteria),
  ["o26", "o44", "none"],
  "варианты — шортлист и «ни один»",
);
assert.equal(
  dupVerdict({ choice: "o26", probabilities: { o26: 0.82, o44: 0.1, none: 0.08 } }),
  26,
  "уверенный выбор — это номер оригинала",
);
assert.equal(
  dupVerdict({ choice: "none", probabilities: { o26: 0.3, o44: 0.1, none: 0.6 } }),
  null,
  "«ни один» — не дубль",
);
// Дубль прячет новость у всех и навсегда, поэтому неуверенность
// читается как «разные новости», а не как «наверное, дубль».
assert.equal(
  dupVerdict({ choice: "o26", probabilities: { o26: 0.45, o44: 0.3, none: 0.25 } }),
  null,
  "неуверенный выбор не помечает дубль",
);
assert.equal(
  dupVerdict({ choice: "o26", probabilities: {} }),
  null,
  "выбор без вероятности — не ответ",
);

// --- составной скор --------------------------------------------------------
const fact = composite(axes(), weights);
const reprint = composite(axes({ kind: { choice: "reprint", confidence: 0.9, probabilities: {} } }), weights);
assert.ok(reprint < fact, "перепечатка должна проигрывать факту");

const opinion = composite(axes({ kind: { choice: "opinion", confidence: 0.9, probabilities: {} } }), weights);
assert.ok(opinion < fact, "мнение должно проигрывать факту");

const clickbait = composite(axes({ clickbait: { noul: 1 } }), weights);
assert.ok(clickbait < fact - 25, "кликбейт должен штрафоваться заметно");

const noise = composite(axes({ horizon: { choice: "noise", confidence: 0.8, probabilities: {} } }), weights);
assert.ok(noise < fact, "шум дня должен проигрывать сигналу на годы");

const stale = composite(axes({ novelty: { score: 0, max: 2, confidence: 0.8 } }), weights);
assert.ok(stale < fact, "пережёвывание известного должно проигрывать новому");

const vague = composite(axes({ specifics: { score: 0, max: 2, confidence: 0.8 } }), weights);
assert.ok(vague < fact, "материал без цифр и источника должен проигрывать");

// «Прочее» теряет самую тяжёлую ось, но не убивается совсем: отличный
// материал вне заданных тем должен уметь пробиться наверх.
const other = composite(axes({ topic: { choice: "other", confidence: 0.9, probabilities: { other: 0.9 } } }), weights);
assert.equal(other, fact - weights.topic * 0.9, "прочее теряет ровно тематическую ось");
assert.ok(other > 0, "прочее не должно обнуляться");

// Вес темы в скор не входит: он делит места в дайджесте, а не подкручивает
// оценку материала. Иначе числа разных тем несравнимы и корзины калибровки
// едут от одной правки внимания.
assert.ok(
  !/topicWeight/.test(readFileSync("pipeline/score.ts", "utf8")),
  "вес темы не должен возвращаться в формулу скора",
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

// --- пустая строка не значение ------------------------------------------------
// GitHub Actions подставляет пустоту вместо несуществующего секрета, и ?? её
// пропускает: провайдер остался без адреса, fetch получил «/chat/completions».
assert.equal(firstSet("", undefined, "b"), "b", "пустая строка должна пропускаться");
assert.equal(firstSet("  ", "x"), "x", "пробелы — тоже пустота");
assert.equal(firstSet(undefined, undefined), undefined, "нет значений — undefined");
assert.equal(firstSet(" a ", "b"), "a", "значение обрезается по краям");


// --- оборванный ответ модели ---------------------------------------------------
// Провайдер обрывает простыню JSON на середине массива. Падение разбора
// оставляло день без дайджеста целиком, хотя почти все описания доехали.
// Описание приходит тройкой [id, заголовок, текст]: имена полей
// повторялись на каждом описании и тарифицировались как выход.
const cut = '{"intro": "сегодня про ИИ", "items": [[1, "А", "раз"],' +
  '[2, "Б", "два"],[3, "В", "тр';
assert.equal(parseDigest(cut).items?.length, 2, "из оборванного ответа спасаются целые описания");
assert.equal(parseDigest(cut).intro, "сегодня про ИИ", "интро переживает обрыв");
assert.equal(
  parseDigest('{"intro":"и","items":[[7,"Т","С"]]}').items?.[0].id,
  7,
  "целый ответ разбирается обычным путём",
);
assert.equal(
  parseDigest('{"items":[[7,"Т","С"]]}').items?.[0].title_ru,
  "Т",
  "второй элемент тройки — заголовок",
);
// Модель иногда возвращает id строкой: сопоставление разберётся, а вот
// потерять описание из-за типа нельзя.
assert.equal(parseDigest('{"items":[["7","Т","С"]]}').items?.length, 1, "id строкой тоже принимается");
assert.equal(parseDigest('{"items":[[7,"Т"]]}').items?.length, 0, "неполная тройка не описание");

// --- объявленная связь вместо связи -------------------------------------------
// Эта форма и была жалобой читателя: «не понял, зачем мне это». Ось её
// не ловит — она засчитывает упоминание читателя за найденную связь.
assert.ok(
  checkLexicon("Datasette может быть полезен читателю для внутренних дашбордов").length > 0,
  "«может быть полезен читателю» должно помечаться",
);
assert.ok(
  checkLexicon("компоненты стека, используемые в его проекте").length > 0,
  "«в его проекте» без следствия — объявление связи",
);
assert.equal(
  checkLexicon("Тот же приём стоит проверить везде, где имя таблицы приходит из запроса").length,
  0,
  "настоящая связь через глагол помечаться не должна",
);

// --- что миграции обещают базе -------------------------------------------------
// Проверка схемы читает миграции регулярками. Забудет про drop — начнёт
// требовать колонки, которые сама же миграция и убрала, и ей перестанут
// верить на второй день.
import { promised } from "../db/schema-gap";
const promise = promised("db/migrations");
const columnNames = promise.columns.map((entry) => `${entry.table}.${entry.column}`);
assert.ok(columnNames.includes("digests.reader_id"), "добавленная колонка должна попасть в список");
assert.ok(
  !columnNames.includes("profile.digest_hour"),
  "снятая следующей миграцией колонка требоваться не должна",
);
assert.ok(
  promise.tables.some((entry) => entry.table === "readers"),
  "заведённая таблица должна попасть в список",
);
// Увезённая таблица уносит и обещания своих колонок: 0019 забрала profile
// целиком, и требовать profile.complexity после неё значит показывать
// расхождение там, где всё правильно, — а такой проверке перестают верить.
assert.ok(
  !promise.tables.some((entry) => entry.table === "profile"),
  "увезённая таблица требоваться не должна",
);
assert.ok(
  !columnNames.some((name) => name.startsWith("profile.")),
  "колонки увезённой таблицы требоваться не должны",
);
assert.ok(
  promise.constraints.some((entry) => entry.name === "topics_weight_positive"),
  "именованное ограничение должно попасть в список",
);
// Увезённая таблица уносит и свои ограничения: profile_digest_size_check
// из 0018 требовался бы вечно, и сверка схемы показывала бы разрыв там,
// где всё применено. Один раз так и вышло — сразу после накатывания 0020.
assert.ok(
  !promise.constraints.some((entry) => entry.table === "profile"),
  "ограничения увезённой таблицы требоваться не должны",
);

// --- список размеров против ограничения базы -----------------------------------
// Форма предлагает список, база держит check. Разъедутся — читатель выберет
// число, которое база отвергнет, и виноватым будет выглядеть он.
import { DIGEST_SIZES, MAX_DIGEST } from "../src/lib/topic-budget";
assert.ok(
  readFileSync("db/migrations/0018_digest_size_100.sql", "utf8").includes(`between 3 and ${MAX_DIGEST}`),
  "потолок списка должен совпадать с ограничением колонки",
);
assert.ok(
  DIGEST_SIZES.every((size, index) => index === 0 || size > DIGEST_SIZES[index - 1]),
  "список размеров должен идти по возрастанию",
);

// --- разгон перед выводом ------------------------------------------------------
// Хвост описания начинался с пустого подлежащего: «Эта ситуация демонстрирует,
// как…». Читатель только что прочёл, о чём речь, — слово потрачено на разгон.
assert.ok(
  checkLexicon("Эта ситуация демонстрирует, как геополитика влияет на рынки").length > 0,
  "«эта ситуация демонстрирует» — разгон, а не мысль",
);
assert.ok(
  checkLexicon("Это показывает, как меняется цена").length > 0,
  "указательное «это» перед выводом тоже разгон",
);
assert.equal(
  checkLexicon("Демонстрирует, как геополитика влияет на энергетические рынки").length,
  0,
  "та же мысль без разгона помечаться не должна",
);
assert.equal(
  checkLexicon("Может быть критично при разработке систем с контролем логики").length,
  0,
  "вывод без обращения и без разгона — чистый",
);

// --- столкновение slug ---------------------------------------------------------
// Разные названия сходятся в один slug, а `on conflict (slug) do update`
// схлопывает их в одну строку: цель первой темы теряется, и сумма целей
// молча перестаёт равняться размеру дайджеста. Полоса показывает одно,
// приходит другое — поэтому saveInterests отказывает до вставки.
assert.equal(toSlug("ИИ-инфра"), toSlug("ИИ инфра"), "пунктуация в slug не различается");
assert.equal(toSlug("AI-инфра"), "ai-infra", "кириллица транслитерируется");
assert.equal(toSlug("!!!"), "topic", "пустой после чистки slug не должен быть пустым");

// --- бюджет тем ---------------------------------------------------------------
// Сумма целей — это и есть размер дайджеста. Разъедется она — и «11 из 20»
// на экране будет означать не то, что придёт читателю, причём молча.
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

assert.equal(sum(normalize([1, 1, 1, 1, 1], 20)), 20, "цели должны складываться в размер дайджеста");
assert.equal(sum(normalize([10, 5, 5], 12)), 12, "уменьшение дайджеста пересчитывает цели");
assert.equal(sum(normalize([7, 1, 1, 1], 20)), 20, "перекошенные цели тоже приводятся к сумме");
assert.ok(
  normalize([10, 5, 5], 20)[0] > normalize([10, 5, 5], 20)[1],
  "пропорция при пересчёте должна сохраняться",
);
assert.ok(
  normalize([30, 1, 1], 20).every((count) => count >= MIN_PER_TOPIC),
  "ни одна тема не должна опуститься ниже минимума при пересчёте",
);
// Дробное округление каждой доли по отдельности даёт сумму то 19, то 21.
assert.equal(sum(normalize([1, 1, 1], 20)), 20, "три равные доли от двадцати не должны терять место");
assert.equal(sum(normalize([2, 3, 4, 5, 6, 7], 21)), 21, "шесть тем на двадцать одно место");
// Мест меньше, чем тем: цели не обнуляются, отбор вернётся к ровному кругу.
assert.ok(normalize([5, 5, 5, 5], 3).every((count) => count === MIN_PER_TOPIC), "мест меньше, чем тем");

const moved = moveBoundary([10, 6, 4], 0, 7);
assert.equal(sum(moved), 20, "перетаскивание границы не меняет размер дайджеста");
assert.deepEqual(moved, [7, 9, 4], "сколько ушло слева, столько пришло справа");
assert.deepEqual(
  moveBoundary([10, 6, 4], 0, 99),
  [15, 1, 4],
  "граница не должна съедать соседа целиком",
);
assert.deepEqual(
  moveBoundary([10, 6, 4], 1, 0),
  [10, 1, 9],
  "граница не уходит за левого соседа",
);

// --- голос --------------------------------------------------------------------
// Колонка complexity ограничена в базе значениями 1..5: разъедется список —
// ползунок начнёт показывать деления, которых промпт не знает.
assert.equal(COMPLEXITY.length, 5, "делений сложности должно быть ровно пять, как в check базы");
assert.ok(
  COMPLEXITY.every((entry, index) => entry.key === String(index + 1)),
  "ключи сложности должны совпадать со значением колонки",
);
assert.ok(
  [...COMPLEXITY, ...STYLES].every((entry) => entry.instruction.trim().length > 0 && entry.hint.trim().length > 0),
  "у каждого варианта должны быть и подпись для читателя, и требование для модели",
);
assert.equal(complexityAt(9).key, "5", "значение вне шкалы прижимается к краю, а не ломает промпт");
assert.equal(complexityAt(0).key, "1", "ноль прижимается к первому делению");
assert.equal(styleOf("выдуманная").key, "нейтральный", "незнакомая манера читается как нейтральная");

// --- механическая сложность текста --------------------------------------------
// Ползунок меняет промпт, а изменился ли текст — на глаз не видно.
const plain = readability("Цена упала вдвое. Теперь сервер стоит 20 долларов в месяц.");
const dense = readability(
  "Продемонстрированная производительность инфраструктурного инференса свидетельствует " +
  "о существенной трансформации экономической целесообразности самостоятельного " +
  "развёртывания крупномасштабных языковых моделей организациями.",
);
assert.ok(dense.perSentence > plain.perSentence, "длинные предложения должны считаться сложнее");
assert.ok(dense.longShare > plain.longShare, "доля длинных слов должна ловить канцелярит");
assert.equal(readability("").perSentence, 0, "пустой текст не должен делить на ноль");


// --- апдейт Telegram ----------------------------------------------------------
// Разбор апдейта проверяется здесь, а не на живом вебхуке: у вебхука нет
// ни теста, ни способа заметить, что он стал отвечать не тем, — сообщение
// просто не приходит.
const privateStart = (text: string, extra: Record<string, unknown> = {}) => ({
  message: {
    text,
    chat: { id: 4242, type: "private" },
    from: { id: 4242, is_bot: false, username: "igor", ...extra },
  },
});

assert.deepEqual(
  parseUpdate(privateStart("/start")),
  { kind: "start", telegramId: 4242, chatId: 4242, username: "igor" },
  "обычный /start заводит читателя",
);
assert.equal(parseUpdate(privateStart("/start@lenta_bot")).kind, "start", "/start@ИмяБота — тот же /start");
assert.equal(parseUpdate(privateStart("/start login")).kind, "start", "полезная нагрузка не мешает");
assert.equal(parseUpdate(privateStart("/START")).kind, "start", "регистр команды не важен");
assert.equal(parseUpdate(privateStart("привет")).kind, "help", "на прочий текст отвечаем подсказкой");
assert.equal(parseUpdate(privateStart("")).kind, "ignore", "пустое сообщение игнорируем");

// В группе /start прислал бы ссылку входа всем участникам разом, и
// выглядело бы это как обычный ответ бота.
assert.equal(
  parseUpdate({ message: { text: "/start", chat: { id: -100, type: "supergroup" }, from: { id: 1 } } }).kind,
  "ignore",
  "в группе ссылка входа не выдаётся",
);
assert.equal(parseUpdate(privateStart("/start", { is_bot: true })).kind, "ignore", "боты не читатели");
assert.equal(parseUpdate({}).kind, "ignore", "апдейт без сообщения");
assert.equal(parseUpdate(null).kind, "ignore", "пустой апдейт не должен ронять вебхук");
assert.equal(
  parseUpdate({ message: { text: "/start", chat: { id: "4242", type: "private" }, from: { id: 4242 } } }).kind,
  "ignore",
  "id строкой — не id",
);
// Идентификаторы Telegram давно вышли за 2^31; на 2^53 обрывается сам JSON.
const bigId = 7_446_123_987;
assert.deepEqual(
  parseUpdate({
    message: { text: "/start", chat: { id: bigId, type: "private" }, from: { id: bigId } },
  }),
  { kind: "start", telegramId: bigId, chatId: bigId, username: null },
  "большой telegram_id должен пережить разбор",
);

// --- секрет вебхука -----------------------------------------------------------
// Адрес вебхука открыт всему интернету: без этой проверки кто угодно
// присылает «/start от читателя номер такой-то».
delete process.env.TELEGRAM_WEBHOOK_SECRET;
assert.equal(checkSecret("что-нибудь"), false, "без заданного секрета дверь закрыта, а не открыта");
process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret-token-value";
assert.equal(checkSecret("s3cret-token-value"), true, "верный секрет проходит");
assert.equal(checkSecret("s3cret-token-valuX"), false, "подмена одного символа не проходит");
assert.equal(checkSecret("s3cret"), false, "обрезанный секрет не проходит");
assert.equal(checkSecret(null), false, "запрос без заголовка — не Telegram");

// --- взвешенный круг по темам --------------------------------------------------
// Отбор переехал из SQL в код, потому что веса стали персональными:
// второй экземпляр формулы на SQL разъехался бы с composite() молча.
// Здесь он проверяется без базы — на числах, а не на пересказе.
const candidate = (id: number, topicId: number | null, clickbait: number): Candidate => ({
  id,
  title: `материал ${id}`,
  excerpt: "",
  body: null,
  url: `https://example.com/${id}`,
  source_label: "тест",
  topic_id: topicId,
  topic_label: `тема ${topicId ?? "нет"}`,
  axes: axes({ clickbait: { noul: clickbait } }),
});

const pool: Candidate[] = [];
for (const topicId of [1, 2, 3]) {
  for (let n = 0; n < 20; n++) pool.push(candidate(topicId * 100 + n, topicId, n / 40));
}
const picked = pickSurvivors(pool, DEFAULT_WEIGHTS, new Map([[1, 11], [2, 6], [3, 3]]), 20);
assert.equal(picked.length, 20, "отбор должен отдать ровно размер дайджеста");
assert.deepEqual(
  [1, 2, 3].map((topicId) => picked.filter((s) => s.topic_label === `тема ${topicId}`).length),
  [11, 6, 3],
  "места делятся по целям, а не поровну",
);
assert.equal(
  picked.filter((s) => s.topic_label === "тема 1")[0].id, 100,
  "внутри темы первым идёт лучший по скору",
);

// Тема, которой у читателя нет, считается за единицу — как материал вне тем.
// Иначе убранная тема забирала бы прежний бюджет ещё двое суток, ровно
// столько живут сделанные до этого оценки.
const strangers = Array.from({ length: 20 }, (_, n) => candidate(900 + n, 4, n / 40));
const withStranger = pickSurvivors(
  [...pool, ...strangers],
  DEFAULT_WEIGHTS,
  new Map([[1, 11], [2, 6], [3, 3]]),
  20,
);
const strangerCount = withStranger.filter((s) => s.topic_label === "тема 4").length;
assert.ok(strangerCount <= 2, `тема без цели взяла ${strangerCount} мест — должна идти как одна`);
assert.ok(strangerCount > 0, "лучший материал вне целей должен уметь пробиться");
assert.equal(
  pickSurvivors([candidate(999, null, 0)], DEFAULT_WEIGHTS, new Map(), 5).length, 1,
  "материал вне тем не должен уронить отбор делением на ноль",
);

// --- выпуск для Kindle ----------------------------------------------------------
const book = digestHtml("2026-09-19", "интро", [
  { title: "Заголовок & <тег>", summary: "описание", url: "https://example.com/a", source_label: "И", topic_label: "Т" },
]);
// Без объявленной кодировки Kindle читает кириллицу как мусор,
// и выпуск приходит целым на вид.
assert.ok(book.includes('<meta charset="utf-8">'), "кодировка должна быть объявлена");
assert.ok(book.includes("Заголовок &amp; &lt;тег&gt;"), "разметка из заголовка должна экранироваться");
assert.ok(!book.includes("<тег>"), "сырой тег из источника не должен попасть в книгу");

// --- цена вызова --------------------------------------------------------------
// Без верной цены событие о расходе — выдумка, а дневной потолок читателя
// не срабатывает никогда.
const million = { input: 1e6, output: 0, cached: 0, reasoning: 0, requests: 1 };
delete process.env.LLM_INPUT_PRICE;
assert.equal(llmCost(million), 0.3, "без переменной берётся цена по умолчанию");
process.env.LLM_INPUT_PRICE = "";
assert.equal(llmCost(million), 0.3, "пустая переменная — это «не задано», а не ноль");
process.env.LLM_INPUT_PRICE = "1.5";
assert.equal(llmCost(million), 1.5, "заданная цена применяется");
process.env.LLM_INPUT_PRICE = "0";
assert.equal(llmCost(million), 0, "ноль — законная цена бесплатного тарифа");
process.env.LLM_INPUT_PRICE = "дорого";
assert.equal(llmCost(million), 0.3, "нечисло откатывается к цене по умолчанию");
delete process.env.LLM_INPUT_PRICE;

// --- адрес ведёт наружу, а не внутрь --------------------------------------------
// Машина общая: рядом в той же сети чужие контейнеры. Без этой проверки форма
// добавления источника — сканер внутренней сети, где «HTTP 401» на внутреннем
// адресе уже ответ.
import { isInternal } from "./fetch";
for (const inside of [
  "127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.1", "172.31.255.255",
  "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "ff02::1",
  // Служебные и зарезервированные: фида за ними нет ни одного.
  "198.18.0.1", "240.0.0.1", "192.0.2.1", "255.255.255.255", "2001:db8::1",
  // Тот же адрес в записи v4-внутри-v6, в обоих видах: проверка по префиксам
  // ловила точечный и пропускала шестнадцатеричный.
  "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:c0a8:1",
  "не адрес вовсе",
]) {
  assert.ok(isInternal(inside), `${inside} — внутренний адрес`);
}
for (const outside of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "2606:4700::1111"]) {
  assert.ok(!isInternal(outside), `${outside} — внешний адрес, его запрещать нельзя`);
}

// Перенаправление проверяется заново: публичный хост умеет увести внутрь.
const outbound = readFileSync("pipeline/fetch.ts", "utf8") + readFileSync("pipeline/og.ts", "utf8");
assert.ok(
  /redirect: "manual"/.test(outbound),
  "запрос наружу не должен ходить по перенаправлениям сам — каждое проверяется",
);
assert.ok(
  !/redirect: "follow"/.test(outbound),
  "ни один внешний запрос не должен следовать перенаправлениям без проверки адреса",
);


// --- выборка для петли качества ----------------------------------------------
// Петля меряет наш промпт, а не выпуск конкретного читателя. Сотня описаний
// у каждого — один и тот же ответ, оплаченный столько раз, сколько читателей:
// её вход дороже входа самого дайджеста, 3170 токенов на описание против 527.
{
  const items = Array.from({ length: 100 }, (_, i) => i);
  const sample = qualitySample(items);
  assert.equal(sample.length, QUALITY_SAMPLE, "из сотни берём дюжину");
  assert.deepEqual(qualitySample([1, 2, 3]), [1, 2, 3], "короткий выпуск идёт целиком");

  // Равномерно, а не первые N: описания приходят в порядке отбора, и первая
  // дюжина — всегда лучшие материалы дня. Ряд по ним поехал бы вверх
  // и перестал сравниваться с днями, когда выпуск был короче.
  assert.ok(sample.includes(0) && sample.some((n) => n > 80), "выборка покрывает весь выпуск");
  assert.ok(
    new Set(sample).size === sample.length,
    "один и тот же материал не попадает в выборку дважды",
  );
}

// --- порядок блоков в промпте дайджеста ---------------------------------------
// Провайдер кэширует совпадающий начальный кусок запроса и берёт за него
// в пятьдесят раз меньше. Персональная строка в начале рвала кэш всем сразу:
// одинаковые правила оплачивались заново у каждого читателя. Проверка
// механическая, зато ловит ровно тот регресс, который иначе виден только
// в счёте через месяц.
{
  const source = readFileSync("pipeline/digest.ts", "utf8");
  const at = (needle: string) => {
    const index = source.indexOf(needle);
    assert.ok(index > 0, `в промпте должен быть кусок ${needle}`);
    return index;
  };
  assert.ok(
    at("Язык выпуска:") < at("${voiceRules(voice)}"),
    "язык общее манеры: у читателей с одним языком префикс длиннее",
  );
  assert.ok(
    at("${voiceRules(voice)}") < at("Читатель: ${readerContext}"),
    "контекст читателя — самое персональное, и стоит последним",
  );
  assert.ok(
    at("Читатель: ${readerContext}") < at("Материалы:"),
    "материалы идут после всех правил",
  );
}


// --- спящий читатель ----------------------------------------------------------
// Выпуск пишется каждую ночь и каждую ночь стоит денег. Тот, кто две недели
// не открывал ленту, тратит их впустую — а вернуть его дешевле одним
// вопросом, чем продолжать писать в пустоту.
{
  const now = new Date("2026-09-20T00:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const reader = (over: Record<string, unknown> = {}) =>
    ({ paused_at: null, resume_at: null, onboarded_at: daysAgo(100), ...over }) as never;

  assert.equal(sleepVerdict(reader(), daysAgo(1), now).verdict, "run", "читал вчера — пишем");
  assert.equal(
    sleepVerdict(reader(), daysAgo(SLEEP_DAYS - 1), now).verdict,
    "run",
    "на день раньше срока ещё пишем: граница не должна срабатывать заранее",
  );
  const asked = sleepVerdict(reader(), daysAgo(SLEEP_DAYS + 3), now);
  assert.equal(asked.verdict, "ask", "две недели молчания — спрашиваем");
  assert.equal(asked.verdict === "ask" && asked.silentDays, 17, "в вопросе честное число дней");

  assert.equal(
    sleepVerdict(reader({ paused_at: daysAgo(2) }), daysAgo(30), now).verdict,
    "paused",
    "спросили один раз и молчим: вопрос каждую ночь — это спам, а не забота",
  );

  // У нового читателя ещё не было случая что-то открыть: пауза на второй
  // день выглядела бы поломкой, а не заботой.
  assert.equal(
    sleepVerdict(reader({ onboarded_at: daysAgo(2) }), null, now).verdict,
    "run",
    "без событий считаем от онбординга",
  );
  assert.equal(
    sleepVerdict(reader({ onboarded_at: daysAgo(40) }), null, now).verdict,
    "ask",
    "завёлся и не вернулся — тоже спящий",
  );
  assert.equal(
    sleepVerdict(reader({ onboarded_at: null }), null, now).verdict,
    "run",
    "ни событий, ни онбординга — мерить нечего",
  );

  // Отпуск — это не уход. Читатель назвал дату, и лента возвращается сама:
  // спрашивать второй раз того, кто уже ответил, — верный способ надоесть.
  const away = { paused_at: daysAgo(3), resume_at: daysAgo(-4) };
  assert.equal(
    sleepVerdict(reader(away), daysAgo(30), now).verdict,
    "paused",
    "пока отпуск не кончился, выпуск не пишется",
  );
  assert.equal(
    sleepVerdict(reader({ paused_at: daysAgo(10), resume_at: daysAgo(1) }), daysAgo(30), now).verdict,
    "wake",
    "срок вышел — лента возвращается без вопросов",
  );
}

// --- выпуск через день на бесплатном ------------------------------------------
// Реже — честнее, чем меньше: урезанный выпуск выглядит как плохой продукт,
// редкий — как бесплатный.
{
  const days = ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"];
  for (const day of days) {
    assert.ok(issuesToday(PLANS.pro, 1, day), "платный тариф приходит каждую ночь");
    assert.ok(issuesToday(PLANS.plus, 7, day), "и Plus тоже");
  }
  // Проверяем чередование, а не конкретный день: фаза зависит от номера
  // читателя, и прибитый к дате ответ сломался бы от смены нумерации.
  const free = days.map((day) => issuesToday(PLANS.free, 1, day));
  assert.deepEqual(
    free.map((yes, i) => (i === 0 ? null : yes !== free[i - 1])).slice(1),
    [true, true, true],
    "бесплатный — через ночь: соседние дни всегда разные",
  );
  assert.equal(free.filter(Boolean).length, 2, "за четыре ночи выпуск приходит дважды");

  // Номер читателя разносит бесплатных по разным ночам: иначе половина
  // ленты просыпается в один день и прогон упирается в него целиком.
  assert.notDeepEqual(
    days.map((day) => issuesToday(PLANS.free, 2, day)),
    free,
    "соседние номера попадают в разные ночи",
  );
}

// --- расположение middleware ------------------------------------------------
// Проект использует srcDirectory, и Next подключает middleware только из src/.
// Лежащий в корне файл не вызывает ни ошибки, ни предупреждения: страницы
// просто отдаются всем. Один раз так и было.
import { existsSync } from "node:fs";
assert.ok(existsSync("src/middleware.ts"), "middleware должен лежать в src/");

// Вебхук за проверкой сессии отвечает редиректом на логин, а отправитель
// читает 307 как успех и не повторяет доставку. Платёж при этом проходит,
// а тариф не выдаётся — отказ, который виден только по жалобе.
const middleware = readFileSync("src/middleware.ts", "utf8");
for (const hook of ["/api/telegram", "/api/lemon"]) {
  assert.ok(middleware.includes(`"${hook}"`), `${hook} должен быть открыт в middleware`);
  assert.ok(existsSync(`src/app${hook}/route.ts`), `${hook} должен существовать`);
}
assert.ok(!existsSync("middleware.ts"), "middleware в корне не подключается и вводит в заблуждение");


// --- тарифы -----------------------------------------------------------------
// Предел тарифа проверяется в двух местах — в форме и в прогоне, — и разойтись
// им нельзя: понижение тарифа не гасит лишние источники в каталоге, поэтому
// решает именно прогон. X платный, и ошибка здесь стоит денег, а не вида.
import { PLAN_IDS, PLANS, kindDenial, maxDigestOf, planOf, sourcesForPlan } from "../src/lib/plans";
import type { Source } from "../src/lib/types";

assert.equal(planOf("pro").id, "pro", "известный тариф читается как он сам");
assert.equal(planOf("нет такого").id, "free", "незнакомый тариф откатывается к бесплатному");
assert.equal(planOf(null).id, "free", "пустой тариф откатывается к бесплатному");
assert.ok(!PLANS.free.kinds.includes("x"), "X не должен быть доступен на бесплатном");
assert.ok(!PLANS.plus.kinds.includes("x"), "X не должен быть доступен на Plus");
assert.ok(PLANS.pro.kinds.includes("x"), "X — признак Pro");
assert.ok(
  maxDigestOf(PLANS.free) < maxDigestOf(PLANS.plus) &&
    maxDigestOf(PLANS.plus) < maxDigestOf(PLANS.pro),
  "размер выпуска должен расти с тарифом",
);

// Состояний у источника два: он заведён или убран. Выключенных не бывает —
// переключатель убран из интерфейса, а вместе с ним и третье состояние,
// из которого не было выхода: включить такой источник стало нечем, прогон
// его не читал, а в списке он выглядел живым. Убранные сюда не доходят:
// их отсекает запрос, который отдаёт каталог.
const source = (id: number, kind: Source["kind"]) =>
  ({ id, kind, active: true, label: `s${id}`, url: `https://e/${id}`, config: {},
     last_ok_at: null, last_count: null, last_error: null } as unknown as Source);

const catalogue = [
  source(3, "x"), source(1, "rss"), source(2, "hackernews"),
  source(4, "rss"), source(5, "rss"), source(6, "rss"),
  source(7, "rss"), source(8, "rss"), source(9, "rss"),
];

const onPlus = sourcesForPlan(catalogue, PLANS.plus);
assert.ok(!onPlus.some((s) => s.kind === "x"), "прогон на Plus не должен опрашивать X");

const onFree = sourcesForPlan(catalogue, PLANS.free);
assert.equal(onFree.length, PLANS.free.maxSources, "бесплатный тариф режет до своего предела");
assert.deepEqual(
  onFree.map((s) => s.id),
  [1, 2, 4, 5, 6],
  "остаются заведённые раньше, иначе набор пляшет от прогона к прогону",
);
assert.ok(
  !sourcesForPlan(catalogue, PLANS.free).some((s) => s.kind === "x"),
  "запрещённый вид отсекается до предела по числу, а не занимает место",
);

// Предел в форме обязан считать то же, что опрашивает прогон: иначе после
// понижения тарифа запрещённый вид занимает места живых источников.
const afterDowngrade = [
  source(1, "x"), source(2, "x"), source(3, "x"),
  source(4, "rss"), source(5, "rss"),
];
assert.equal(
  sourcesForPlan(afterDowngrade, PLANS.free).length,
  2,
  "прогон на бесплатном опрашивает только разрешённые виды",
);
assert.equal(
  afterDowngrade.filter((s) => PLANS.free.kinds.includes(s.kind)).length,
  2,
  "и предел в форме обязан считать по тому же правилу",
);

import {
  FEATURES, GATED, allows, cheapestWith, topicsWord, type FeatureId, type Plan,
} from "../src/lib/plans";

assert.equal(topicsWord(1), "интерес", "единственное число");
assert.equal(topicsWord(2), "интереса", "два-четыре");
assert.equal(topicsWord(5), "интересов", "пять и больше");
assert.equal(topicsWord(11), "интересов", "одиннадцать — исключение, не «интерес»");

assert.deepEqual(PLANS.free.sections, [], "бесплатный тариф не открывает платных разделов");
// Качество отбора — это качество сервиса, а не платная добавка: читатель
// на бесплатном пробует именно его. Поэтому калибровки нет среди разделов,
// которые тариф может закрыть, а из меню она убрана как наше слово,
// а не читателя — страница осталась по своему адресу.
assert.ok(
  !(GATED as readonly string[]).includes("calibration"),
  "калибровка не должна закрываться тарифом",
);
assert.ok(
  !readFileSync("src/app/(app)/settings/nav.tsx", "utf8").includes("/settings/calibration"),
  "и не должна стоять в списке разделов",
);
assert.ok(
  existsSync("src/app/(app)/settings/calibration/page.tsx"),
  "но страница остаётся: ряд чисел нужен для правок отбора",
);

// Ручка границы стоит в зазоре между кусками, а не в доле от всей ширины:
// куски выложены флексом с зазором, и доля от полной ширины промахивается
// тем сильнее, чем правее граница — на последних ручка уезжала на соседний
// сегмент и выглядела его ручкой.
{
  const counts = [15, 12, 7, 3, 3];   // 40 новостей, пять тем
  const gaps = BAR_GAP * (counts.length - 1);

  assert.equal(
    handleLeft(counts, 0),
    `calc((100% - ${gaps}px) * 0.375 + ${BAR_GAP / 2}px)`,
    "первая граница: доля от цветной части плюс половина зазора",
  );
  assert.equal(
    handleLeft(counts, 1),
    `calc((100% - ${gaps}px) * 0.675 + ${BAR_GAP * 1.5}px)`,
    "вторая граница уже прошла один зазор целиком",
  );
  // Последняя граница обязана попасть в последний зазор, а не за полосу.
  assert.equal(
    handleLeft(counts, counts.length - 2),
    `calc((100% - ${gaps}px) * 0.925 + ${BAR_GAP * 3.5}px)`,
    "у правого края ручка остаётся в своём зазоре",
  );
  assert.ok(handleLeft([1], 0).includes("100% - 0px"), "на одной теме зазоров нет");
}

// Окно с предложением показывает все тарифы, где возможность есть и которые
// дороже текущего: один самый дешёвый теряет место, где читатель выбрал бы Pro.
const offersFor = (feature: FeatureId, current: Plan) =>
  PLAN_IDS.map((id) => PLANS[id]).filter((p) => FEATURES[feature].has(p) && p.price > current.price);

assert.deepEqual(
  offersFor("language", PLANS.free).map((p) => p.id),
  ["plus", "pro"],
  "за переводом с бесплатного предлагаются оба платных тарифа",
);
assert.deepEqual(
  offersFor("delivery", PLANS.free).map((p) => p.id),
  ["plus", "pro"],
  "читалка переехала на Plus: тариф для того, кто читает",
);
assert.deepEqual(
  offersFor("delivery", PLANS.plus).map((p) => p.id),
  ["pro"],
  "с Plus за читалкой остаётся один тариф — его и предлагаем",
);
// Окно вообще не открывается тому, у кого возможность уже есть: корона
// рисуется по тому же FEATURES.has, и предлагать ему нечего.
assert.ok(FEATURES.language.has(PLANS.plus), "у Plus перевод уже есть, короны не будет");

// Темы всех читателей уходят в вопрос Jev одним списком, и каждая удлиняет
// его на каждом материале потока. Предел персонален, цена — общая, поэтому
// бесплатный тариф не должен открывать столько же, сколько платный.
assert.ok(
  PLANS.free.maxTopics < PLANS.plus.maxTopics && PLANS.plus.maxTopics < PLANS.pro.maxTopics,
  "предел по интересам растёт с тарифом",
);

// Перевод платный, а язык источника — законное значение, а не пустота:
// оно уходит в промпт и означает «оставь как в источнике».
assert.ok(!FEATURES.language.has(PLANS.free), "на бесплатном перевода нет");
assert.ok(FEATURES.language.has(PLANS.plus), "перевод есть с Plus");
assert.ok(LANGUAGES.includes(SOURCE_LANGUAGE), "язык источника — вариант списка, а не особый случай");

// Читалка — с Plus: это тариф для того, кто читает. Расход у Resend
// ступенькой, а не наклоном: 3 000 писем в месяц и 100 в день бесплатны,
// то есть до сотни ежедневных выпусков книга не стоит ничего.
assert.ok(!FEATURES.delivery.has(PLANS.free), "на бесплатном читалки нет");
assert.ok(FEATURES.delivery.has(PLANS.plus), "читалка есть с Plus");
assert.ok(FEATURES.delivery.has(PLANS.pro), "то, что открыл Plus, открыто и на Pro");

// Своё мнение — то, чем Pro отличается от Plus. Замерено $0.0007
// за нажатие: цена тарифа здесь за пользу, а не за расход.
assert.ok(!FEATURES.posts.has(PLANS.plus), "на Plus своего мнения нет");
assert.ok(FEATURES.posts.has(PLANS.pro), "своё мнение — признак Pro");
assert.deepEqual(
  offersFor("posts", PLANS.plus).map((p) => p.id),
  ["pro"],
  "за своим мнением с Plus предлагается ровно Pro",
);
// Подписка открыта всем и тарифом не закрывается вовсе: закрыть её значит
// показать кнопку «подписаться» только тем, кто уже подписан. Поэтому её
// и нет среди разделов, которые тариф может закрыть.
assert.ok(
  !(GATED as readonly string[]).includes("subscription"),
  "раздел подписки не должен закрываться тарифом",
);
assert.ok(
  allows(PLANS.plus, "language") && allows(PLANS.pro, "language"),
  "раздел, открытый дешёвым тарифом, обязан быть открыт и дорогим",
);
// Персонализация не стоит ни одного лишнего токена, поэтому тарифом
// не закрывается вовсе: держать её за деньгами значит ухудшать бесплатный
// выпуск без причины.
assert.ok(
  !(GATED as readonly string[]).includes("personalization"),
  "язык и подача не должны закрываться тарифом",
);
for (const plan of [PLANS.free, PLANS.plus, PLANS.pro]) {
  assert.ok(FEATURES.personalization.has(plan), `язык и подача доступны на ${plan.id}`);
}
for (const section of GATED) {
  // Заглушка зовёт cheapestWith и печатает его подпись: раздел, которого
  // нет ни в одном тарифе, показал бы «на тарифе Pro» и никогда не открылся.
  assert.ok(
    allows(cheapestWith(section), section),
    `раздел ${section} должен быть хоть на одном тарифе`,
  );
}

// Перечень в миграции и перечень в коде расходятся молча: база примет
// значение, которого код не знает, и planOf молча отдаст бесплатный тариф.
//
// Проверяются обе: 0019_plan завела колонку в profile, 0020 увезла её
// в readers вместе с ограничением. На живой базе работает вторая, на чистой
// применяются подряд обе, и разойтись им нельзя.
for (const file of ["0019_plan", "0020_readers"]) {
  const planSql = readFileSync(`db/migrations/${file}.sql`, "utf8");
  for (const id of PLAN_IDS) {
    assert.ok(planSql.includes(`'${id}'`), `тариф ${id} должен быть разрешён в ${file}`);
  }
}

// Вердикт по выпуску на читалку. Адрес обслуживает и ручную отправку
// отдельной статьи, поэтому выключенный выпуск не требует стереть адрес —
// и не должен молча уходить при выключенном переключателе.
{
  const full = {
    kindle_address: "a@kindle.com", kindle_sender: "igor_x1", kindle_digest: true,
    plan: "pro", subscription_id: "sub_1", subscription_status: "active", plan_ends_at: null,
  };
  const ok = kindleDigestVerdict(full);
  assert.equal(ok.send, true, "адрес, отправитель и переключатель — шлём");
  assert.equal(ok.send && ok.to, "a@kindle.com", "вердикт несёт адрес, уже сужённый");
  assert.deepEqual(
    kindleDigestVerdict({ ...full, kindle_digest: false }),
    { send: false, reason: "switched-off" },
    "выключенный переключатель отменяет выпуск, хотя адрес на месте",
  );
  assert.deepEqual(
    kindleDigestVerdict({ ...full, kindle_address: null }),
    { send: false, reason: "no-address" },
    "без адреса слать некуда, и говорить об этом не о чем",
  );
  assert.deepEqual(
    kindleDigestVerdict({ ...full, kindle_sender: null }),
    { send: false, reason: "no-sender" },
    "вписанный адрес без обратного — сбой, о нём сообщают в лог",
  );
  // Переключатель мог остаться включённым с прежнего тарифа, а письмо —
  // это чужой лимит у Amazon и счёт у Resend.
  assert.deepEqual(
    kindleDigestVerdict({ ...full, plan: "free" }),
    { send: false, reason: "plan" },
    "на тарифе без читалки выпуск книгой не уходит",
  );
  assert.deepEqual(
    kindleDigestVerdict({ ...full, subscription_status: "expired", plan_ends_at: null }),
    { send: false, reason: "plan" },
    "истёкшая подписка перестаёт слать на читалку в ту же секунду",
  );
}

// --- разбор вставленной ссылки ------------------------------------------------
// Источник добавляется одной ссылкой, тип выясняет код. Каждое правило по хосту
// проверяется здесь на строке-примере: у сервисов меняются и адреса, и разметка,
// а правило, которое перестало срабатывать, выглядит ровно как «у этого сайта
// нет фида» — отказ, неотличимый от честного ответа.
const first = (input: string) => {
  const plan = planFor(input);
  return "refuse" in plan ? null : plan.candidates[0];
};
const refusal = (input: string) => {
  const plan = planFor(input);
  return "refuse" in plan ? plan.refuse : null;
};

assert.equal(asUrl("example.com/blog")?.origin, "https://example.com", "голый домен — это адрес");
assert.equal(asUrl("from:karpathy OR from:sama"), null, "запрос X адресом не является");
assert.equal(asUrl("LocalLLaMA"), null, "слово без точки адресом не является");

// YouTube и GitHub — главная причина затеи: фид есть, но по адресу,
// который человек не угадает.
assert.equal(
  first("https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA")?.url,
  "https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA",
  "канал YouTube по id",
);
assert.equal(
  first("https://www.youtube.com/playlist?list=PLabc123")?.url,
  "https://www.youtube.com/feeds/videos.xml?playlist_id=PLabc123",
  "плейлист YouTube",
);
// У @handle id в адресе нет, зато YouTube объявляет фид в <link rel="alternate">:
// такая ссылка обязана уйти во второй слой, а не в отдельный разбор разметки.
assert.ok(
  (planFor("https://www.youtube.com/@veritasium") as { probePage: boolean }).probePage,
  "@handle уходит на разбор разметки страницы",
);
assert.equal(
  first("https://github.com/vercel/next.js")?.url,
  "https://github.com/vercel/next.js/releases.atom",
  "репозиторий GitHub — сначала релизы",
);
// Репозиторий без единого релиза отвечает 200 и пустым фидом: это отказ,
// выглядящий как успех, поэтому следом обязаны идти коммиты.
assert.equal(
  (planFor("https://github.com/vercel/next.js") as { candidates: { url: string }[] }).candidates[1].url,
  "https://github.com/vercel/next.js/commits.atom",
  "у репозитория без релизов остаются коммиты",
);
assert.equal(
  first("https://github.com/igortomko")?.url,
  "https://github.com/igortomko.atom",
  "пользователь GitHub",
);
assert.equal(first("https://simonw.substack.com/about")?.url, "https://simonw.substack.com/feed", "Substack");
assert.equal(
  first("https://arxiv.org/list/cs.AI/recent")?.url,
  "http://export.arxiv.org/rss/cs.AI",
  "раздел arXiv",
);
assert.equal(first("https://www.reddit.com/r/LocalLLaMA/")?.url, "LocalLLaMA", "сабреддит — имя, а не адрес");
assert.equal(first("https://news.ycombinator.com/")?.url, "topstories", "Hacker News по умолчанию");
assert.equal(first("https://news.ycombinator.com/newest")?.url, "newstories", "другой листинг HN");
assert.equal(first("https://x.com/karpathy")?.url, "from:karpathy", "аккаунт X превращается в запрос");
assert.equal(first("from:karpathy OR from:sama")?.kind, "x", "текст с операторами — это запрос X");
assert.equal(first("from:karpathy")?.kind, "x", "один оператор без пробелов — тоже запрос");
// Собачка есть и у Telegram, и у X, но платный из двух только X: угадать
// в его пользу значит взять деньги за догадку. Живой случай: @eugene_rid
// уходил в платную выдачу X и возвращался оттуда отказом об оплате.
assert.equal(first("@eugene_rid")?.kind, "telegram", "@имя — это канал Telegram, а не запрос X");
assert.equal(first("@eugene_rid")?.url, "eugene_rid", "собачка в имя канала не входит");
// Одинокое слово запросом не является, и слать его в платную выдачу,
// чтобы получить оттуда пустоту, незачем.
assert.ok(refusal("LocalLLaMA"), "слово без ссылки и операторов — отказ, а не платный запрос");
assert.ok(refusal("@ab"), "слишком короткое имя каналом быть не может");
assert.ok(refusal("https://x.com/home"), "служебный путь X не аккаунт");
assert.equal(first("https://t.me/durov")?.url, "durov", "канал Telegram — имя, а не адрес");
assert.equal(first("https://t.me/s/durov")?.url, "durov", "ссылка на веб-просмотр даёт тот же канал");
assert.equal(first("https://t.me/durov/123")?.url, "durov", "ссылка на пост даёт канал целиком");
// Читать закрытый чат нечем, и сказать это надо сразу, а не выяснять
// на практике.
assert.ok(refusal("https://t.me/+AbCdEf"), "приглашение в закрытый чат — отказ вслух");
assert.ok(
  (planFor("https://simonwillison.net/") as { probePage: boolean }).probePage,
  "обычный сайт идёт на разбор разметки",
);

// --- фиды, объявленные в разметке --------------------------------------------
// Разметка настоящая: относительный href у simonwillison.net, абсолютный
// у YouTube, и рядом с ними — alternate без type, который фидом не является.
const head = `
  <link rel="stylesheet" href="/style.css">
  <link rel="alternate" media="handheld" href="https://m.youtube.com/@veritasium">
  <link rel="alternate" type="application/atom+xml" title="Atom" href="/atom/everything/">
  <link type='application/rss+xml' rel='alternate' href='/blog/rss'>
  <link rel="alternate" type="application/rss+xml" title="RSS" href="https://www.youtube.com/feeds/videos.xml?channel_id=UCH">
`;
const links = feedLinks(head, "https://simonwillison.net/blog/");
assert.equal(links.length, 3, "берутся только объявления фидов, а не всякий alternate");
assert.equal(links[0], "https://simonwillison.net/atom/everything/", "относительный href разворачивается");
assert.equal(links[1], "https://simonwillison.net/blog/rss", "кавычки и порядок атрибутов бывают любые");
assert.ok(links[2].includes("channel_id=UCH"), "абсолютный href остаётся как есть");
assert.deepEqual(feedLinks("<html><body>ничего</body></html>", "https://a.com"), [], "нет объявлений — нет адресов");
// У YouTube объявление фида лежит в теле, на 761-й тысяче символов из 2,7 млн.
// Отсечка «фид объявляют в шапке» давала «у этого сайта нет фида» ровно
// на том случае, ради которого всё затевалось.
assert.equal(
  feedLinks(
    `<head><title>x</title></head><body>${"<p>текст</p>".repeat(40_000)}` +
      `<link rel="alternate" type="application/rss+xml" href="/late.xml"></body>`,
    "https://a.com",
  )[0],
  "https://a.com/late.xml",
  "объявление фида ищется во всём документе, а не в первых килобайтах",
);

assert.ok(looksLikeFeed('<?xml version="1.0"?><rss version="2.0">'), "фид с декларацией");
assert.ok(looksLikeFeed('<feed xmlns="http://www.w3.org/2005/Atom">'), "Atom без декларации");
assert.ok(!looksLikeFeed("<!doctype html><html>"), "страница фидом не притворяется");

const guessed = guesses("https://example.com/blog");
assert.ok(guessed.includes("https://example.com/blog/feed"), "путь пробуется относительно страницы");
assert.ok(guessed.includes("https://example.com/atom.xml"), "и относительно корня");

// --- почему фида не нашлось ---------------------------------------------------
// «Фида нет», «страница собирается в браузере» и «пейволл» — три разных ответа
// для читателя, и одинаковое «не нашлось» на все три ему ничего не говорит.
const paywalled = diagnose('<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>');
const shellOnly = diagnose(`<!doctype html><html><head><title>x</title></head><body><div id="root"></div><script>${"var a=1;".repeat(300)}</script></body></html>`);
assert.ok(paywalled, "подписка объявляет себя сама, в schema.org");
assert.ok(shellOnly, "пустая оболочка под скриптом распознаётся");
// Различимость, а не формулировка: сами слова — предмет правок текста,
// и держать их золотым образцом значит ронять тест на каждой такой правке.
// Слипшиеся причины тест по-прежнему ловит.
assert.notEqual(paywalled, shellOnly, "две разные причины не должны давать один ответ");
assert.equal(
  diagnose(`<html><body><article>${"Обычная страница с настоящим текстом внутри. ".repeat(20)}</article></body></html>`),
  null,
  "у живой страницы причины нет — значит, фида и правда нет",
);

// --- почему источник не ответил -----------------------------------------------
// Node отдаёт «fetch failed» и на несуществующий домен, и на просроченный
// сертификат, и на оборванное соединение, а настоящую причину прячет в cause.
// Одинаковая строка в списке источников не даёт решить, чинить адрес, ждать
// или выбрасывать источник.
const failed = (code: string) =>
  Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("x"), { code }) });

assert.equal(explain(failed("ENOTFOUND")), "домен не существует", "несуществующий домен назван");
assert.equal(explain(failed("CERT_HAS_EXPIRED")), "просроченный сертификат", "сертификат назван");
assert.equal(explain(failed("ECONNREFUSED")), "хост отказал в соединении", "отказ в соединении назван");
assert.notEqual(explain(failed("ENOTFOUND")), explain(failed("ECONNRESET")), "разные причины — разный текст");
assert.equal(
  explain(new Error("HTTP 402")),
  "нужна оплата (402) — у провайдера кончился баланс",
  "402 от перепродавца X — это счёт, а не поломка источника",
);
assert.equal(explain(new Error("HTTP 403")), "источник закрылся от робота (403)", "403 — это не поломка адреса");
assert.equal(explain(new Error("HTTP 404")), "адрес больше не существует (404)", "404 назван");
assert.equal(explain(new Error("HTTP 429")), "источник просит реже (429)", "429 назван");
assert.equal(explain(new Error("HTTP 503")), "сервер источника не в порядке (503)", "пятисотые назван");
assert.equal(
  explain(Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" })),
  "не ответил за отведённое время",
  "таймаут назван",
);
// Незнакомую ошибку нельзя проглатывать: лучше сырой текст, чем ровное
// «что-то пошло не так» на всё подряд.
assert.equal(explain(new Error("не похоже на RSS или Atom")), "не похоже на RSS или Atom", "незнакомое доходит как есть");
assert.equal(explain(undefined), "не ответил без объяснений", "пустая ошибка не даёт пустую строку");

// --- публичный канал Telegram -------------------------------------------------
// Разбор чужой разметки ломается при её смене молча, поэтому тест идёт
// по сохранённому куску настоящей страницы, а не по её представлению
// в чьей-то голове. Обновлять файл — новым сохранением.
const tgPage = readFileSync("pipeline/fixtures/telegram-channel.html", "utf8");
const tg = parseTelegram(tgPage, "telegram");
assert.equal(tg.title, "Telegram News", "название канала берётся из og:title");
assert.equal(tg.items.length, 2, `постов ${tg.items.length}, в куске сохранено 2`);
assert.match(tg.items[0].url, /^https:\/\/t\.me\/telegram\/\d+$/, "ссылка ведёт на конкретный пост");
assert.notEqual(tg.items[0].url, tg.items[1].url, "у постов разные адреса — иначе дедуп схлопнет канал в один");
assert.ok(tg.items[0].title.length > 0, "у поста есть заголовок");
assert.ok(tg.items[0].title.length <= 200, "заголовок не длиннее двухсот символов");
// <br> превращается в перенос до чистки тегов: иначе заголовком становится
// весь пост целиком, а не его первая строка.
assert.ok(!tg.items[0].title.includes("\n"), "заголовок — одна строка");
assert.ok(
  tg.items[0].excerpt.length > tg.items[0].title.length,
  "в тексте поста больше, чем в его первой строке",
);
assert.ok(tg.items[0].published_at instanceof Date, "дата поста разобрана");
assert.ok(
  (tg.items[1].published_at?.getTime() ?? 0) > (tg.items[0].published_at?.getTime() ?? 0),
  "у постов разные даты, и они идут по возрастанию — на этом держится отсечка свежести",
);

// Пост без текста — одни картинки. Такие бывают, и если резать страницу
// тремя независимыми списками, один такой пост сдвинет все даты на единицу,
// и каждая новость получит чужое время. Выглядит это нормально.
const mediaOnly = tgPage.replace(
  /<div class="tgme_widget_message_text[^"]*"[^>]*>[\s\S]*?<\/div>/,
  '<div class="tgme_widget_message_photo"></div>',
);
const trimmed = parseTelegram(mediaOnly, "telegram");
assert.equal(trimmed.items.length, 1, "пост без текста пропускается, а не занимает чужое место");
assert.equal(
  trimmed.items[0].published_at?.toISOString(),
  tg.items[1].published_at?.toISOString(),
  "у оставшегося поста своя дата, а не съехавшая на соседнюю",
);

// Закрытый, несуществующий и выключивший веб-просмотр канал отвечает 200
// и уводит на страницу контакта. Сохранить такой источник значит завести
// пустую вкладку, которая через неделю выглядит просто заброшенной.
assert.throws(
  () => parseTelegram(readFileSync("pipeline/fixtures/telegram-contact.html", "utf8"), "нет"),
  /не публичный канал/,
  "страница контакта — это отказ, а не пустой канал",
);

// --- письма -------------------------------------------------------------------
// Выделенный ящик: одно письмо — один материал, дедуп по Message-ID,
// отправитель опознаётся по From. Из письма не подгружается ничего.
//
// Куски собраны руками и покрывают кодировки, которые рассылки используют
// на самом деле: тема в base64 по RFC 2047, текст в quoted-printable,
// разметка в base64, Message-ID, перенесённый по строкам.
// latin1, а не utf8: ровно так письмо приходит из сокета — байт в байт.
// Прочитав его как utf8, мы бы декодировали текст дважды, и кириллица
// рассыпалась бы в «&5=0 A?>B». Длина литерала в IMAP тоже считается
// в байтах, и только при latin1 она совпадает с длиной строки.
const rawLetter = readFileSync("pipeline/fixtures/letter-newsletter.eml", "latin1");
const letter = parseLetter(rawLetter);

assert.equal(letter.subject, "Выпуск 142: чем кончилась история с ценами на уран", "тема из base64 по RFC 2047");
// Message-ID переносится по строкам, как всякий длинный заголовок.
// Неразвёрнутый, он перестаёт совпадать сам с собой, и письмо приезжает
// в ленту заново каждый прогон.
assert.equal(
  letter.messageId,
  "0000019a-4f21-7c3d-9b55-aa1c2d3e4f50 @mail.example-letter.test",
  "Message-ID собирается из перенесённых строк",
);
assert.equal(addressOf(letter.from), "letters@example-letter.test", "отправитель опознаётся по From");
assert.equal(letter.date?.getUTCDate(), 18, "дата письма разобрана");
// Простой текст предпочитается разметке: он уже написан для чтения.
assert.ok(letter.text.includes("142 долларов"), "текст расшифрован из quoted-printable");
assert.ok(letter.text.includes("—"), "=E2=80=94 разворачивается в тире, а не остаётся кодом");
assert.ok(!letter.text.includes("=E2"), "в тексте не остаётся кодов quoted-printable");

// Трекинговый пиксель — это <img src>. Он не должен ни подгружаться,
// ни попасть в поле адреса, ни доехать до текста.
assert.ok(!letter.text.includes("track.example-letter.test"), "пиксель не доезжает до текста");
assert.notEqual(letter.link, "https://track.example-letter.test/open/abc123.gif", "пиксель не становится адресом");
// Веб-версия берётся из того, что объявил отправитель (List-Archive),
// а не из первой попавшейся ссылки.
assert.equal(letter.link, "https://example-letter.test/archive", "ссылка из объявленного архива рассылки");

assert.equal(decodeWords("=?utf-8?q?=D0=A6=D0=B5=D0=BD=D0=B0?="), "Цена", "quoted-printable в заголовке");
assert.equal(decodeWords("Обычная тема"), "Обычная тема", "незакодированный заголовок не трогается");
assert.equal(addressOf("Ben Thompson <ben@stratechery.com>"), "ben@stratechery.com", "адрес из имени со скобками");
assert.equal(addressOf("plain@example.com"), "plain@example.com", "голый адрес остаётся собой");
assert.equal(imapDate(new Date("2026-09-19T00:00:00Z")), "19-Sep-2026", "дата в том виде, в каком её ждёт SEARCH");

// Ответ сервера режется по объявленной длине литерала, а не по виду строки:
// в теле письма встречается что угодно, включая строку, неотличимую
// от служебной. Порезав по виду, получили бы короткое письмо вместо ошибки.
const fetched = readFileSync("pipeline/fixtures/imap-fetch.txt", "latin1");
const letters = lettersFrom(fetched);
assert.equal(letters.length, 2, `писем ${letters.length}, в ответе два`);
assert.ok(letters[1].text.includes("d4 OK FETCH completed"), "служебная на вид строка внутри письма — это текст письма");
assert.ok(letters[1].text.includes("Отвечаем в следующем выпуске"), "письмо не обрывается на этой строке");
assert.notEqual(letters[0].messageId, letters[1].messageId, "у писем разные Message-ID — на них держится дедуп");

// То же самое на уровне протокола: «тег OK» внутри литерала не заканчивает
// ответ, и ждать надо дальше.
const withLiteral = "* 1 FETCH (UID 1 BODY[] {22}\r\nd3 OK не конец ответа\nd3 OK done\r\n";
assert.equal(responseEnd(withLiteral, "d3"), withLiteral.length, "ответ кончается после литерала, а не внутри него");
assert.equal(responseEnd("* 1 EXISTS\r\n", "d3"), -1, "незаконченный ответ не считается законченным");
const refused = "d3 NO [AUTHENTICATIONFAILED]\r\n";
assert.equal(responseEnd(refused, "d3"), refused.length, "отказ тоже конец ответа");

// --- X только на Pro ----------------------------------------------------------
// X — единственный платный вид источника: счёт идёт за прочитанные посты.
// Тариф спрашивается не только при сохранении, но и до разбора ссылки:
// разбор X — это уже запрос к twitterapi.io. Потратить деньги и отказать
// после значит взять плату за отказ.
assert.equal(kindDenial(PLANS.pro, "x"), null, "на Pro источники X разрешены");
assert.ok(kindDenial(PLANS.free, "x"), "на бесплатном X закрыт");
assert.ok(kindDenial(PLANS.plus, "x"), "на Plus X тоже закрыт");
assert.match(kindDenial(PLANS.free, "x")!, /Pro/, "отказ называет тариф, который его открывает");
for (const freeKind of ["rss", "hackernews", "telegram", "email"] as const) {
  assert.equal(kindDenial(PLANS.free, freeKind), null, `${freeKind} остаётся на бесплатном тарифе`);
}
// Вид известен до всякой сети — на этом и держится отказ без запроса.
assert.equal(
  (planFor("from:karpathy OR from:sama") as { candidates: { kind: string }[] }).candidates[0].kind,
  "x",
  "запрос X опознаётся правилом, а не пробой",
);
assert.equal(
  (planFor("https://x.com/karpathy") as { candidates: { kind: string }[] }).candidates[0].kind,
  "x",
  "ссылка на аккаунт X — тоже X",
);

// Порядок шагов настройки Kindle. Перепутанные условия дали бы экран,
// на котором просят одобрить отправителя, которого ещё не выдали.
assert.equal(
  kindleSetupStep({ kindle_address: null, kindle_approved: false }), "address",
  "адреса нет — первый шаг",
);
assert.equal(
  kindleSetupStep({ kindle_address: "a@kindle.com", kindle_approved: false }), "sender",
  "адрес есть, отправитель не одобрен — второй шаг",
);
assert.equal(
  kindleSetupStep({ kindle_address: "a@kindle.com", kindle_approved: true }), "done",
  "одобрено — обычные настройки",
);
// Подтверждение весомее адреса: стёртое поле в настройках выключает отправку,
// но не отправляет читателя проходить настройку заново. Сброс снимает и то,
// и другое — иначе экран и база считали бы шаг по-разному.
assert.equal(
  kindleSetupStep({ kindle_address: null, kindle_approved: true }), "done",
  "подтверждение держит экран настроек даже без адреса",
);

// Имя обратного адреса. Telegram-id, а не username: username читатель меняет
// когда захочет, а адрес после одобрения в Amazon заморожен навсегда.
assert.equal(kindleSenderName(1, "52308619"), "52308619", "адрес собирается из Telegram-id");
assert.equal(kindleSenderName(1, 52308619), "52308619", "число из драйвера и строка дают одно имя");
assert.equal(kindleSenderName(7, null), "reader7", "без привязанного Telegram — номер читателя");
// Пустая строка и мусор — не id. Приняв их за имя, мы бы выдали адрес
// вида `@kindle.tomko.io`, и письма исчезали бы молча.
assert.equal(kindleSenderName(7, ""), "reader7", "пустая строка именем не становится");
assert.equal(kindleSenderName(7, "igortomko"), "reader7", "username именем не становится");

// --- отправка статьи на читалку ------------------------------------------------
import { splitBlocks, chunkBlocks, chunkProblem, alreadyIn } from "./translate";
import { samplePairs } from "./translation-quality";
import { articleBlocker } from "./kindle";
import { parseUpdate as parseBotUpdate } from "../src/lib/telegram";
import type { Reader } from "../src/lib/types";

// Модель на длинном тексте возвращает пересказ вместо перевода. Книга при
// этом приходит, текст на русском, абзацы на месте — просто их меньше.
// Эти проверки и есть единственное, что отличает такой отказ от успеха.
const src = ["Первый абзац достаточной длины.", "Второй абзац той же длины."];
assert.ok(chunkProblem(src, ["Раз.", "Два."]).startsWith("короче"), "пересказ ловится по длине");
assert.ok(chunkProblem(src, ["Один длинный блок вместо двух."]).startsWith("блоков"), "потерянный блок ловится по счёту");
assert.equal(chunkProblem(src, src), "", "перевод той же длины и числа блоков проходит");

// Отступ слева обязан пережить нарезку: по нему узнаётся листинг без
// заборчика из обратных кавычек. Общий trim его съедал, и такой код
// молча уходил в перевод.
assert.ok(splitBlocks("Текст\n\n    int main() {}")[1].startsWith("    "), "отступ листинга сохраняется");
assert.equal(splitBlocks("Текст  \n\nЕщё")[0], "Текст", "хвостовые пробелы убираются");
assert.equal(splitBlocks("\n\n  \n\n").length, 0, "пустой текст не даёт блоков-призраков");
assert.equal(chunkBlocks(["одинокий блок длиннее потолка"], 5).length, 1, "блок длиннее потолка не выбрасывается");

// Оценка перевода смотрит на прозу, а не на листинги и заголовки:
// они одинаково хороши в любом переводе и разбавили бы ряд.
const long = (mark: string) => mark + "я".repeat(250);
const pairs = samplePairs(
  ["```int main(){}```", long("а"), "## Заголовок", long("б")],
  ["```int main(){}```", long("а"), "## Заголовок", long("б")],
);
assert.ok(pairs.every((pair) => !pair.from.startsWith("```")), "листинги в выборку не попадают");
assert.ok(pairs.every((pair) => !pair.from.startsWith("##")), "заголовки в выборку не попадают");
assert.equal(samplePairs([], []).length, 0, "пустая статья не ломает выборку");

// Три причины отказа, и каждая выключает по своей.
const base = { id: 1, daily_cap_usd: 1, kindle_address: "a@kindle.com", kindle_sender: "52308619", kindle_approved: true } as Reader;
const blockers = [
  articleBlocker({ ...base, kindle_address: null }, 0),
  articleBlocker({ ...base, kindle_sender: null }, 0),
  articleBlocker({ ...base, kindle_approved: false }, 0),
  articleBlocker(base, 1),
];
assert.ok(blockers.every((text) => text.length > 0), "каждая из четырёх причин останавливает отправку");
// Различимость, а не формулировка: одинаковый текст на разные причины
// оставил бы читателя чинить не то. Сами слова — предмет правок текста,
// и держать их золотым образцом значит ронять тест на каждой такой правке.
assert.equal(new Set(blockers).size, 4, "причины отказа должны быть различимы на глаз");
assert.match(
  articleBlocker({ ...base, kindle_approved: false }, 0), /Amazon/,
  "неодобренный отправитель называет Amazon: чинится это только там",
);
assert.match(
  articleBlocker(base, 1), /завтра/,
  "предел, который снимется сам, обязан сказать когда — иначе читатель идёт искать несуществующую настройку",
);
assert.equal(articleBlocker(base, 0.5), "", "настроенная отправка не блокируется");

// Нажатие кнопки приходит не сообщением, а callback_query. Без этой ветки
// оно проваливалось в ignore: часики на кнопке крутились, ответ терялся.
const tap = parseBotUpdate({ callback_query: { id: "c1", data: "fin:42:1", from: { id: 7 } } });
assert.equal(tap.kind, "finished", "нажатие кнопки разбирается");
assert.equal(tap.kind === "finished" && tap.itemId, 42, "id материала достаётся из нагрузки");
assert.equal(tap.kind === "finished" && tap.finished, true, "единица значит «дочитал»");
assert.equal(parseBotUpdate({ callback_query: { id: "c1", data: "fin:42:0", from: { id: 7 } } }).kind, "finished", "ноль тоже ответ, а не мусор");
assert.equal(parseBotUpdate({ callback_query: { id: "c1", data: "чужое:1:1", from: { id: 7 } } }).kind, "ignore", "чужая нагрузка игнорируется");
assert.equal(parseBotUpdate({ callback_query: { id: "c1", data: "fin:42:1", from: { id: 7, is_bot: true } } }).kind, "ignore", "нажатие от бота игнорируется");

// Русский текст русскому читателю переводить нечего. Без этой проверки
// он уходил в модель, возвращался почти собой же и стоил как перевод.
assert.ok(alreadyIn("Совет директоров одобрил сделку в среду вечером.", "русском"), "русский текст узнаётся");
assert.ok(!alreadyIn("The board approved the deal on Wednesday evening.", "русском"), "английский не принимается за русский");
assert.ok(!alreadyIn("Совет директоров одобрил сделку.", "английском"), "для английского читателя проверка молчит");
assert.ok(!alreadyIn("", "русском"), "пустой текст не делит на ноль");
assert.ok(alreadyIn("Релиз Kubernetes 1.34 добавил поддержку swap на узлах.", "русском"), "латинские термины внутри русского не сбивают счёт");


// --- подписка Lemon Squeezy --------------------------------------------------
// Тариф выдаётся только подписанным событием с их стороны, а действует он,
// пока оплачен. Обе ошибки молчаливы: лишний платный выпуск и снятый раньше
// срока тариф одинаково не видны в логе.
process.env.LEMON_VARIANT_PLUS = "111";
process.env.LEMON_BUY_PLUS = "https://shop.lemonsqueezy.com/buy/aaa";
process.env.LEMON_VARIANT_PRO = "222";
process.env.LEMON_BUY_PRO = "https://shop.lemonsqueezy.com/buy/bbb";
process.env.LEMON_WEBHOOK_SECRET = "s3cret";

const paid = (over: Record<string, unknown> = {}) =>
  ({ id: 1, plan: "pro", subscription_status: "active", plan_ends_at: null,
     plan_renews_at: null, subscription_id: "sub_1", portal_url: null, ...over }) as never;

const DAY = 86_400_000;
assert.equal(effectivePlan(paid()).id, "pro", "активная подписка даёт купленный тариф");
assert.equal(
  effectivePlan(paid({ subscription_status: "cancelled", plan_ends_at: new Date(Date.now() + DAY).toISOString() })).id,
  "pro",
  "отменённая подписка работает до конца оплаченного периода",
);
assert.equal(
  effectivePlan(paid({ subscription_status: "cancelled", plan_ends_at: new Date(Date.now() - DAY).toISOString() })).id,
  "free",
  "после конца оплаченного периода тариф гаснет сразу, а не к ночному прогону",
);
assert.equal(
  effectivePlan(paid({ subscription_status: "expired", plan_ends_at: null })).id,
  "free",
  "истёкшая подписка не даёт платного выпуска",
);
assert.equal(effectivePlan(paid({ plan: "free" })).id, "free", "бесплатный остаётся бесплатным");

// Владелец не покупает подписку у себя самого, и проверять её статус
// не по чему: у него действует то, что стоит в колонке. Так там и стояло
// «pro» — и гасло проверкой на подписку, которой нет.
assert.equal(
  effectivePlan(paid({ plan: "pro", owner: true, subscription_status: null, plan_ends_at: null })).id,
  "pro",
  "у владельца работает купленное без подписки",
);
assert.equal(
  effectivePlan(paid({ plan: "free", owner: true, subscription_status: null })).id,
  "free",
  "и бесплатный тоже: иначе владелец не увидит продукт глазами бесплатного читателя",
);
assert.equal(
  effectivePlan(paid({ plan: "pro", owner: false, subscription_status: null, plan_ends_at: null })).id,
  "free",
  "остальным тариф по-прежнему даёт только подписка",
);
assert.ok(endingAt(paid({ plan_ends_at: new Date(Date.now() + DAY).toISOString() })), "дата конца видна интерфейсу");
assert.equal(endingAt(paid()), null, "у активной подписки конца нет");

const signedBody = JSON.stringify({ hello: "world" });
const goodSignature = createHmac("sha256", "s3cret").update(signedBody).digest("hex");
assert.ok(signatureValid(signedBody, goodSignature), "своя подпись принимается");
assert.ok(!signatureValid(signedBody, goodSignature.replace(/.$/, "0")), "чужая подпись отвергается");
assert.ok(!signatureValid(signedBody, null), "без подписи — отказ");
assert.ok(!signatureValid(signedBody, "не-шестнадцатеричное"), "мусор вместо подписи не роняет разбор");

const lemonEvent = (over: Record<string, unknown> = {}) => ({
  meta: { event_name: "subscription_updated", custom_data: { reader_id: 7 } },
  data: { id: "sub_9", attributes: { variant_id: 222, status: "active", renews_at: "2026-11-01T00:00:00Z", ends_at: null } },
  ...over,
});

const applied = readEvent(lemonEvent() as never);
assert.ok(applied.ok && applied.readerId === 7 && applied.update.plan === "pro", "вариант превращается в тариф");
assert.ok(!readEvent(lemonEvent({ meta: { event_name: "order_created" } }) as never).ok, "не про подписку — мимо");
assert.ok(
  !readEvent(lemonEvent({ meta: { event_name: "subscription_created", custom_data: {} } }) as never).ok,
  "без номера читателя платёж некому засчитать",
);
assert.ok(
  !readEvent({ ...lemonEvent(), data: { id: "x", attributes: { variant_id: 999, status: "active" } } } as never).ok,
  "чужой вариант не выдаёт тариф",
);
const expiredEvent = readEvent({
  ...lemonEvent(),
  data: { id: "sub_9", attributes: { variant_id: 222, status: "expired" } },
} as never);
assert.ok(expiredEvent.ok && expiredEvent.update.plan === "free", "истёкшая подписка сбрасывает тариф");

assert.ok(checkoutUrl("pro", 42)?.includes("reader_id"), "номер читателя уходит в оплату");
assert.equal(checkoutUrl("free" as never, 42), null, "у бесплатного тарифа нет оплаты");

// --- ссылка, присланная боту --------------------------------------------------
// Прислать ссылку боту — тот же жест, что вставить её в форму. Отвечать
// на него подсказкой «напиши /start» значит делать вид, что не понял.
assert.equal(parseUpdate(privateStart("https://t.me/durov")).kind, "link", "ссылка заводит источник");
assert.equal(parseUpdate(privateStart("@eugene_rid")).kind, "link", "@имя — тоже ссылка");
assert.equal(parseUpdate(privateStart("simonwillison.net")).kind, "link", "голый домен — тоже");
assert.equal(
  (parseUpdate(privateStart(" https://example.com/feed ")) as { text: string }).text,
  "https://example.com/feed",
  "пробелы по краям снимаются до разбора",
);
// Разговор остаётся разговором, а команда — командой: и то и другое не должно
// уходить в сеть за фидом.
assert.equal(parseUpdate(privateStart("привет")).kind, "help", "слово без точки — не ссылка");
assert.equal(parseUpdate(privateStart("/start")).kind, "start", "команда остаётся командой");
assert.equal(parseUpdate(privateStart("а что ты умеешь?")).kind, "help", "фраза с пробелами — не ссылка");
// Поисковый запрос X в переписке неотличим от фразы, и гадать в его пользу
// нельзя: он платный.
assert.ok(!looksLikeSource("uranium OR SMR min_faves:100"), "запрос X в чате не читается как источник");
assert.ok(!looksLikeSource("/help"), "команда не источник");
assert.ok(!looksLikeSource(""), "пустая строка не источник");

// Тариф без подписки — это тариф, выставленный руками: pro владельца стоит
// в колонке с самой первой миграции, а подписки у него нет и не будет.
// Спрашивать у отсутствующей подписки, действует ли она, — значит гасить
// владельцу его же возможности, оставив в базе правильный plan.
{
  const manual = { plan: "pro", subscription_id: null, subscription_status: null,
    plan_ends_at: null } as Reader;
  assert.equal(effectivePlan(manual).id, "pro", "тариф без подписки действует как выставленный");
  const expired = { ...manual, subscription_id: "sub_1", subscription_status: "expired" };
  assert.equal(effectivePlan(expired).id, "free", "истёкшая подписка гаснет в ту же секунду");
  const cancelled = {
    ...manual, subscription_id: "sub_1", subscription_status: "cancelled",
    plan_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
  };
  assert.equal(effectivePlan(cancelled).id, "pro", "отменённая дочитывает оплаченный месяц");
}

// ---------------------------------------------------------------------------
// Блогерский Pro: голос, каркас и пост под чужим именем.
//
// Здесь проверяется то, чей отказ выглядит как успех: пост приходит, он даже
// читается нормально — просто с выдуманным числом, длиной не для этой сети
// или не тем голосом.
// ---------------------------------------------------------------------------

// Ссылка в X съедает 23 символа, какой бы длины ни была. Считать text.length
// значит отдать читателю пост, который X не примет, — и узнает он сам.
{
  const link = `https://example.com/${"a".repeat(300)}`;
  assert.equal(
    postLength(NETWORKS.x, `Коротко. ${link}`),
    "Коротко. ".length + 23,
    "в X ссылка считается за 23 символа",
  );
  assert.ok(!overLimit(NETWORKS.x, `Коротко. ${link}`), "длинная ссылка не выносит за предел");
  assert.ok(overLimit(NETWORKS.x, "я".repeat(281)), "281 символ в X — за пределом");
  assert.ok(!overLimit(NETWORKS.blog, "я".repeat(5000)), "у блога предела нет");
}

// У каждого таба должно быть своё требование в промпте: таб без требования
// молча отдаёт текст чужой длины, и на глаз это незаметно.
for (const id of NETWORK_IDS) {
  const network = NETWORKS[id];
  if (!network.tab) continue;
  assert.ok(network.rule.includes(`${id}:`), `${id}: требование для промпта названо своим именем`);
  assert.ok(network.limit > 0, `${id}: у таба есть предел длины`);
}
assert.deepEqual(
  tabsOf(["blog", "x", "telegram"]).map((network) => network.id),
  ["telegram", "x"],
  "блог — источник голоса, а не таб: в мотатке его нет",
);
assert.deepEqual(readableOf(["linkedin", "threads"]).map((n) => n.id), [],
  "из LinkedIn и Threads читать нечего: они наружу не отдают ничего");

// Выдуманное число под его именем — самая дорогая ошибка этой возможности,
// и запрет в промпте на неё протекает (проверено живым прогоном).
{
  const source = "INEOS starts storing up to 400,000 tonnes of CO2 a year, aiming at 4-8 million.";
  assert.deepEqual(
    unverifiedNumbers("Берут 400 тыс. т в год, целятся в 4–8 млн", source),
    [],
    "то же число другой записью выдумкой не считается",
  );
  assert.deepEqual(
    unverifiedNumbers("Это меньше, чем выбрасывает завод на 12 тыс. тонн", source),
    ["12"],
    "число, которого в материале нет, называется",
  );
  assert.deepEqual(
    unverifiedNumbers("В 2026 г. запустили 1 полигон", source),
    [],
    "год и однозначное число не ловятся: ложная тревога на каждом посте — это выключенная тревога",
  );
}

// Разбор ответа модели: два варианта на сеть, и одна строка вместо массива —
// законный ответ, а не повод уронить нажатие.
{
  const item = {
    id: 1, title: "Хранилище CO2 в Дании", summary: "400 тыс. т в год",
    excerpt: "", url: "https://example.com/a", source_label: "oilprice",
  };
  const parsed = parseDrafts(
    JSON.stringify({
      telegram: ["первый вариант поста", "второй вариант поста"],
      x: "один вариант",
      added: ["сравнение с цементным заводом"],
    }),
    item,
    [NETWORKS.telegram, NETWORKS.x],
  );
  assert.equal(parsed.drafts.filter((d) => d.network === "telegram").length, 2, "два варианта на сеть");
  assert.deepEqual(
    parsed.drafts.filter((d) => d.network === "x").map((d) => d.variant),
    [1],
    "одна строка вместо массива читается как единственный вариант",
  );
  assert.deepEqual(parsed.added, ["сравнение с цементным заводом"], "добавленное моделью доходит до читателя");
  assert.equal(
    parseDrafts(JSON.stringify({ telegram: ["текст"] }), item, [NETWORKS.telegram]).added.length,
    0,
    "нет поля added — пустой список, а не отказ",
  );
}

// Карточка автора. Пустой голос — это отказ, и он обязан быть слышен:
// карточка без пунктов выглядит настроенной, а посты по ней пишутся ничьим
// голосом.
{
  const meta = { built_from: 20, sources: ["telegram"], ranked: true };
  const card = parseCard('{"voice":["короткие фразы"],"frame":["в верхних есть число"],"taboo":["без хэштегов"]}', meta);
  assert.deepEqual(card.voice, ["короткие фразы"], "голос разобран");
  assert.equal(card.ranked, true, "статистика была — каркас оставлен");
  assert.throws(
    () => parseCard('{"voice":[],"frame":["что-то"]}', meta),
    /ни одного пункта про голос/,
    "карточка без голоса не сохраняется молча",
  );
  assert.deepEqual(
    parseCard('{"voice":["а"],"frame":["выдуманный каркас"]}', { ...meta, ranked: false }).frame,
    [],
    "без просмотров каркас отбрасывается: догадка, выданная за наблюдение, хуже пустоты",
  );
  // Кривой JSON поймался на живом канале: провайдер не экранировал кавычку
  // внутри цитаты, и JSON.parse падал на середине. Уронить всю карточку
  // из-за одной строки — потерять и то, что доехало целым.
  const broken = parseCard(
    '{"voice":["короткие фразы","цитирует так: "вот так" и ломает JSON"],"frame":["в верхних есть число"],"taboo":[]}',
    meta,
  );
  assert.ok(broken.voice.length >= 1, "из кривого JSON спасается то, что закрылось");
  assert.deepEqual(broken.frame, ["в верхних есть число"], "соседний ключ от поломки не страдает");
  // Обрыв на середине массива — то же самое: закрывшиеся строки остаются.
  const cut = parseCard('{"voice":["первый пункт","второй пункт","третий недо', meta);
  assert.deepEqual(cut.voice, ["первый пункт", "второй пункт"], "обрыв не уносит целые пункты");
}

// Запасная карточка из настроек подачи. built_from = 0 — то самое, по чему
// мотатка говорит «голос ещё не собран»: без этой подписи блогер прочтёт
// общий черновик и решит, что возможность не работает.
{
  const fallback = cardFromVoice({ language: "русском", complexity: 5, style: "телеграфный" });
  assert.equal(fallback.built_from, 0, "запасная карточка ни на чём не собрана, и это видно");
  assert.deepEqual(fallback.frame, [], "каркаса в запасной карточке нет");
  // Без прочитанных постов промпт обязан сказать, что формы мы не знаем,
  // а не выдумать её: пост чужой формой выдаёт себя раньше, чем чужими словами.
  assert.ok(
    cardBlock(fallback).includes("Формы его постов мы не знаем"),
    "промпт честно говорит, что формы мы не знаем",
  );
  assert.ok(!cardBlock(fallback).includes("его пост 1"), "примеров нет — их неоткуда взять");
  assert.ok(
    cardBlock({
      voice: ["а"], structure: [], hooks: [], samples: [], frame: ["б"], taboo: [],
      built_from: 9, sources: [], ranked: true,
    }).includes("сравнением его же постов по просмотрам"),
    "каркас в промпте назван тем, чем он является: сравнением его постов",
  );
}

// Карточка, записанная прежней версией: голос и каркас есть, формы, приёмов
// и примеров нет — их тогда не собирали. Ровно так выглядела единственная
// живая карточка 20 сентября 2026, и нажатие «Своё мнение» отвечало
// «Cannot read properties of undefined (reading 'length')» вместо поста.
{
  const stored = asCard({
    voice: ["короткие фразы"], frame: ["в верхних число в первой строке"],
    taboo: ["без эмодзи"], built_from: 21, sources: ["telegram"], ranked: true,
  });
  assert.ok(stored, "карточка прежней версии остаётся карточкой, а не выбрасывается");
  assert.deepEqual(stored.structure, [], "недостающее поле — пустой массив, а не undefined");
  assert.equal(stored.built_from, 21, "прочитанное число постов сохраняется");
  assert.ok(
    cardBlock(stored).includes("Формы его постов мы не знаем"),
    "промпт собирается и честно говорит, что формы не знает",
  );
  assert.ok(cardBlock(stored).includes("короткие фразы"), "голос из старой карточки доезжает");
  // Отсечка одна и та же на разборе и на чтении: карточка уходит в промпт
  // на каждое нажатие, и лишние пункты оплачиваются каждый раз.
  assert.equal(
    asCard({ voice: Array.from({ length: 30 }, (_, i) => `пункт ${i}`) })!.voice.length,
    12,
    "из базы берётся столько же пунктов, сколько из ответа модели",
  );
  assert.equal(asCard(null), undefined, "карточки нет — нет и карточки");
  assert.equal(asCard({ voice: [] }), undefined, "пустой голос — это не карточка, а запасная");
}

// Медиана и зрелость. Просмотры добираются двое суток, и без поправки
// «верхние по просмотрам» означало бы «самые старые».
{
  const old = (views: number, daysAgo: number) => ({
    text: "я".repeat(50), views, where: "telegram" as const,
    at: new Date(Date.now() - daysAgo * 86_400_000),
  });
  const posts = [10, 20, 30, 40, 50, 60, 70, 80].map((v, i) => old(v * 1000, i + 3));
  assert.equal(medianViews(posts), 50_000, "медиана считается по зрелым постам");
  const corpus = corpusOf([...posts, old(1, 0)]);
  assert.ok(corpus.ranked, "статистика есть — каркас считается");
  assert.ok(!corpus.text.includes("просмотров 1 "), "пост, которому нет двух суток, в корпус не идёт");
  assert.ok(corpus.text.includes("выше медианы"), "каждый пост помечен относительно медианы");
  assert.equal(
    corpusOf([{ text: "я".repeat(50), views: null, at: null, where: "blog" }]).ranked,
    false,
    "у вставленного текста просмотров нет — каркас не считается",
  );
}

// «49.3K» — это 49 300, а пусто — это null, а не ноль: ноль означал бы
// «никто не читал», и каркас решил бы, что удачных постов у него нет вовсе.
assert.equal(countOf("49.3K"), 49_300, "сокращение тысяч разворачивается");
assert.equal(countOf("1.74M"), 1_740_000, "сокращение миллионов разворачивается");
assert.equal(countOf("812"), 812, "число без сокращения читается как есть");
assert.equal(countOf(undefined), null, "нет просмотров — null, а не ноль");

// --- число и слово рядом -------------------------------------------------------
// «1 материалов» — не опечатка, а признак числа, подставленного в готовую
// строку. Читается как машинный текст, и виден он только на единице.
const form = (n: number) => plural(n, "материал", "материала", "материалов");
assert.equal(form(1), "материал");
assert.equal(form(2), "материала");
assert.equal(form(5), "материалов");
// Одиннадцать — не «одиннадцать материал»: второй десяток ведёт себя иначе.
assert.equal(form(11), "материалов");
assert.equal(form(12), "материалов");
assert.equal(form(21), "материал");
assert.equal(form(22), "материала");
assert.equal(form(0), "материалов");

// --- номер миграции, занятый дважды -------------------------------------------
// Проверка была обещана в AGENTS.md с тех пор, как 0019 разошлась на три
// ветки, а в коде её не было: 19 сентября 2026 в журнал живой базы попало
// три файла под номером 0036, и два из них переопределяли одно ограничение.
// На живой базе порядок решает время применения, на чистой — имя файла,
// и совпало это по удаче.
{
  const journal = ["0035_video_stage", "0036_blogger"];
  assert.deepEqual(
    numberCollisions(["0036_interests_stage.sql"], journal),
    [{ file: "0036_interests_stage.sql", taken: ["0036_blogger"] }],
    "занятый номер называется вместе с тем, кто его занял",
  );
  assert.deepEqual(
    numberCollisions(["0037_next.sql"], journal), [],
    "свободный номер молчит",
  );
  // Файл, уже стоящий в журнале, сам с собой не сталкивается: он применён,
  // а не ждёт применения.
  assert.deepEqual(
    numberCollisions(["0036_blogger.sql"], journal), [],
    "своё же имя в журнале — не столкновение",
  );
  assert.deepEqual(
    numberCollisions(["0036_a.sql"], ["0036_b", "0036_c"]),
    [{ file: "0036_a.sql", taken: ["0036_b", "0036_c"] }],
    "называются все занявшие, а не первый",
  );
}

// --- адрес, на который приземляет ссылка входа --------------------------------
// В standalone-сборке за обратным прокси nextUrl.origin — это адрес
// прослушивания контейнера. Ссылка из бота приземлялась на
// https://0.0.0.0:3000: кука ставилась, переход выполнялся, страница
// не открывалась — и по ней понять, что сломалось, было нельзя.
{
  const before = process.env.APP_URL;
  process.env.APP_URL = "https://news.tomko.io";
  assert.equal(
    appOrigin("https://0.0.0.0:3000"), "https://news.tomko.io",
    "адрес берётся из APP_URL, а не из того, на что смотрит контейнер",
  );
  process.env.APP_URL = "  ";
  assert.equal(
    appOrigin("https://0.0.0.0:3000"), "https://0.0.0.0:3000",
    "пробелы — это «не задано», а не адрес из пробелов",
  );
  delete process.env.APP_URL;
  assert.equal(
    appOrigin("http://localhost:3000"), "http://localhost:3000",
    "без переменной остаётся адрес запроса: в разработке он и есть правильный",
  );
  if (before === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = before;
}

// --- гейт по подписке на канал ------------------------------------------------
// Живого канала в проверке нет, а на владельце все четыре ветки неразличимы:
// он в своём канале создатель, и «не подписан» у него не получить никак.
assert.equal(verdictOf({ status: "creator" }), "yes", "создатель канала подписан");
assert.equal(verdictOf({ status: "administrator" }), "yes", "админ подписан");
assert.equal(verdictOf({ status: "member" }), "yes", "участник подписан");
assert.equal(
  verdictOf({ status: "restricted", is_member: true }), "yes",
  "ограниченный участник всё ещё в канале",
);
assert.equal(
  verdictOf({ status: "restricted", is_member: false }), "no",
  "ограниченный и не участник — не в канале",
);
assert.equal(verdictOf({ status: "left" }), "no", "ушедший не подписан");
assert.equal(verdictOf({ status: "kicked" }), "no", "выгнанный не подписан");
// Telegram заводит новые статусы, и гадать в пользу входа нельзя: гейт
// открылся бы от незнакомого слова, и заметить это было бы нечем.
assert.equal(verdictOf({ status: "супер" }), "no", "незнакомый статус читается как «нет»");
assert.equal(verdictOf(null), "no", "пустой ответ — не подписка");

// В переменную окружения рано или поздно вставят то, что скопировали
// из адресной строки.
const handleFor = (value: string | undefined) => {
  const before = process.env.TELEGRAM_CHANNEL;
  if (value === undefined) delete process.env.TELEGRAM_CHANNEL;
  else process.env.TELEGRAM_CHANNEL = value;
  const result = channelHandle();
  if (before === undefined) delete process.env.TELEGRAM_CHANNEL;
  else process.env.TELEGRAM_CHANNEL = before;
  return result;
};
assert.equal(handleFor("@lenta"), "@lenta", "@имя остаётся @именем");
assert.equal(handleFor("lenta"), "@lenta", "голое имя получает собачку");
assert.equal(handleFor("https://t.me/lenta"), "@lenta", "ссылка сводится к имени");
assert.equal(handleFor("https://t.me/lenta/"), "@lenta", "хвостовой слэш не уезжает в имя");
// Протокол необязателен: из адресной строки копируют и «t.me/имя».
// С обязательным https:// такая строка превращалась в «@t.me/имя»,
// getChatMember отвечал 400, и гейт застревал на «не смог проверить».
assert.equal(handleFor("t.me/lenta"), "@lenta", "t.me без протокола — тоже ссылка");
assert.equal(handleFor("telegram.me/lenta"), "@lenta", "второй домен Telegram тоже");
assert.equal(handleFor("@lenta_bot"), "@lenta_bot", "подчёркивание в имени остаётся");
// Не задано — гейта нет. Здесь переменная не секрет, а настройка роста:
// первый деплой без неё закрыл бы вход всем новым читателям разом.
assert.equal(handleFor(undefined), null, "без переменной гейта нет");
assert.equal(handleFor("  "), null, "пробелы — тоже «не задано»");

const subscribedPress = {
  callback_query: {
    id: "cb1",
    data: `${SUBSCRIBED_PREFIX}:1`,
    from: { id: 4242, is_bot: false, username: "igor" },
    message: { chat: { id: 777 } },
  },
};
assert.deepEqual(
  parseUpdate(subscribedPress),
  { kind: "subscribed", telegramId: 4242, chatId: 777, username: "igor", callbackId: "cb1" },
  "нажатие «Я подписался» разбирается, а не проваливается в ignore",
);

// --- стартовый каталог интересов ----------------------------------------------
// Файл правят руками, и опечатка в related — это кнопка, которой нет:
// список соседей молча укорачивается, и заметить это на экране нечем.
{
  const slugs = new Set(STARTER_TOPICS.map((topic) => topic.slug));
  assert.equal(slugs.size, STARTER_TOPICS.length, "слаги стартовых интересов не повторяются");
  for (const topic of STARTER_TOPICS) {
    assert.ok(topic.hint.length > 10, `у «${topic.label}» должна быть подсказка: она уходит в вопрос Jev`);
    assert.ok(topic.feeds.length > 0, `у «${topic.label}» должен быть хоть один источник`);
    assert.ok(topic.related.length > 0, `у «${topic.label}» должны быть соседи`);
    for (const related of topic.related) {
      assert.ok(slugs.has(related), `сосед «${related}» у «${topic.label}» не существует`);
      assert.notEqual(related, topic.slug, "тема не может быть соседом самой себе");
    }
    for (const feed of topic.feeds) {
      assert.ok(feed.label.length > 0, "у источника должно быть название");
      assert.ok(
        feed.kind !== "rss" || feed.url.startsWith("https://"),
        `фид «${feed.label}» должен быть полным адресом`,
      );
    }
  }
}

// Порядок предложений. Соседи выбранного идут первыми, само выбранное
// исчезает: предлагать взять взятое — это кнопка, которая ничего не делает.
{
  const order = suggestOrder(["ai-infra"]);
  assert.ok(!order.includes("ai-infra"), "выбранное уходит со сцены");
  assert.deepEqual(
    order.slice(0, 4), starterBySlug.get("ai-infra")!.related,
    "соседи выбранного идут первыми и в своём порядке",
  );
  // Последний выбор ближе к пальцу, чем первый: он и отвечает на «а что
  // ещё такого же».
  const two = suggestOrder(["ai-infra", "cinema"]);
  assert.equal(two[0], starterBySlug.get("cinema")!.related[0], "соседи последнего выбора первее");
  // Ранжирование по описанию из Telegram — второй очередью: оно про человека
  // вообще, а соседи — про то, что он только что нажал.
  const ranked = suggestOrder(["ai-infra"], ["music", "выдуманное"]);
  assert.ok(
    ranked.indexOf("music") > ranked.indexOf(starterBySlug.get("ai-infra")!.related[0]),
    "ранжирование не обгоняет соседей",
  );
  assert.ok(!ranked.includes("выдуманное"), "слаг не из каталога отбрасывается");
  assert.equal(
    new Set(ranked).size, ranked.length,
    "ни один интерес не показывается дважды",
  );
  assert.equal(
    suggestOrder([]).length, STARTER_TOPICS.length,
    "без выбора показывается весь набор",
  );
}

// --- тариф и бюджет тем -------------------------------------------------------
// Предел интересов и размер выпуска — два числа одного тарифа, и разъехавшись,
// они дают тему с нулевой целью: ограничение reader_topics.weight > 0 уронит
// сохранение там, где читатель всего лишь выбрал интересы.
for (const id of PLAN_IDS) {
  const p = PLANS[id];
  const counts = normalize(Array.from({ length: p.maxTopics }, () => 1), p.digestSizes[0]);
  assert.equal(counts.length, p.maxTopics, `цели считаются на все темы тарифа «${p.label}»`);
  assert.ok(
    counts.every((count) => count >= 1),
    `на тарифе «${p.label}» ни одна тема не остаётся с нулём`,
  );
}

// --- YouTube: ролик приезжает с содержанием, а не одним заголовком ------------
// Описание ролика лежит в media:group/media:description: своего <description>
// в Atom у YouTube нет вовсе, и без этой ветки канал приезжал одними
// заголовками — Jev оценивал по заголовку, дайджест писал по нему же,
// а выглядело это как обычный материал.
const ytFeed = parseFeed(readFileSync("pipeline/fixtures/youtube-feed.xml", "utf8"));
assert.equal(ytFeed.title, "Veritasium", "название канала читается");
assert.ok(ytFeed.items.length >= 2, "записи фида разобраны");
assert.ok(
  ytFeed.items.every((item) => item.excerpt.length > 0),
  "у каждой записи есть описание: пустой excerpt — это ролик без содержания",
);
assert.ok(
  ytFeed.items.some((item) => item.excerpt.includes("Smith Chart")),
  "описание берётся из media:description, а не из заголовка",
);
assert.ok(
  ytFeed.items.every((item) => videoIdOf(item.url) !== null),
  "адрес каждой записи опознаётся как ролик",
);

// Номер ролика приходит тремя формами, и короткий метраж — отдельная:
// /shorts/<id> приезжает тем же фидом, что и обычные ролики.
assert.equal(videoIdOf("https://www.youtube.com/watch?v=O3a99HNskNk"), "O3a99HNskNk", "watch?v=");
assert.equal(videoIdOf("https://youtu.be/O3a99HNskNk?t=42"), "O3a99HNskNk", "короткая ссылка");
assert.equal(videoIdOf("https://www.youtube.com/shorts/O3a99HNskNk"), "O3a99HNskNk", "короткий метраж");
assert.equal(videoIdOf("https://www.youtube.com/@veritasium"), null, "канал роликом не является");
assert.equal(videoIdOf("https://example.com/watch?v=O3a99HNskNk"), null, "чужой хост — не YouTube");
assert.equal(videoIdOf("не адрес"), null, "строка без адреса");

// Разбор ответа timedtext идёт по сохранённому куску настоящего ответа:
// это чужая разметка, и сломается она молча.
const timed = parseTimedText(readFileSync("pipeline/fixtures/youtube-timedtext.xml", "utf8"));
assert.ok(timed.startsWith("This is the scariest chart in electrical"), "реплики склеены по порядку");
assert.ok(timed.length > 400, "расшифровка не обрывается на первой реплике");
assert.ok(!timed.includes("&amp;"), "двойные сущности разворачиваются до текста");
assert.ok(!timed.includes("<text"), "разметка не доезжает до текста");
assert.equal(
  parseTimedText('<transcript><text start="0" dur="1">[Music] hello [Applause] world</text></transcript>'),
  "hello world",
  "пометки звукорежиссёра выбрасываются: в конспекте от них ничего, а в счёте они есть",
);
assert.equal(parseTimedText("<transcript></transcript>"), "", "ролик без реплик — пустая расшифровка");

// Дорожка выбирается по звуку ролика. У канала с переводами они лежат
// в одном списке с оригиналом, и «первая человеческая» давала арабские
// субтитры английской лекции: конспект выходил арабским, и ни одной
// ошибки при этом не было.
assert.equal(
  pickTrack({
    captionTracks: [{ baseUrl: "ar", languageCode: "ar" }, { baseUrl: "en", languageCode: "en" }],
    audioTracks: [{ defaultCaptionTrackIndex: 1 }],
    defaultAudioTrackIndex: 0,
  })?.baseUrl,
  "en",
  "дорожка основного звука важнее первой в списке",
);
assert.equal(
  pickTrack({ captionTracks: [{ baseUrl: "a", kind: "asr" }, { baseUrl: "b" }] })?.baseUrl,
  "b",
  "без пометки — написанная человеком важнее машинной",
);
assert.equal(
  pickTrack({ captionTracks: [{ baseUrl: "a", kind: "asr" }], audioTracks: [{}] })?.baseUrl,
  "a",
  "машинная, когда другой нет",
);
assert.equal(pickTrack({}), null, "дорожек нет — читать нечего");

// Пересказ для читалки идёт в items.body, который читает тот же разбор,
// что и полный текст статьи из фида, — а он ждёт HTML. Markdown как есть
// потерялся бы в defuddle, и отправка пошла бы качать страницу ролика,
// где текста нет вовсе.
const html = articleHtml("## Раздел\n\nАбзац с числом 42.");
assert.ok(html.includes("<h2>") && html.includes("<p>"), "разметка пересказа превращается в HTML");
assert.equal(articleHtml(""), "", "пустой пересказ остаётся пустым, а не <article></article>");

// --- шапка ленты: key на элементах, уезжающих пропом -------------------------
// FeedTabs ставит left и right соседями в одном родителе. Элемент, приехавший
// в клиентский компонент полезной нагрузкой сервера, теряет пометку «детей
// ровно столько, сколько написано»: React считает пару списком и просит ключ.
// В консоли это выглядит настоящей ошибкой ленты и прячет собой те, что ошибки
// и есть, — а увидеть его можно только глазами, предупреждение живёт лишь
// в dev-сборке React. Поэтому проверка тут текстовая: она ловит не причину,
// а её след в исходнике — ровно тот, который теряется при перекладке шапки.
const feedSource = readFileSync("src/app/(app)/page.tsx", "utf8");
const feedPage = feedSource.slice(feedSource.indexOf("<FeedTabs"));
// Переименовали компонент — проверка обязана упасть, а не замолчать на пустом
// срезе: тест, ничего не нашедший, зелёный ровно так же, как тест успешный.
assert.ok(feedPage.startsWith("<FeedTabs"), "ленту рисует FeedTabs");
for (const prop of ["left", "right"]) {
  const at = feedPage.indexOf(`${prop}={`);
  assert.ok(at >= 0, `${prop} должен передаваться в FeedTabs`);
  const tag = feedPage.slice(at).match(/<[A-Za-z][^>]*/)?.[0] ?? "";
  assert.match(tag, /\skey=/, `${prop} уезжает соседом и обязан нести key`);
}
// А требование key держится на том, что они соседи. Разведут по разным
// родителям — проверка выше станет суеверием, и упасть она должна здесь.
assert.match(
  readFileSync("src/components/feed-tabs.tsx", "utf8"),
  /\{left\}\s*\{right\}/,
  "left и right стоят соседями — иначе key им не нужен",
);


// —————————————————————————————————————————————————————————————————————————
// Одно обращение на весь продукт
//
// Правило записано и в AGENTS.md, и в скилле — и всё равно было нарушено:
// «Расскажите о себе… под ваши интересы» прожило в самом читаемом поле
// онбординга до аудита текста. Правило, которое некому проверить, держится
// ровно до следующей правки.
//
// Проверяются местоимения и повелительное на «-ьте» и «-йтесь»/«-ьтесь».
// Эти окончания в русском бывают только у глаголов, поэтому ложной тревоги
// не будет никогда — а ложная тревога здесь опаснее пропуска: она роняет
// сборку на правильном тексте, и чинят её, дописывая слово в исключения.
// Тем же движением потом «чинится» и настоящее нарушение.
//
// «-йте» и «-ите» не проверяются: их делят с глаголами существительные
// в предложном падеже — «на сайте», «в свите», «об элите». Отсечь их
// по предлогу не выходит, между предлогом и словом встаёт определение
// («на этом сайте»), и проверка снова краснеет на верной строке.
// Поэтому «Откройте» и «Расскажите» ловятся только местоимением рядом;
// на практике вежливая строка почти всегда приносит «вы» или «ваш»
// с собой — так и было с той единственной, что дожила до аудита.
//
// Границы выписаны руками: \b перед кириллицей не работает — тот же промах,
// что и с «ключевой» в словаре.
const BOUNDARY = "(^|[^а-яёА-ЯЁ])";
const POLITE = new RegExp(
  `${BOUNDARY}(вы|вас|вам|ваш|ваша|ваше|ваши|вашу|вашем|вашей|вашего|вашему|вашим|вашими|ваших|вами)([^а-яёА-ЯЁ]|$)` +
  `|${BOUNDARY}[а-яё]+(ьте|[йь]тесь)([^а-яёА-ЯЁ]|$)`,
  "i",
);

/**
 * Строки из файла, за вычетом комментариев.
 *
 * Разбор наивный, по синтаксису, а не по дереву, и у него есть слепые пятна:
 * строка, начинающаяся со звёздочки внутри шаблонного литерала, считается
 * продолжением комментария; «/*» и « //» внутри строкового литерала тоже
 * принимаются за начало комментария и обрезают хвост строки. В обе стороны
 * это пропуски, не ложные тревоги, — и это выбрано намеренно: ложная тревога
 * здесь роняет сборку на верном тексте, а чинят её, дописывая исключение,
 * и тем же движением потом глушат настоящее нарушение. Настоящий разбор
 * TSX ради двух проверок дороже, чем названный пропуск.
 */
function uiText(file: string): { line: number; text: string }[] {
  // Список путей ведётся руками, и переименование файла иначе валит
  // самопроверку голым ENOENT вместо указания на строку списка.
  if (!existsSync(file)) {
    throw new Error(`UI_FILES: файла ${file} нет — поправь список в selftest.ts`);
  }
  const out: { line: number; text: string }[] = [];
  let inBlock = false;
  for (const [index, raw] of readFileSync(file, "utf8").split("\n").entries()) {
    let line = raw;
    if (inBlock) {
      const close = line.indexOf("*/");
      if (close < 0) continue;
      inBlock = false;
      line = line.slice(close + 2);
    }
    // Блочные комментарии выбрасываются и посередине строки: `foo(); /* … */`
    // и `<div>{/* … */}</div>` иначе попадали бы под проверку и роняли бы её
    // на тексте, которого читатель не видит.
    line = line.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ");
    const open = line.indexOf("/*");
    if (open >= 0) {
      inBlock = true;
      line = line.slice(0, open);
    }
    // «//» после пробела — это комментарий в хвосте строки кода; читатель
    // его не видит, и ронять на нём проверку нельзя. Резать все «//» нельзя:
    // в «https://…» это часть адреса, и перед ним стоит двоеточие.
    line = line.replace(/\s\/\/.*$/, "");
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (/[а-яёА-ЯЁ]/.test(trimmed)) out.push({ line: index + 1, text: trimmed });
  }
  return out;
}

const UI_FILES = [
  // Конвейер тоже говорит с читателем: отказы отправки на Kindle приходят
  // тостом в ленту, отказы разбора ссылки — под поле в «Источниках».
  "pipeline/kindle.ts",
  "pipeline/kindle-article.ts",
  "pipeline/discover.ts",
  "src/lib/voice.ts",
  "src/lib/plans.ts",
  "src/lib/actions.ts",
  "src/lib/telegram.ts",
  "src/app/login/form.tsx",
  "src/app/api/telegram/route.ts",
  "src/app/api/kindle/route.ts",
  "src/components/collect-now.tsx",
  "src/components/rebuild-queue.tsx",
  "src/components/item-card.tsx",
  "src/components/feed-tabs.tsx",
  "src/components/topic-chips.tsx",
  "src/components/plan-table.tsx",
  "src/components/plan-gate.tsx",
  "src/components/paywall.tsx",
  "src/app/(app)/page.tsx",
  "src/app/(app)/settings/nav.tsx",
  "src/app/(app)/settings/about/page.tsx",
  "src/app/(app)/settings/calibration/page.tsx",
  "src/app/(app)/settings/delivery/form.tsx",
  "src/app/(app)/settings/interests/form.tsx",
  "src/app/(app)/settings/personalization/form.tsx",
  "src/app/(app)/settings/sources/manager.tsx",
];

const politeHits: string[] = [];
for (const file of UI_FILES) {
  for (const { line, text } of uiText(file)) {
    if (POLITE.test(text)) politeHits.push(`${file}:${line} — ${text.slice(0, 90)}`);
  }
}
assert.deepEqual(
  politeHits, [],
  "продукт говорит на «ты», а здесь пробралось «вы». Если это не текст читателю, " +
  "а промпт для модели (в voice.ts они лежат рядом намеренно) — вынеси строку " +
  `из UI_FILES, а не правь текст:\n${politeHits.join("\n")}`,
);

// Заодно, по тому же обходу: извинения и «пожалуйста» в интерфейсе.
// Ни одно из них не говорит читателю, что делать, — а «Извините» ещё
// и берёт на себя вину за то, в чём продукт не виноват.
const APOLOGY = /(^|[^а-яёА-ЯЁ])(извини|извините|прости|простите|пожалуйста|упс|ой)([^а-яёА-ЯЁ]|$)/i;
const apologyHits: string[] = [];
for (const file of UI_FILES) {
  for (const { line, text } of uiText(file)) {
    if (APOLOGY.test(text)) apologyHits.push(`${file}:${line} — ${text.slice(0, 90)}`);
  }
}
assert.deepEqual(apologyHits, [], `извинения вместо выхода:\n${apologyHits.join("\n")}`);

// --- что бросили боту ---------------------------------------------------
{
  // Ссылка узнаётся по началу сообщения, а не по вхождению: абзац мысли
  // со ссылкой в середине — это мысль, и пост по нему пишется про мысль.
  assert.equal(classifyDrop("https://example.com/a", false)?.kind, "link", "голая ссылка");
  assert.equal(
    classifyDrop("https://www.youtube.com/watch?v=dQw4w9WgXcQ", false)?.kind,
    "video",
    "ролик отличается от статьи",
  );
  assert.equal(
    classifyDrop("https://example.com/a заходи со стороны денег", false)?.kind,
    "link",
    "пометка после адреса не превращает ссылку в мысль",
  );
  const noted = classifyDrop("https://example.com/a заходи со стороны денег", false);
  assert.equal(noted?.kind === "link" && noted.note, "заходи со стороны денег", "пометка сохраняется");
  assert.equal(
    classifyDrop("Меня третий день не отпускает мысль про https://example.com/a и вот почему", false)?.kind,
    "thought",
    "адрес в середине абзаца — это мысль, а не ссылка",
  );
  assert.equal(classifyDrop("https://example.com/a", true)?.kind, "post", "пересланное — всегда чужой пост");
  assert.equal(classifyDrop("   ", false), null, "пустое сообщение ничего не заводит");
  assert.equal(
    classifyDrop("https://example.com/a).", false)?.kind === "link"
      && (classifyDrop("https://example.com/a).", false) as { url: string }).url,
    "https://example.com/a",
    "хвостовая пунктуация в адрес не входит",
  );

  const punctuated = classifyDrop("https://example.com/a). а дальше мысль", false);
  assert.equal(
    punctuated?.kind === "link" && punctuated.note,
    "а дальше мысль",
    "снятая с адреса пунктуация в пометку не попадает",
  );

  // Синтетический адрес держит обещание «дважды брошенная мысль — один
  // материал»: он единственный сводит повтор на тот же url_canon.
  assert.equal(
    syntheticUrl("thought", "одна и та же мысль"),
    syntheticUrl("thought", "одна и та же мысль"),
    "одинаковый текст — один и тот же адрес",
  );
  assert.notEqual(
    syntheticUrl("thought", "одна и та же мысль"),
    syntheticUrl("post", "одна и та же мысль"),
    "тот же текст другим видом — другой материал",
  );

  assert.equal(titleOf("Первая фраза. Вторая фраза."), "Первая фраза.", "заголовок мысли — её первая фраза");
  assert.equal(titleOf("а".repeat(200)).length, 120, "длинная фраза режется до 120 знаков");
  assert.equal(titleOf("   "), "Без заголовка", "пустая мысль всё равно получает заголовок");
}

// --- лишний ReadyForQuery от PGlite -------------------------------------------
// Отбивая запрос, PGlite отвечает на `Parse`/`Execute` парой `ErrorResponse`
// + `ReadyForQuery`, а потом ещё раз `ReadyForQuery` — на `Sync`. Настоящий
// Postgres шлёт его только на `Sync`. Лишний `Z` закрывал в postgres.js
// следующий запрос до того, как пришли его строки, и дальше ответы ехали
// на один: `npm run verify:db` падала в 16 прогонах из 60, каждый раз
// в другом месте и каждый раз правдоподобно.
{
  const frame = (tag: string, body = Buffer.alloc(0)) => {
    const out = Buffer.alloc(5 + body.length);
    out.write(tag, 0, "latin1");
    out.writeInt32BE(4 + body.length, 1);
    body.copy(out, 5);
    return out;
  };
  const request = (tag: string) => new Uint8Array(frame(tag));
  const ERROR = frame("E", Buffer.from("Snope\0"));
  const READY = frame("Z", Buffer.from("I"));

  assert.deepEqual(
    dropStrayReady(request("E"), Buffer.concat([ERROR, READY])),
    ERROR,
    "на Execute ReadyForQuery не приходит — лишний снимается",
  );
  assert.deepEqual(
    dropStrayReady(request("P"), Buffer.concat([ERROR, READY])),
    ERROR,
    "на Parse — то же самое: ошибка бывает и там",
  );
  // Sync и простой Query — единственные, кому `Z` полагается. Сними его
  // у них, и клиент не дождётся конца запроса вовсе.
  assert.deepEqual(
    dropStrayReady(request("S"), READY), READY,
    "ответ на Sync не трогаем",
  );
  assert.deepEqual(
    dropStrayReady(request("Q"), Buffer.concat([ERROR, READY])),
    Buffer.concat([ERROR, READY]),
    "простой Query закрывается своим ReadyForQuery",
  );
  const rows = Buffer.concat([frame("D", Buffer.from("x")), frame("C", Buffer.from("SELECT 1\0"))]);
  assert.deepEqual(
    dropStrayReady(request("E"), rows), rows,
    "успешный ответ не меняется ни на байт",
  );
  // Стартовое сообщение идёт без тега: первый байт — старший байт длины.
  // Его `Z` — это «соединение готово», и без него клиент не подключится.
  const startup = new Uint8Array(Buffer.from([0, 0, 0, 8, 0, 3, 0, 0]));
  assert.deepEqual(
    dropStrayReady(startup, READY), READY,
    "ответ на стартовое сообщение не трогаем",
  );
  // Кадры, которые не разобрались, проходят насквозь: испортить протокол
  // хуже, чем не чинить.
  const junk = Buffer.from([0x5a, 0x00, 0x00]);
  assert.deepEqual(
    dropStrayReady(request("E"), junk), junk,
    "неразобранный ответ проходит как есть",
  );
}


// --- язык выпуска считается по тарифу, а выбор читателя не стирается ---------
// Подмена колонки при сохранении была необратимой: тариф открывается обратно,
// а в базе остаётся «язык источника». Двадцатого сентября 2026 выпуск пришёл
// на сорок материалов по-английски при русском в настройках.
{
  const reader = (extra: object) =>
    ({ language: "русском", complexity: 3, style: "нейтральный", ...extra }) as never;

  assert.equal(
    effectiveVoice(reader({ plan: "free", owner: false })).language,
    SOURCE_LANGUAGE,
    "на бесплатном тарифе выпуск пишется языком источника",
  );
  assert.equal(
    effectiveVoice(reader({ plan: "pro", owner: false, subscription_status: "active" })).language,
    "русском",
    "на платном — языком читателя",
  );
  const stored = { language: "русском", complexity: 3, style: "нейтральный", plan: "free", owner: false };
  assert.equal(
    effectiveVoice(stored as never).language !== stored.language && stored.language === "русском",
    true,
    "сам выбор при этом остаётся: гасится применение, а не колонка",
  );
}

// --- догрузка текста статьи ----------------------------------------------------
// Материал приезжал в оценку и в дайджест тем, что отдал фид, а фид часто
// не отдаёт ничего: у Hacker News описания нет по устройству API, рассылка
// кладёт служебную строку в двадцать знаков. Описание писалось по заголовку
// и выходило гладким пересказом самого себя — без единой ошибки.
{
  const survivor = (extra: object) =>
    ({ id: 1, title: "t", excerpt: "", source_label: "s", topic_label: "тема",
       url: "https://example.com", total: 0, axes: {} , ...extra }) as never as Survivor;

  assert.equal(
    textFor(survivor({ excerpt: "Community Wisdom 298", body: articleHtml("Полный текст статьи, которого фид не дал.") })),
    "Полный текст статьи, которого фид не дал.",
    "когда статью забрали по ссылке, в промпт уходит она, а не строка из фида",
  );

  // Обратный случай: фид отдал статью целиком, ходить было некуда.
  // Без сравнения длин догрузка, вернувшая огрызок, заменила бы хороший
  // текст на плохой — и это не было бы видно ни в одной проверке.
  assert.equal(
    textFor(survivor({ excerpt: "Фид отдал статью целиком, и она длиннее.", body: articleHtml("Коротко") })),
    "Фид отдал статью целиком, и она длиннее.",
    "короткий разбор не затирает длинный текст из фида",
  );

  assert.equal(
    textFor(survivor({ excerpt: "из фида", body: null })),
    "из фида",
    "без догруженного текста остаётся то, что дал фид",
  );

  // Разметка не должна уезжать в промпт: модель платит за неё как за текст.
  assert.equal(
    excerptFrom("## Заголовок\n\nПервый абзац статьи."),
    "Заголовок Первый абзац статьи.",
    "в excerpt уходит текст, а не markdown с разметкой",
  );

  // Обрывок на середине слова уедет и в оценку Jev, и в промпт дайджеста
  // как часть текста материала.
  const long = "Первое предложение здесь. " + "Ещё одно предложение текста. ".repeat(40);
  const cut = excerptFrom(long, 120);
  assert.equal(cut.endsWith("."), true, "excerpt режется по границе предложения");
  assert.equal(cut.length <= 120, true, "и не длиннее заданного потолка");

  // Порог щедрый нарочно: 500 знаков анонса — это лид, а не статья,
  // и написать по нему конспект так же нечем, как по заголовку.
  assert.equal(SHORT_EXCERPT > 500, true, "лид из фида считается отсутствием текста");
}

// --- текст, который уже лежит в базе -------------------------------------------
// Письмо рассылки приезжает со сбором целиком, но через разбор статьи
// не проходит: оно свёрстано таблицами, defuddle не признаёт его статьёй
// и оставляет меньше ста двадцати слов. У выпуска Lenny's в excerpt было
// двадцать знаков служебной строки при пяти тысячах знаков письма рядом.
{
  const letter = "<table><tr><td>" + "Абзац письма с настоящим содержанием. ".repeat(30) + "</td></tr></table>";
  const text = stripHtml(letter);
  assert.equal(text.length >= SHORT_EXCERPT, true, "текст письма из базы проходит порог сам");
  assert.equal(clipText(text, 100).endsWith("."), true, "и режется по границе предложения");
  assert.equal(clipText("Коротко.", 100), "Коротко.", "короткий текст остаётся целым");
}

// --- отказ по существу против оборванной связи ---------------------------------
// Отметка о попытке стоит дорого молча: поставленная на временную ошибку,
// она лишает материал текста до конца его окна свежести — повторно за ним
// уже не пойдут. Поэтому «сайт ответил» и «связь не состоялась» разделены.
{
  for (const definitive of [
    "не смог забрать текст (direct: HTTP 403; reader: HTTP 403)",
    "не смог забрать текст (direct: текста меньше 120 слов; reader: HTTP 403)",
    "не смог забрать текст (feed: текста меньше 120 слов; direct: HTTP 401)",
    "после разбора не осталось текста",
    "адрес ведёт во внутреннюю сеть (127.0.0.1)",
  ]) {
    assert.equal(refusedForGood(definitive), true, `окончательный отказ: ${definitive.slice(0, 40)}`);
  }

  for (const temporary of [
    "не смог забрать текст (direct: fetch failed)",
    "не смог забрать текст (direct: ECONNRESET)",
    "не смог забрать текст (direct: ENOTFOUND)",
    "The operation was aborted due to timeout",
    "не смог забрать текст (direct: CERT_HAS_EXPIRED)",
  ]) {
    assert.equal(refusedForGood(temporary), false, `временная помеха: ${temporary.slice(0, 40)}`);
  }

  // Уровни отвечают по-разному, и строка приходит одна на всех. Если хоть
  // один отказ был не по существу, сходить стоит ещё раз: проверка на отказ
  // обязана стоять после проверки на связь, иначе «HTTP 403» второго уровня
  // закроет тему за оборвавшийся первый. Без этого случая тест проходит
  // при любом порядке — обе ветки дают один ответ на чистых строках.
  assert.equal(
    refusedForGood("не смог забрать текст (direct: ECONNRESET; reader: HTTP 403)"),
    false,
    "оборванное соединение на одном уровне важнее отказа на другом",
  );
  assert.equal(
    refusedForGood("не смог забрать текст (direct: fetch failed; reader: текста меньше 120 слов)"),
    false,
    "и не отменяется тем, что запасной уровень дошёл до разбора",
  );
}

// Сюжет: дедуп сделан видимым.
//
// Проверяется то, что на живых данных уже разъехалось: «первоисточник»
// по dup_of неверен в трёх случаях из четырёх, потому что оригиналом
// дедуп назначает меньший id — порядок опроса источников, а не публикации.
{
  const pub = (
    item_id: number,
    source_id: number,
    source_label: string,
    kind: "rss" | "hackernews",
    minutes: number,
    points: number | null = null,
  ) => ({
    item_id,
    source_id,
    source_label,
    kind,
    url: `https://example.com/${item_id}`,
    published_at: new Date(Date.UTC(2026, 8, 20, 10, 0) + minutes * 60_000),
    points,
  });

  // Живой случай: Hacker News собран первым и стал оригиналом, а написан
  // пост был на 103 минуты раньше.
  const willison = pub(68, 2, "Simon Willison", "rss", 0);
  const hn = pub(12, 1, "Hacker News", "hackernews", 103, 418);
  assert.deepEqual(
    storyLines([hn, willison]).map((row) => [row.source_label, row.note]),
    [["Simon Willison", "первоисточник"], ["Hacker News", "обсуждение: 418 points"]],
    "первоисточник — самое раннее издание, а не меньший id",
  );

  // Обсуждение раньше статьи первоисточником не становится, и отсчёт
  // «позже» идёт от издания: иначе вторая статья получила бы «раньше».
  const early = pub(5, 1, "Hacker News", "hackernews", 0, 91);
  const verge = pub(9, 3, "The Verge", "rss", 60);
  const ars = pub(11, 4, "Ars Technica", "rss", 78);
  assert.deepEqual(
    storyLines([ars, early, verge]).map((row) => row.note),
    ["обсуждение: 91 points", "первоисточник", "18 минут позже"],
    "отсчёт идёт от первого издания, обсуждение в нём не участвует",
  );

  // Кластер без единого издания: отсчитывать не от чего, и выдумывать
  // первоисточник нельзя.
  assert.deepEqual(
    storyLines([pub(1, 1, "Hacker News", "hackernews", 0, null)]).map((row) => row.note),
    ["обсуждение"],
    "обсуждение без очков остаётся обсуждением, а не первоисточником",
  );

  // Двенадцать кластеров из шестнадцати на живом потоке — это источник,
  // повторивший сам себя. Строка о них соврала бы.
  assert.equal(
    otherSources([pub(1, 7, "Cointelegraph", "rss", 0), pub(2, 7, "Cointelegraph", "rss", 30)], 7),
    0,
    "источник, повторивший сам себя, не «ещё один источник»",
  );
  assert.equal(otherSources([willison, hn], 2), 1, "чужой источник в сюжете считается");

  assert.equal(laterBy(0), "тогда же");
  assert.equal(laterBy(1), "1 минуту позже");
  assert.equal(laterBy(18), "18 минут позже");
  assert.equal(laterBy(103), "2 часа позже", "минуты перестают быть минутами после часа");
  assert.equal(laterBy(341), "6 часов позже");
  assert.equal(laterBy(1500), "1 день позже");
  assert.equal(laterBy(4000), "3 дня позже");

  // «1 материалов» — та же ловушка, только в новой строке.
  assert.equal(alsoLine(1), "О том же написали ещё 1 твой источник");
  assert.equal(alsoLine(3), "О том же написали ещё 3 твоих источника");
  assert.equal(alsoLine(5), "О том же написали ещё 5 твоих источников");
  assert.equal(alsoLine(11), "О том же написали ещё 11 твоих источников");
  assert.equal(storyTitle(1), "Один сюжет, 1 публикация");
  assert.equal(storyTitle(4), "Один сюжет, 4 публикации");
  assert.equal(storyTitle(12), "Один сюжет, 12 публикаций");
}

console.log(`Самопроверка пройдена: ${checks} утверждений`);
