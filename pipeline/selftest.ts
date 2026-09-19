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
import { byHost, feedGuesses, feedLinks, looksLikeFeed } from "./detect";
import { isInternal, parseTelegram } from "./fetch";
import { silent, type SourceHealth } from "./health";
import { MIN_PER_TOPIC, normalize, moveBoundary } from "../src/lib/topic-budget";
import { COMPLEXITY, STYLES, complexityAt, styleOf } from "../src/lib/voice";
import { firstSet } from "./digest";
import { relativeTime } from "../src/lib/relative-time";
import { toSlug } from "../src/lib/slug";
import { SILENT_DAYS, SOURCE_KINDS } from "../src/lib/types";
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

// --- определение источника по ссылке ------------------------------------------
// Правила по хосту — чистые: сеть нужна только пробе. Ошибка здесь выглядит
// как работающая форма, которая сохраняет адрес, ничего не отдающий в прогоне.
assert.deepEqual(
  byHost("https://www.reddit.com/r/LocalLLaMA/"),
  [{ kind: "reddit", url: "LocalLLaMA", label: "r/LocalLLaMA" }],
  "сабреддит: url источника — имя, а не адрес",
);
assert.equal(byHost("https://fakereddit.com/r/x"), null, "похожий хост не должен считаться Reddit");
assert.equal(
  byHost("https://news.ycombinator.com/newest")?.[0].url,
  "newstories",
  "hackernews: listing берётся из пути",
);
assert.deepEqual(
  byHost("https://x.com/karpathy"),
  [{ kind: "x", url: "from:karpathy", label: "X · @karpathy" }],
  "профиль X превращается в поисковый запрос",
);
assert.throws(() => byHost("https://x.com/search?f=live"), /профиль/, "служебный путь X — не имя");
assert.equal(
  byHost("https://www.youtube.com/channel/UC123")?.[0].url,
  "https://www.youtube.com/feeds/videos.xml?channel_id=UC123",
  "YouTube: фид есть, но по адресу, который человек не угадает",
);
assert.equal(byHost("https://www.youtube.com/@channel"), null, "ссылка на @имя уходит во второй слой");
assert.deepEqual(
  byHost("https://github.com/owner/repo")?.map((c) => c.url),
  ["https://github.com/owner/repo/releases.atom", "https://github.com/owner/repo/commits.atom"],
  "у репозитория без релизов фид валиден и пуст — нужен второй кандидат",
);
assert.equal(
  byHost("https://simon.substack.com/p/post")?.[0].url,
  "https://simon.substack.com/feed",
  "substack: фид всегда в корне",
);
assert.equal(
  byHost("https://arxiv.org/list/cs.AI/recent")?.[0].url,
  "https://rss.arxiv.org/rss/cs.AI",
  "arxiv: категория из пути",
);
assert.equal(byHost("https://simonwillison.net/"), null, "незнакомый хост — работа следующих слоёв");

assert.ok(looksLikeFeed("https://a.com/feed"), "/feed похож на фид");
assert.ok(looksLikeFeed("https://a.com/index.xml"), "расширение .xml похоже на фид");
assert.ok(!looksLikeFeed("https://a.com/blog/post-about-rss-readers"), "слово в пути — ещё не фид");

const html = `<link rel="stylesheet" href="/s.css">
  <link rel="alternate" type="application/rss+xml" href="/feed.xml?a=1&amp;b=2">
  <link rel=alternate type=application/atom+xml href=https://other.com/atom.xml>
  <link rel="alternate" type="text/html" href="/mobile">`;
assert.deepEqual(
  feedLinks(html, "https://a.com/blog"),
  ["https://a.com/feed.xml?a=1&b=2", "https://other.com/atom.xml"],
  "из HTML берутся только альтернативы-фиды, относительный адрес разворачивается, &amp; развёртывается",
);
assert.deepEqual(feedLinks("<p>страница за JS</p>", "https://a.com"), [], "нет ссылки — нет и кандидатов");
assert.deepEqual(
  feedGuesses("https://a.com/blog").slice(0, 2),
  ["https://a.com/blog/feed", "https://a.com/blog/rss"],
  "перебор начинается от самого пути, а не только от корня",
);
assert.ok(feedGuesses("https://a.com/blog").includes("https://a.com/feed"), "корень тоже в переборе");

// --- Telegram: разбор чужой разметки ------------------------------------------
// Разметка t.me не наш контракт и может измениться в любой день. Поэтому
// разбор проверяется на сохранённом куске живой страницы: сломается —
// упадёт здесь, а не молча отдаст ноль постов в прогоне.
const posts = parseTelegram(readFileSync("pipeline/fixtures/telegram.html", "utf8"));
assert.equal(posts.length, 3, "в куске страницы три поста");
assert.equal(posts[0].url, "https://t.me/durov/528", "адрес поста собирается из data-post");
assert.ok(posts[0].title.includes("UK government"), "заголовок — первая строка поста");
assert.ok(posts[0].excerpt.length > posts[0].title.length, "выдержка длиннее заголовка");
assert.equal(posts[0].points, 18_800_000, "«18.8M» просмотров — это число, а не строка");
assert.equal(
  posts[0].published_at?.toISOString(),
  "2026-06-15T18:58:13.000Z",
  "дата берётся из datetime, а не из видимого времени",
);
assert.ok(posts.every((post) => post.title.length <= 200), "заголовок не длиннее колонки");
assert.deepEqual(parseTelegram("<html>визитка закрытого канала</html>"), [], "нет сообщений — нет и материалов");
assert.deepEqual(
  byHost("https://t.me/s/durov"),
  [{ kind: "telegram", url: "durov", label: "@durov" }],
  "ссылка на веб-просмотр — тот же канал",
);
assert.equal(byHost("https://t.me/durov/528")?.[0].url, "durov", "ссылка на пост — это ссылка на канал");
assert.throws(() => byHost("https://t.me/+AbCdEf"), /приглашение/, "закрытый канал говорит об этом вслух");

// --- тишина источника ----------------------------------------------------------
// Только что заведённый источник не молчит: его срок считается от даты
// заведения, иначе тревога срабатывает раньше первого же прогона — на том,
// что минуту назад проверили живым запросом.
const health = (silent_days: number, ever = true): SourceHealth =>
  ({ source_id: "1", collected: 0, duplicates: 0, digested: 0, mean_score: null, silent_days, ever });
assert.equal(silent([health(0), health(1)]).length, 0, "вчерашний материал — это не тишина");
assert.equal(silent([health(SILENT_DAYS)]).length, 1, "ровно на границе источник уже молчит");
assert.equal(silent([health(0, false)]).length, 0, "сегодня заведённый источник ещё не молчит");
assert.equal(silent([health(SILENT_DAYS, false)]).length, 1, "а неделю назад заведённый и пустой — молчит");

// --- виды источников в трёх местах ---------------------------------------------
// Форма уже предлагала Telegram, когда действие его ещё не пускало: тип был
// в TypeScript, кнопка в форме, а список разрешённых — свой. Ошибка выглядела
// как отказ базы там, где читатель ничего не нарушал.
const addForm = readFileSync("src/app/(app)/settings/sources/manager.tsx", "utf8");
for (const kind of SOURCE_KINDS) {
  assert.ok(addForm.includes(`value: "${kind}"`), `вид ${kind} должен быть в форме добавления`);
}
const kindCheck = readFileSync("db/migrations/0019_source_kind_telegram.sql", "utf8");
for (const kind of SOURCE_KINDS) {
  assert.ok(kindCheck.includes(`'${kind}'`), `вид ${kind} должен быть разрешён ограничением колонки`);
}
assert.equal(
  (kindCheck.match(/'[a-z]+'(?=[,)])/g) ?? []).length,
  SOURCE_KINDS.length,
  "в ограничении колонки не должно быть видов, которых нет в коде",
);

// --- адрес ведёт наружу, а не внутрь --------------------------------------------
// Машина общая: рядом в той же сети чужие контейнеры. Без этой проверки форма
// добавления источника — сканер внутренней сети, а «HTTP 401» на внутреннем
// адресе это уже ответ.
for (const inside of [
  "127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.1", "172.31.255.255",
  "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "ff02::1",
  // Тот же адрес в записи v4-внутри-v6, в обоих видах: рукописная проверка
  // ловила точечный и пропускала шестнадцатеричный.
  "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:c0a8:1",
  "не адрес вовсе",
]) {
  assert.ok(isInternal(inside), `${inside} — внутренний адрес`);
}
for (const outside of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "2606:4700::1111"]) {
  assert.ok(!isInternal(outside), `${outside} — внешний адрес, его запрещать нельзя`);
}

// --- расположение middleware ------------------------------------------------
// Проект использует srcDirectory, и Next подключает middleware только из src/.
// Лежащий в корне файл не вызывает ни ошибки, ни предупреждения: страницы
// просто отдаются всем. Один раз так и было.
import { existsSync } from "node:fs";
assert.ok(existsSync("src/middleware.ts"), "middleware должен лежать в src/");
assert.ok(!existsSync("middleware.ts"), "middleware в корне не подключается и вводит в заблуждение");

console.log("Самопроверка пройдена: 148 утверждений");
