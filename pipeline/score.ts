import { TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";
import type { Axes, Horizon, Kind, Topic, Weights } from "../src/lib/types";

export type Scorable = {
  id: number;
  title: string;
  excerpt: string;
  source_label: string;
  points: number | null;
  comments: number | null;
  published_at: Date | null;
};

export type Scored = {
  item_id: number;
  topic_slug: string;
  confidence: number;
  axes: Axes;
};

/**
 * Восемь осей. Это не «важность вообще», а те различения, по которым
 * читатель решает, открывать или пролистать. Формулировки держим здесь,
 * а не в базе: поменялась формулировка — поменялся смысл колонки в axes,
 * и старые оценки с новыми сравнивать уже нельзя.
 */
const KIND_CRITERIA: Record<Kind, string> = {
  fact: "произошедшее событие: выпустили, купили, закрыли, измерили",
  forecast: "прогноз или предсказание о будущем",
  opinion: "мнение, колонка, рассуждение без нового факта",
  announcement: "анонс: обещание выпустить, открыть набор, показать позже",
  reprint: "пересказ чужого материала без собственных данных",
};

const HORIZON_CRITERIA: Record<Horizon, string> = {
  noise: "шум дня: через неделю никто не вспомнит",
  months: "влияет на ближайшие месяцы",
  years: "сигнал на годы: сдвиг тренда, технологии или рынка",
};

/**
 * Вопросы не зависят от читателя. Семь осей — про сам материал, восьмая
 * классифицирует его по общему справочнику тем. Поэтому поток оценивается
 * один раз на всех: сто читателей стоят в Jev столько же, сколько один.
 *
 * Прежняя формулировка темы начиналась с «Читатель: <контекст>». В общей
 * оценке её пришлось убрать: она делала бы результат персональным, а значит
 * требовала бы прогонять Jev заново на каждого. Числа до и после этой правки
 * сравнивать нельзя — вопрос стал другим.
 */
function buildQuestions(topics: Topic[]) {
  const topicCriteria: Record<string, string> = {};
  for (const topic of topics) {
    topicCriteria[topic.slug] = topic.hint || topic.label;
  }
  topicCriteria.other = "ни одна из перечисленных тем не подходит";

  return {
    topic: choice("К какой из тем относится материал?", topicCriteria),
    kind: choice("Что это за материал по типу?", KIND_CRITERIA),
    horizon: choice("На какой горизонт это влияет?", HORIZON_CRITERIA),
    novelty: score("Насколько это новое, а не пережёвывание уже известного?", [
      "уже известное, пересказ давно обсуждённого",
      "развитие сюжета, который читатель, вероятно, уже видел",
      "новое событие, которого раньше не было",
    ]),
    specifics: score("Сколько в материале конкретики?", [
      "ни цифр, ни названного источника, ни первичных данных",
      "часть подкреплена: либо цифры, либо источник",
      "цифры, названный источник и первичные данные",
    ]),
    depth: score("Насколько материал самодостаточен?", [
      "заголовок и пара абзацев, читать нечего",
      "обычная заметка",
      "разбор, за которым стоит работа: данные, код, длинный текст",
    ]),
    actionable: noul("Требует ли это от читателя действия в ближайшие дни?", {
      true: "нужно что-то сделать, проверить или решить сейчас",
      false: "можно просто знать",
    }),
    clickbait: noul("Заголовок обещает больше, чем даёт материал?", {
      true: "заголовок раздут, интрига вместо факта",
      false: "заголовок честно описывает содержание",
    }),
  };
}

/** Вес типа материала. Мнения и перепечатки — основной объём любой ленты. */
const KIND_WEIGHT: Record<Kind, number> = {
  fact: 1,
  forecast: 0.55,
  announcement: 0.5,
  opinion: 0.3,
  reprint: 0,
};

const HORIZON_WEIGHT: Record<Horizon, number> = { years: 1, months: 0.6, noise: 0 };

/** У noul нет своего confidence: уверенность — это удалённость от 0.5. */
const noulConfidence = (p: number) => Math.abs(p - 0.5) * 2;

/**
 * Скор — о материале, а не о теме. Вес темы сюда не входит: он решает,
 * сколько мест тема берёт в дайджесте (pipeline/select.ts), и, умножая
 * заодно скор, делал бы числа разных тем несравнимыми — корзины на странице
 * калибровки поехали бы от одной правки внимания.
 *
 * Веса персональны, поэтому один и тот же материал имеет столько скоров,
 * сколько читателей. Формула одна и живёт здесь: копия на SQL разъехалась
 * бы с этой молча, и разошлись бы отбор и калибровка.
 */
export function composite(axes: Axes, weights: Weights): number {
  const topicTerm = axes.topic.choice === "other"
    ? 0
    : axes.topic.probabilities[axes.topic.choice];

  return (
    weights.topic * topicTerm +
    weights.kind * KIND_WEIGHT[axes.kind.choice] +
    weights.horizon * HORIZON_WEIGHT[axes.horizon.choice] +
    weights.novelty * (axes.novelty.score / axes.novelty.max) +
    weights.specifics * (axes.specifics.score / axes.specifics.max) +
    weights.depth * (axes.depth.score / axes.depth.max) +
    weights.actionable * axes.actionable.noul +
    weights.clickbait * axes.clickbait.noul
  );
}

/**
 * Прогоняет весь поток, а не выборку: один запрос на материал, все восемь
 * вопросов внутри него — Jev считает их параллельно, и восьмой вопрос почти
 * ничего не добавляет ко времени ответа.
 *
 * Больше восьми одновременных запросов упираются в лимит общего ключа
 * (предупреждение в документации TypeSafe), поэтому пул фиксированный.
 */
export async function scoreAll(
  items: Scorable[],
  topics: Topic[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ scored: Scored[]; usage: { input: number; output: number }; model: string }> {
  const client = new TypeSafeClient();
  const questions = buildQuestions(topics);

  const scored: Scored[] = [];
  const usage = { input: 0, output: 0 };
  let model = "";
  let done = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        const result = await client.systemOne({
          state: {
            title: item.title,
            excerpt: item.excerpt.slice(0, 1500),
            source: item.source_label,
            points: item.points,
            comments: item.comments,
            published: item.published_at?.toISOString() ?? null,
          },
          questions,
        });

        const a = result.answers;
        const axes: Axes = {
          topic: {
            choice: a.topic.choice,
            confidence: a.topic.confidence,
            probabilities: a.topic.probabilities as Record<string, number>,
          },
          kind: {
            choice: a.kind.choice as Kind,
            confidence: a.kind.confidence,
            probabilities: a.kind.probabilities as Record<string, number>,
          },
          horizon: {
            choice: a.horizon.choice as Horizon,
            confidence: a.horizon.confidence,
            probabilities: a.horizon.probabilities as Record<string, number>,
          },
          novelty: { score: a.novelty.score, max: 2, confidence: a.novelty.confidence },
          specifics: { score: a.specifics.score, max: 2, confidence: a.specifics.confidence },
          depth: { score: a.depth.score, max: 2, confidence: a.depth.confidence },
          actionable: { noul: a.actionable.noul },
          clickbait: { noul: a.clickbait.noul },
        };

        const confidences = [
          axes.topic.confidence, axes.kind.confidence, axes.horizon.confidence,
          axes.novelty.confidence, axes.specifics.confidence, axes.depth.confidence,
          noulConfidence(axes.actionable.noul), noulConfidence(axes.clickbait.noul),
        ];

        scored.push({
          item_id: item.id,
          topic_slug: axes.topic.choice,
          confidence: confidences.reduce((a, b) => a + b, 0) / confidences.length,
          axes,
        });

        usage.input += result.usage.input_tokens;
        usage.output += result.usage.output_tokens;
        model = result.model;
      } catch (error) {
        // Один упавший материал не должен ронять прогон: он просто
        // останется без оценки и не попадёт в отбор.
        console.error(`  ! скоринг «${item.title.slice(0, 50)}»: ${(error as Error).message}`);
      } finally {
        onProgress?.(++done, items.length);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(8, items.length) }, worker));
  return { scored, usage, model };
}
