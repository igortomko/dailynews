/**
 * Самопроверка того, что ломается молча: канонизация адресов, нормализация
 * заголовков и формула составного скора. Всё три — чистые функции, поэтому
 * им не нужны ни база, ни сеть, ни ключи.
 *
 *   npx tsx pipeline/selftest.ts
 */
import assert from "node:assert/strict";
import { effectivePlan, readEvent, signatureValid, checkoutUrl, endingAt } from "../src/lib/lemon";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonUrl, normalizeTitle } from "./normalize";
import { composite } from "./score";
import { matchWritten, parseDigest } from "./digest";
import { checkLexicon, repeatsHeadline, readability } from "./lexicon";
import { MIN_PER_TOPIC, normalize, moveBoundary } from "../src/lib/topic-budget";
import { checkSecret, parseUpdate } from "../src/lib/telegram";
import { pickSurvivors, type Candidate } from "./select";
import { digestHtml, kindleDigestVerdict } from "./kindle";
import { kindleSenderName, kindleSetupStep } from "../src/lib/kindle-setup";
import { llmCost } from "./cost";
import { DEFAULT_WEIGHTS } from "../src/lib/types";
import { COMPLEXITY, STYLES, complexityAt, styleOf } from "../src/lib/voice";
import { firstSet } from "./digest";
import { relativeTime } from "../src/lib/relative-time";
import { toSlug } from "../src/lib/slug";
import type { Axes, Weights } from "../src/lib/types";
import { asUrl, diagnose, feedLinks, guesses, looksLikeFeed, planFor } from "./discover";
import { explain, parseTelegram } from "./fetch";
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
const cut = '{"intro": "сегодня про ИИ", "items": [{"id": 1, "title_ru": "А", "summary": "раз"},' +
  '{"id": 2, "title_ru": "Б", "summary": "два"},{"id": 3, "title_ru": "В", "summ';
assert.equal(parseDigest(cut).items?.length, 2, "из оборванного ответа спасаются целые описания");
assert.equal(parseDigest(cut).intro, "сегодня про ИИ", "интро переживает обрыв");
assert.equal(
  parseDigest('{"intro":"и","items":[{"id":7,"title_ru":"Т","summary":"С"}]}').items?.[0].id,
  7,
  "целый ответ разбирается обычным путём",
);

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

const source = (id: number, kind: Source["kind"], active = true) =>
  ({ id, kind, active, label: `s${id}`, url: `https://e/${id}`, config: {},
     last_ok_at: null, last_count: null, last_error: null } as unknown as Source);

const catalogue = [
  source(3, "x"), source(1, "rss"), source(2, "hackernews"),
  source(4, "rss", false), source(5, "rss"), source(6, "rss"),
  source(7, "rss"), source(8, "rss"), source(9, "rss"),
];

const onPlus = sourcesForPlan(catalogue, PLANS.plus);
assert.ok(!onPlus.some((s) => s.kind === "x"), "прогон на Plus не должен опрашивать X");
assert.ok(!onPlus.some((s) => s.id === 4), "выключенный источник не опрашивается");

const onFree = sourcesForPlan(catalogue, PLANS.free);
assert.equal(onFree.length, PLANS.free.maxSources, "бесплатный тариф режет до своего предела");
assert.deepEqual(
  onFree.map((s) => s.id),
  [1, 2, 5, 6, 7],
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
  afterDowngrade.filter((s) => s.active && PLANS.free.kinds.includes(s.kind)).length,
  2,
  "и предел в форме обязан считать по тому же правилу",
);

import { GATED, allows, cheapestWith, topicsWord } from "../src/lib/plans";

assert.equal(topicsWord(1), "интерес", "единственное число");
assert.equal(topicsWord(2), "интереса", "два-четыре");
assert.equal(topicsWord(5), "интересов", "пять и больше");
assert.equal(topicsWord(11), "интересов", "одиннадцать — исключение, не «интерес»");

assert.ok(
  !allows(PLANS.free, "personalization") && !allows(PLANS.free, "calibration"),
  "бесплатный тариф не открывает платных разделов",
);
// Подписка открыта всем и тарифом не закрывается вовсе: закрыть её значит
// показать кнопку «подписаться» только тем, кто уже подписан. Поэтому её
// и нет среди разделов, которые тариф может закрыть.
assert.ok(
  !(GATED as readonly string[]).includes("subscription"),
  "раздел подписки не должен закрываться тарифом",
);
assert.ok(
  allows(PLANS.plus, "personalization") && allows(PLANS.pro, "personalization"),
  "раздел, открытый дешёвым тарифом, обязан быть открыт и дорогим",
);
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
  const full = { kindle_address: "a@kindle.com", kindle_sender: "igor_x1", kindle_digest: true };
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
assert.equal(
  diagnose('<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>'),
  "материалы за пейволлом",
  "пейволл объявляет себя сам, в schema.org",
);
assert.equal(
  diagnose(`<!doctype html><html><head><title>x</title></head><body><div id="root"></div><script>${"var a=1;".repeat(300)}</script></body></html>`),
  "страница собирается в браузере",
  "пустая оболочка под скриптом",
);
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
assert.ok(articleBlocker({ ...base, kindle_address: null }, 0).includes("адрес читалки"), "без адреса читалки отправки нет");
assert.ok(articleBlocker({ ...base, kindle_sender: null }, 0).includes("обратный адрес"), "без обратного адреса отправки нет");
assert.ok(articleBlocker({ ...base, kindle_approved: false }, 0).includes("Amazon"), "неодобренный отправитель останавливает отправку: письмо исчезло бы молча");
assert.ok(articleBlocker(base, 1).includes("потолок"), "исчерпанный потолок останавливает отправку");
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

console.log("Самопроверка пройдена: 331 утверждение");
