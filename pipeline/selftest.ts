/**
 * Самопроверка того, что ломается молча: канонизация адресов, нормализация
 * заголовков и формула составного скора. Всё три — чистые функции, поэтому
 * им не нужны ни база, ни сеть, ни ключи.
 *
 *   npx tsx pipeline/selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonUrl, normalizeTitle } from "./normalize";
import { composite } from "./score";
import { matchWritten, parseDigest } from "./digest";
import { checkLexicon, repeatsHeadline, readability } from "./lexicon";
import { MIN_PER_TOPIC, normalize, moveBoundary } from "../src/lib/topic-budget";
import { checkSecret, parseUpdate } from "../src/lib/telegram";
import { pickSurvivors, type Candidate } from "./select";
import { digestHtml, kindleDigestVerdict } from "./kindle";
import { kindleSetupStep } from "../src/lib/kindle-setup";
import { llmCost } from "./cost";
import { DEFAULT_WEIGHTS } from "../src/lib/types";
import { COMPLEXITY, STYLES, complexityAt, styleOf } from "../src/lib/voice";
import { firstSet } from "./digest";
import { relativeTime } from "../src/lib/relative-time";
import { toSlug } from "../src/lib/slug";
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

// --- расположение middleware ------------------------------------------------
// Проект использует srcDirectory, и Next подключает middleware только из src/.
// Лежащий в корне файл не вызывает ни ошибки, ни предупреждения: страницы
// просто отдаются всем. Один раз так и было.
import { existsSync } from "node:fs";
assert.ok(existsSync("src/middleware.ts"), "middleware должен лежать в src/");
assert.ok(!existsSync("middleware.ts"), "middleware в корне не подключается и вводит в заблуждение");


// --- тарифы -----------------------------------------------------------------
// Предел тарифа проверяется в двух местах — в форме и в прогоне, — и разойтись
// им нельзя: понижение тарифа не гасит лишние источники в каталоге, поэтому
// решает именно прогон. X платный, и ошибка здесь стоит денег, а не вида.
import { PLAN_IDS, PLANS, maxDigestOf, planOf, sourcesForPlan } from "../src/lib/plans";
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

assert.deepEqual(PLANS.free.sections, [], "бесплатный тариф не открывает платных разделов");
assert.ok(allows(PLANS.pro, "subscription"), "свой ключ — признак Pro");
assert.ok(!allows(PLANS.plus, "subscription"), "на Plus своего ключа нет");
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

console.log("Самопроверка пройдена: 153 утверждений");
