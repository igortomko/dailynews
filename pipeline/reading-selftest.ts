import assert from "node:assert/strict";
import { documentSchema, validateCoverage, validateSection, validateQuotes, documentText, parseStoredReading, blockText, normalizeDocument, restates, fillers, CRITICAL_PER_SECTION, CRITICAL_PER_DOCUMENT, type ArticleAnalysis, type ReadingDocument } from "../src/lib/reading-document";
import { splitSource, composeDocument, analyzeSource, reasoningEffortFor, VERIFY_SOURCE_CHARS, type Ask } from "./reading";
import { typography, summaryTime } from "../src/lib/typography";
import { digestHtml } from "./kindle";
import { DEFAULT_VOICE } from "../src/lib/voice";
import { ru as RU_DICT } from "../src/lib/i18n/ru/index";
import { en as EN_DICT } from "../src/lib/i18n/en/index";

const evidence = (text: string, ...claimIds: string[]) => ({ text, claimIds });
const analysis: ArticleAnalysis = { sourceVersion: "v", availability: "article_text", sections: [{
  id: "s1", start: 0, end: 120, subject: "Test", genre: "research", excluded: [],
  claims: [
    { id: "s1-a", text: "Speed improved", quote: "Speed improved", importance: "critical", role: "fact" },
    { id: "s1-b", text: "No effect on accuracy", quote: "No effect on accuracy", importance: "critical", role: "limitation" },
    { id: "s1-c", text: "24 participants", quote: "24 participants", importance: "major", role: "fact" },
  ],
}] };
const valid: ReadingDocument = {
  schemaVersion: 2, genre: "research", title: evidence("Speed improved in 24 participants", "s1-a", "s1-c"),
  lead: evidence("In a 24-person test, participants completed the task faster without losing accuracy. The result is limited to this small sample and does not establish that the intervention works for other people, settings or longer periods, but it gives a concrete measured effect.", "s1-a", "s1-c"),
  blocks: [{ kind: "paragraph", content: evidence("No effect on accuracy.", "s1-b") }], evidence: null, application: null,
  omitted: [], baselineId: null,
};
assert.deepEqual(validateCoverage(valid, analysis, "", []), []);
assert.ok(validateCoverage({ ...valid, lead: null }, analysis, "", []).some((e) => e.includes("Missing a 35–60 word answer")));
assert.ok(validateCoverage({ ...valid, lead: evidence("Too short.", "s1-a") }, analysis, "", []).some((e) => e.includes("The answer is 2 words")));
const missing = structuredClone(valid); missing.blocks = [{ kind: "paragraph", content: evidence("Speed improved", "s1-a") }];
assert.ok(validateCoverage(missing, analysis, "", []).some((e) => e.includes("s1-b")));
assert.ok(!documentSchema.safeParse({ ...valid, blocks: [{ kind: "html", html: "<script>alert(1)</script>" }] }).success);
const extra = structuredClone(valid); extra.blocks.push({ kind: "takeaway", attribution: "Author", content: evidence("Takeaway", "s1-a") }, { kind: "metric", value: "24", label: "participants", context: evidence("Population", "s1-c") });
assert.ok(validateCoverage(extra, analysis, "", []).some((e) => e.includes("one visual")));
const madeUp = structuredClone(valid); madeUp.title.claimIds = ["invented"];
assert.ok(validateCoverage(madeUp, analysis, "", []).some((e) => e.includes("Unknown")));
const application = { ...valid, application: { text: "Do a thing", condition: "If relevant", claimIds: ["s1-a"], contextQuote: "I am an expert in training" } };
assert.ok(validateCoverage(application, analysis, "I follow AI products", []).some((e) => e.includes("context")));
assert.ok(validateCoverage({ ...valid, baselineId: 88 }, analysis, "", [12]).some((e) => e.includes("previous")));
assert.ok(validateSection({ ...analysis.sections[0], claims: [{ ...analysis.sections[0].claims[0], quote: "invented quote" }] }, "Speed improved").length > 0);
assert.equal(parseStoredReading({ version: 2, status: "verified", document: null }), null);
const long = 'Beginning. '.repeat(1800) + 'The result was reversed in the final section.';
const parts = splitSource(long);
assert.equal(parts.map((p) => p.text).join(""), long);
assert.ok(parts.at(-1)?.text.endsWith('final section.'));
assert.ok(parts.every((p,i) => p.start === (i ? parts[i-1].end : 0)));
assert.throws(() => splitSource('a'.repeat(160001)), /limit/);
assert.equal(summaryTime(61, RU_DICT.feed.time), '1\u00a0мин 10\u00a0с');
// «мин» и «с» тоже подписи, а не разметка: у английского они «min» и «s».
assert.equal(summaryTime(61, EN_DICT.feed.time), '1\u00a0min 10\u00a0s');
assert.equal(typography('на 5 км'), 'на\u00a05\u00a0км');
assert.equal(typography('и в статье'), 'и\u00a0в\u00a0статье');
assert.equal(typography('6 сентября'), '6\u00a0сентября');
assert.equal(typography('Шаг 1'), 'Шаг\u00a01');
assert.equal(typography('Qwen2.5-32B и 2026-09-21'), 'Qwen2.5-32B и\u00a02026-09-21');
assert.equal(typography('2023–2024 годы'), '2023\u2060–\u20602024 годы');
assert.equal(reasoningEffortFor('extract'), 'none');
assert.equal(reasoningEffortFor('extract-repair'), 'none');
assert.equal(reasoningEffortFor('compose'), 'low');
assert.equal(reasoningEffortFor('verify'), 'low');
// Короткое слово не висит в конце строки ни в одной письменности: мера —
// длина, а не словарь предлогов. Список отвечал только за кириллицу,
// и латинские «a», «is», «of» не совпадают с ней даже там, где выглядят
// одинаково, — на двухстах живых выпусках так пропускалось 811 слов из 2896.
assert.equal(typography('a new model'), 'a\u00a0new model');
assert.equal(typography('The cat is on a mat'), 'The cat is\u00a0on\u00a0a\u00a0mat');
assert.equal(typography('их он ли'), 'их\u00a0он\u00a0ли');
// Три буквы общим правилом задели бы «дом», «код» и «год», поэтому
// трёхбуквенные предлоги остались перечнем.
assert.equal(typography('дом код год'), 'дом код год');
assert.equal(typography('для дома'), 'для\u00a0дома');
// Притяжательное «s» — не короткое слово, а хвост предыдущего: склеив его
// со следующим, мы запретили бы разрыв ровно там, где он и уместен.
assert.equal(typography("Anthropic's model"), "Anthropic's model");
assert.equal(typography('Anthropic\u2019s model'), 'Anthropic\u2019s model');
// Дефисное слово целиком, а не «по» из его начала.
assert.equal(typography('по-прежнему дом'), 'по-прежнему дом');
assert.ok(documentText(valid).includes('No effect on accuracy'));
const quotation: ReadingDocument = { ...valid, blocks: [{ kind: 'quote', attribution: 'Author', content: evidence('No effect on accuracy', 's1-b') }] };
assert.deepEqual(validateQuotes(quotation, 'The study found No effect on accuracy in participants.'), []);
assert.ok(validateQuotes(quotation, 'Accuracy improved.').length > 0, 'invented and translated quotations cannot pass');
assert.ok(documentText(quotation).includes('“No effect on accuracy”\n— Author'));
const sixSteps = { ...valid, blocks: [{ kind: 'list', numbering: 'facts', items: Array.from({length:6}, (_,i)=>evidence(`Step ${i+1}`, 's1-b')) }] };
assert.ok(documentSchema.safeParse(sixSteps).success, 'preserve all six steps rather than merging the source sequence');
const kindle = digestHtml('2026-09-21','',[{ title:'<unsafe>',summary:'First\n\nSecond',url:'https://example.com/?a="x"',source_label:'Source',topic_label:'Topic' }]);
assert.ok(kindle.includes('&lt;unsafe&gt;'));
assert.ok(kindle.includes('<p>First</p>') && kindle.includes('<p>Second</p>'));
assert.ok(kindle.includes('&quot;'));

assert.ok(blockText({ kind: 'steps', sequence: 'timeline', items: [{ label: 'Launch', content: evidence('Release', 's1-a'), state: 'planned' }, { label: 'Pilot', content: evidence('Trial', 's1-a'), state: 'current' }] }).includes('(предстоит)'));
// Цель — 220 слов, отказ — на десятую часть позже: сверенная карточка,
// выброшенная за десять лишних слов, стоит читателю новости целиком.
assert.deepEqual(validateCoverage({ ...valid, blocks: [{ kind: 'paragraph', content: evidence('word '.repeat(120), 's1-b') }] }, analysis, '', []), [], 'перебор в пределах десятой части не отказ (170 + 10%)');
assert.ok(validateCoverage({ ...valid, blocks: [{ kind: 'paragraph', content: evidence('word '.repeat(200), 's1-b') }] }, analysis, '', []).some(e => e.includes('maximum')));
// Обязательных утверждений не больше семи на секцию: при восьми и больше
// «все critical видимы» и «не длиннее 220 слов» перестают быть совместимы,
// и карточка не собирается вовсе (замер на выпуске 22 сентября 2026).
const claimOf = (id: string, importance: 'critical' | 'major') => ({ id, text: id, quote: id, importance, role: 'fact' as const });
const sectionWith = (critical: number) => ({ subject: 'Test', genre: 'research' as const, excluded: [],
  claims: [...Array.from({ length: critical }, (_, i) => claimOf(`c${i}`, 'critical')), claimOf('m1', 'major')] });
assert.deepEqual(validateSection(sectionWith(7), 'c0 c1 c2 c3 c4 c5 c6 m1'), [], 'семь обязательных утверждений — ещё норма');
assert.ok(CRITICAL_PER_DOCUMENT < CRITICAL_PER_SECTION * 2,
  'потолок на статью строже суммы секционных: иначе двухсекционная статья снова не собирается');
assert.ok(validateSection(sectionWith(8), 'c0 c1 c2 c3 c4 c5 c6 c7 m1').some(e => e.includes('at most 7')), 'восьмое обязательное утверждение — дефект извлечения');
assert.deepEqual(normalizeDocument({ ...valid, omitted: [{ claimId: 's1-a', reason: 'Accidental duplicate' }] }).omitted, []);

// Два слоя: ответ закрывает главный вопрос сам, лид — второй слой и потому
// необязателен. Документ, у которого лид повторяет ответ, читается дважды.
const twoLayer: ReadingDocument = { ...valid, answer: valid.lead, lead: null };
assert.deepEqual(validateCoverage(twoLayer, analysis, '', []), [], 'ответ работает первым слоем вместо лида');
assert.ok(validateCoverage({ ...twoLayer, lead: twoLayer.answer ?? null }, analysis, '', []).some(e => e.includes('repeats the answer')));
assert.ok(documentText(twoLayer).startsWith(twoLayer.answer!.text), 'текст карточки открывается ответом');

// План формы — обещание, а не украшение: названная форма обязана появиться
// блоком, иначе это возврат к прозе под видом решения.
const planned = (format: string, blocks: ReadingDocument['blocks']): ReadingDocument =>
  ({ ...twoLayer, formatPlan: { format, reason: 'Source states two measured values', claimIds: ['s1-a'], fallback: 'brief' } as ReadingDocument['formatPlan'], blocks });
const figuresBlock: ReadingDocument['blocks'] = [{ kind: 'figures', items: [
  { value: '78%', label: 'дешевле документ', claimIds: ['s1-a'] },
  { value: '7,3×', label: 'чаще успех', claimIds: ['s1-b'] }], context: null }];
assert.deepEqual(validateCoverage(planned('figures', figuresBlock), analysis, '', []), [], 'ряд чисел закрывает план figures');
assert.ok(validateCoverage(planned('figures', valid.blocks), analysis, '', []).some(e => e.includes('requires a figures block')));
assert.ok(validateCoverage({ ...planned('brief', valid.blocks), formatPlan: { format: 'brief', reason: 'Prose', claimIds: ['nope'], fallback: 'story' } } as ReadingDocument, analysis, '', []).some(e => e.includes('Unknown format-plan claim')));
assert.ok(documentSchema.safeParse({ ...twoLayer, blocks: figuresBlock }).success, 'ряд из двух чисел проходит схему');
assert.ok(!documentSchema.safeParse({ ...twoLayer, blocks: [{ kind: 'figures', items: [figuresBlock[0].kind === 'figures' ? figuresBlock[0].items[0] : null], context: null }] }).success, 'одно число — это metric, а не ряд');
const correction: ReadingDocument['blocks'] = [{ kind: 'correction', claim: 'Модель считалась быстрее всех', reality: evidence('Замер показал обратное', 's1-b') }];
assert.ok(documentSchema.safeParse({ ...twoLayer, blocks: correction }).success);
assert.ok(blockText(correction[0]).includes('Замер показал обратное'));
assert.ok(blockText(figuresBlock[0]).includes('78%') && blockText(figuresBlock[0]).includes('7,3×'));
// Матрица: несколько объектов на одних шкалах. Абзацем это читается подряд
// и не сравнивается — замер на живой карточке про Grok 4.7, где четыре модели
// стояли в тексте по двум бенчмаркам.
const tableBlock: ReadingDocument['blocks'] = [{ kind: 'table',
  columns: ['CursorBench', 'Terminal-Bench'],
  rows: [
    { label: 'Grok 4.7', cells: ['46,3%', '38,0%'], claimIds: ['s1-a'] },
    { label: 'Fable 5.1', cells: ['51,8%', '57,9%'], claimIds: ['s1-b'] },
  ], context: null }];
assert.ok(documentSchema.safeParse({ ...twoLayer, blocks: tableBlock }).success, 'таблица проходит схему');
assert.ok(blockText(tableBlock[0]).includes('Grok 4.7: 46,3% · 38,0%'), 'таблица читается строками и в тексте');
assert.deepEqual(validateCoverage(planned('table', tableBlock), analysis, '', []), [], 'план table закрывается таблицей');
assert.ok(validateCoverage(planned('table', valid.blocks), analysis, '', []).some(e => e.includes('requires a table block')));

// Повтор между слоями ловится кодом: запрет в промпте протекает, а читатель
// видит сразу. Замер на живой карточке Grok 4.7 — лид обещал «цена как у 4.6»
// и «тщательнее себя проверяет», абзацы ниже повторяли и то и другое.
{
  const lead = 'Grok 4.7 — новая модель для программирования и работы со знаниями. Разработчик обещает: дольше тянет трудные задачи, тщательнее себя проверяет, цена как у 4.6.';
  const again = 'Внутри — новая, более крупная базовая модель, чем у 4.6, и более длинное обучение с подкреплением (дообучение на наградах) на наборе задач посложнее, с упором на те, что занимают много часов. Модель лучше проверяет свою работу и держит более длинный контекст, а также нативно понимает Grok Bot — собственный агентный каркас разработчика.';
  const next = 'Защиты новые: разработчик называет модель сильнейшей из протестированных по отказам и джейлбрейкам; на HackerBench v0.3 она пропустила лишь 3,3% рискованных запросов.';
  assert.ok(restates(lead, again), 'повтор обещания и числа виден счётчиком');
  assert.ok(!restates(lead, next), 'новое содержание повтором не считается');
  assert.ok(!restates('46,3 балла', 'Балл сводного индекса вырос до 46,3 против прошлой версии'),
    'короткий акцент рядом с абзацем про то же число — не повтор, его судит промпт');
  // Обороты, которые ничего не сообщают, ловятся счётчиком: запрет
  // в промпте протекает так же, как протекал запрет повторов.
  assert.deepEqual(fillers('Стоит отметить, что цена выросла'), ['Стоит отметить']);
  assert.deepEqual(fillers('В статье говорится о росте'), ['В статье говорится']);
  assert.deepEqual(fillers('Автор пишет, что рынок вырос'), ['Автор пишет, что']);
  assert.deepEqual(fillers('Цена выросла вдвое за квартал'), [], 'обычный текст чист');
  assert.deepEqual(fillers('The vendor reports a 20% gain'), [], 'английский текст судит промпт, а не список');
  const padded: ReadingDocument = { ...twoLayer,
    blocks: [{ kind: 'paragraph', content: { text: 'Стоит отметить, что точность не изменилась.', claimIds: ['s1-b'] } }] };
  assert.ok(validateCoverage(padded, analysis, '', []).some(e => e.includes('throat-clearing')));

  const repeating: ReadingDocument = { ...twoLayer, answer: { text: lead, claimIds: ['s1-a'] },
    blocks: [{ kind: 'paragraph', content: { text: again, claimIds: ['s1-b'] } }] };
  assert.ok(validateCoverage(repeating, analysis, '', []).some(e => e.includes('restates the answer')));
}
// Сравнение перестало быть строго парным: у моделей и тарифов вариантов больше.
assert.ok(documentSchema.safeParse({ ...twoLayer, blocks: [{ kind: 'comparison', commonBasis: evidence('Цена за миллион', 's1-a'), emphasis: 'content',
  items: [{ label: 'A', content: evidence('1$', 's1-a') }, { label: 'B', content: evidence('2$', 's1-b') }, { label: 'C', content: evidence('3$', 's1-c') }] }] }).success, 'сравнение на три варианта');

async function main() {
  const visited: string[] = [];
  const extract: Ask = async (phase, _rules, data, schema) => {
    if (phase === 'source-audit') return schema.parse({ defects: [] });
    const spans = (data as { section: { spans: { id: number; text: string }[] } }).section.spans;
    visited.push(spans.map(s => s.text).join(''));
    return schema.parse({ subject: 'End of section', genre: 'narrative', claims: [{ id: 'c1', text: 'The ending matters', importance: 'critical', role: 'fact', sourceSpan: spans.at(-1)!.id }], excluded: [] });
  };
  const grounded = await analyzeSource(extract, long, 'Story', 'v', 'article_text');
  assert.equal(visited.join(''), long, 'the extractor sees every character, including the end');
  assert.ok(grounded.sections.at(-1)!.claims[0].quote.endsWith('final section.'), 'source evidence is attached from the original span, not copied by the model');
  // Привратник перед сверкой анализа: уверенное «подтверждается» по всем
  // парам отменяет дорогой вызов, тревога зовёт его, а без привратника
  // сверка идёт всегда — как и до него.
  const audited: string[] = [];
  const counting: Ask = async (phase, rules, data, schema) => { audited.push(phase); return extract(phase, rules, data, schema); };
  await analyzeSource(counting, long, 'Story', 'v', 'article_text', async () => false);
  assert.ok(!audited.includes('source-audit'), 'чистые пары отменяют сверку анализа');
  audited.length = 0;
  await analyzeSource(counting, long, 'Story', 'v', 'article_text', async () => true);
  assert.ok(audited.includes('source-audit'), 'тревога привратника зовёт сверку');
  audited.length = 0;
  await analyzeSource(counting, long, 'Story', 'v', 'article_text');
  assert.ok(audited.includes('source-audit'), 'без привратника сверка идёт всегда');
  const phases: string[] = [];
  const ask: Ask = async (phase, _rules, _data, schema) => {
    phases.push(phase);
    return schema.parse(phase.startsWith("compose") ? (phase === "compose" ? missing : valid) : { defects: [] });
  };
  const repaired = await composeDocument(ask, "Speed improved. No effect on accuracy. 24 participants.", analysis, "", DEFAULT_VOICE, "Research", []);
  assert.equal(repaired.blocks[0].kind, "paragraph");
  assert.deepEqual(phases, ["compose", "compose-repair", "verify"]);

  // Проверка идёт по статье целиком, а не по кускам извлечения: иначе
  // документ, разбор и правила оплачиваются столько раз, сколько у статьи
  // кусков, а модель объявляет неподтверждённым то, что подтверждено
  // страницей раньше.
  const wholeArticle: string[] = [];
  const countingVerify: Ask = async (phase, _rules, data, schema) => {
    if (phase === "verify") wholeArticle.push((data as { sourceSection: { text: string } }).sourceSection.text);
    return schema.parse(phase.startsWith("compose") ? valid : { defects: [] });
  };
  const longSource = `${"Speed improved. No effect on accuracy. 24 participants. ".repeat(600)}`;
  assert.ok(longSource.length > 30_000 && longSource.length < VERIFY_SOURCE_CHARS, 'источник замера длиннее трёх кусков извлечения');
  await composeDocument(countingVerify, longSource, analysis, "", DEFAULT_VOICE, "Research", []);
  assert.equal(wholeArticle.length, 1, 'статья на тридцать тысяч знаков проверяется одним вызовом, а не тремя');
  // Повтор мысли между частями возвращается дефектом до дорогой сверки:
  // счётчик слов ловит повтор словами, а «одно и то же другими словами» —
  // нет, и это видит читатель первым же взглядом.
  const repeatPhases: string[] = [];
  const withRepeat: Ask = async (phase, _rules, _data, schema) => {
    repeatPhases.push(phase);
    return schema.parse(phase.startsWith("compose") ? valid : { defects: [] });
  };
  await composeDocument(withRepeat, "Speed improved. No effect on accuracy. 24 participants.", analysis, "", DEFAULT_VOICE, "Research", [], "regular",
    // Привратник сверки отвечает «чисто», поэтому дорогого вызова не будет
    // ни на первом проходе (его останавливает повтор), ни на втором.
    async () => false,
    // Повтор называется один раз: ремонт его убирает, как и настоящий.
    (() => { let asked = 0; return async (layers: { name: string; text: string }[]) =>
      asked++ === 0 && layers.length > 1 ? [[layers[0].name, layers[1].name] as [string, string]] : []; })());
  assert.ok(repeatPhases.includes("compose-repair"), "повтор чинится ремонтом, а не проходит дальше");
  assert.ok(!repeatPhases.includes("verify"), "дорогая сверка не зовётся на документ, который всё равно переписывать");

  const semanticPhases: string[] = [];
  const semanticRepair: Ask = async (phase, _rules, _data, schema) => {
    semanticPhases.push(phase);
    if (phase === "compose" || phase === "compose-repair") return schema.parse(missing);
    if (phase === "compose-final-repair") return schema.parse(valid);
    return schema.parse({ defects: [] });
  };
  const semanticallyRepaired = await composeDocument(semanticRepair, "Speed improved. No effect on accuracy. 24 participants.", analysis, "", DEFAULT_VOICE, "Research", []);
  assert.equal(semanticallyRepaired.blocks[0].kind, "paragraph");
  assert.deepEqual(semanticPhases, [
    "compose", "compose-repair", "compose-final-repair", "verify",
  ], "a remaining missing critical claim receives one bounded semantic repair");
  const overlong: ReadingDocument = {
    ...valid,
    blocks: [{ kind: "paragraph", content: evidence(`No effect on accuracy. ${"Detail ".repeat(220)}`, "s1-b") }],
  };
  const compactPhases: string[] = [];
  const compactRepair: Ask = async (phase, _rules, _data, schema) => {
    compactPhases.push(phase);
    if (phase === "compose" || phase === "compose-repair") return schema.parse(missing);
    if (phase === "compose-final-repair") return schema.parse(overlong);
    if (phase === "compose-compact-repair") return schema.parse(valid);
    return schema.parse({ defects: [] });
  };
  const compacted = await composeDocument(compactRepair, "Speed improved. No effect on accuracy. 24 participants.", analysis, "", DEFAULT_VOICE, "Research", []);
  assert.equal(compacted.blocks[0].kind, "paragraph");
  assert.deepEqual(compactPhases, [
    "compose", "compose-repair", "compose-final-repair", "compose-compact-repair", "verify",
  ], "an overlong semantic repair receives one bounded compact repair");
  const lostConclusion = {
    ...valid,
    blocks: [{ kind: "paragraph" as const, content: evidence("Speed improved.", "s1-a") }],
  };
  const lengthPhases: string[] = [];
  const lengthRepair: Ask = async (phase, _rules, _data, schema) => {
    lengthPhases.push(phase);
    if (phase === "compose" || phase === "compose-repair") return schema.parse(overlong);
    if (phase === "compose-length-repair") return schema.parse(lostConclusion);
    if (phase === "compose-final-repair") return schema.parse(valid);
    return schema.parse({ defects: [] });
  };
  const finalRepaired = await composeDocument(lengthRepair, "Speed improved. No effect on accuracy. 24 participants.", analysis, "", DEFAULT_VOICE, "Research", []);
  assert.equal(finalRepaired.blocks[0].kind, "paragraph");
  assert.deepEqual(lengthPhases, [
    "compose", "compose-repair", "compose-length-repair", "compose-final-repair", "verify",
  ], "a length repair that loses a critical conclusion receives one bounded semantic repair");
  const rejecting: Ask = async (phase, _rules, _data, schema) => schema.parse(phase.startsWith("compose") ? valid : { defects: [{ kind: "contradiction", issue: "The limitation is misstated", sourceEvidence: "No effect on accuracy", correction: "Keep the null result" }] });
  await assert.rejects(() => composeDocument(rejecting, "Source", analysis, "", DEFAULT_VOICE, "Research", []), /failed verification/);
  console.log("  reading: full-source coverage, semantic repair/failure, unsafe block rejection, reader context, typography and text delivery passed");
}
main().catch((error: unknown) => { console.error(error); process.exitCode=1; });
