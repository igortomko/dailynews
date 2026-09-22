import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import { jevCost } from "./cost";
import { pooled } from "./fetch";

/**
 * Дешёвый привратник перед дорогой сверкой документа с источником.
 *
 * Сверка (`verify`) тратит почти весь свой выход на рассуждение — 334 895
 * токенов из 340 261 за двое суток, — и это 22% счёта за разбор. У Jev
 * выход не тарифицируется вовсе, поэтому то же рассуждение достаётся
 * бесплатно: $0.0001 за вопрос против $0.0065 за вызов и секунда против
 * тридцати.
 *
 * **Привратник не заменяет сверку, а решает, звать ли её.** Он отвечает
 * на один вопрос — «всё ли в пересказе подтверждается источником», — и
 * только уверенное «да» отменяет дорогой вызов. Всё остальное, включая
 * собственный отказ, пропускает дальше: цена ошибки несимметрична, как
 * в дедупе. Лишний дорогой вызов — это цент; пропущенное искажение — число
 * под нашим именем, которого в источнике нет.
 *
 * Замер 22 сентября 2026: 28 карточек, уже прошедших дорогую сверку, плюс
 * те же карточки с внесённой порчей — подменённым числом и дописанным
 * выводом. На пороге 0,5 привратник поднимает тревогу на 18% чистых
 * карточек, ловит 93% подменённых чисел и 100% дописанных выводов.
 * Формулировка «есть ли противоречие» давала меньше ложных тревог (4%),
 * но и чисел ловила хуже (70%) — выбрана полнота, а не экономия.
 *
 * Перед второй сверкой — анализа против текста (`source-audit`) —
 * привратник не ставится, и это тоже замер: там на входе список из
 * десятков переформулированных утверждений, ложных тревог 93–100%
 * при обеих формулировках вопроса. Пересказ утверждения своими словами
 * читается как расхождение, и на полусотне утверждений оно найдётся всегда.
 */

/** Выше этого — зовём дорогую сверку. Ниже — считаем документ чистым. */
export const AUDIT_ALARM = 0.5;

/** Больше этого в вопрос не уходит: у Jev тарифицируется вход. */
const SOURCE_LIMIT = 40_000;

/**
 * Нужна ли дорогая сверка. Отказ привратника — это «нужна»: молчание
 * сломавшегося сторожа не должно выглядеть как разрешение.
 */
export async function auditNeeded(
  source: string,
  summary: string,
  readerId: number,
): Promise<boolean> {
  try {
    const client = new TypeSafeClient();
    const answered = await client.systemOne({
      state: { source: source.slice(0, SOURCE_LIMIT), summary },
      questions: {
        grounded: choice(
          "Всё ли в пересказе подтверждается текстом источника? Число, взятое из источника, " +
          "но приписанное не тому показателю, — это искажение, а не подтверждение.",
          {
            clean: "каждое утверждение подтверждается источником",
            distorted: "есть число или факт, приписанные не тому, к чему они относятся в источнике",
            invented: "есть утверждение, которого в источнике нет вовсе",
          },
        ),
      },
    });

    const probabilities = answered.answers.grounded.probabilities as Record<string, number>;
    // Расход пишется и у «чисто»: вопрос задан и оплачен, а дневной потолок
    // считает деньги, а не полезные ответы. Импорт ленивый: `readers.ts`
    // тянет за собой подключение к базе, а порог отсюда читает `npm test`,
    // который не ходит ни в базу, ни в сеть.
    const { recordCall } = await import("../src/lib/readers");
    await recordCall({
      readerId, stage: "reading-gate", model: answered.model,
      tokensIn: answered.usage.input_tokens, tokensOut: answered.usage.output_tokens,
      costUsd: jevCost(answered.usage.input_tokens),
    });
    return 1 - (probabilities?.clean ?? 0) >= AUDIT_ALARM;
  } catch {
    // Сторож молчит — сверяем дорогой моделью, как и раньше.
    return true;
  }
}

/**
 * Привратник перед сверкой анализа с текстом (`source-audit`) — самой
 * дорогой фазой разбора: 35% счёта, и 99,3% её выхода — рассуждение.
 *
 * Вопрос про весь список утверждений здесь не работает, и это замер:
 * на полусотне переформулированных утверждений Jev находил «расхождение»
 * в 93–100% чистых секций. Поэтому спрашивается не список, а пара —
 * одно утверждение и отрывок, на который оно ссылается, — и по одному
 * запросу на утверждение: пятнадцать вопросов в одном запросе ловили
 * дописанный вывод в 57% случаев, по одному — в 100%. Отрывок отдаётся
 * с соседями: утверждение, склеенное из двух соседних абзацев, без них
 * читается как выдуманное (14% ложных тревог против 8%).
 *
 * Как и перед `verify`, только уверенное «подтверждается» по каждому
 * утверждению отменяет дорогой вызов; первая же тревога зовёт сверку,
 * и остальные пары не спрашиваются. Отказ Jev — тоже «звать».
 *
 * Замер 22 сентября 2026: 971 утверждение из 49 секций, прошедших дорогую
 * сверку на проде, плюс те же утверждения с подменённым числом (450)
 * и с дописанным выводом (971). На пороге 0,5 тревога поднимается
 * на 4,9% чистых утверждений — то есть на трети секций, — ловит 98%
 * подменённых чисел и 100% дописанных выводов. Порог 0,7 отдавал бы ещё
 * 11% секций за 3% чисел; выбрана полнота, как и перед `verify`.
 * Вопрос стоит 1 300 токенов входа, $0.00005; секция в пятнадцать
 * утверждений — $0.0008 против $0.0048 за сверку.
 */
export const CLAIM_ALARM = 0.5;

export type Span = { id: number; text: string };
export type ClaimPair = { id: string; text: string; sourceSpan: number };

export async function sectionAuditNeeded(spans: Span[], claims: ClaimPair[], readerId: number): Promise<boolean> {
  const client = new TypeSafeClient();
  const usage = { input: 0, output: 0 };
  let model = "";
  let alarm = false;
  let failed = false;
  try {
    // Пул на четыре: пятнадцать утверждений — это три секунды, а не
    // пятнадцать. Первая тревога останавливает остальных: сверка пойдёт
    // всё равно, и платить за ответы, которые ничего не решат, незачем.
    await pooled(claims, 4, async (claim) => {
      if (alarm || failed) return;
      const at = claim.sourceSpan - 1;
      const span = spans[at];
      if (!span) { alarm = true; return; }
      try {
        const answered = await client.systemOne({
          state: { span: span.text, textBefore: spans[at - 1]?.text ?? null, textAfter: spans[at + 1]?.text ?? null, claim: claim.text },
          questions: {
            verdict: choice(
              "Is the claim supported by the span, read together with the text before and after it? " +
              "A paraphrase, a merge of several sentences, or a shorter restatement in other words is SUPPORTED. " +
              "A number, date, actor or outcome that the span attributes to something else is DISTORTED. " +
              "A statement, conclusion or event that the span does not contain at all is INVENTED.",
              {
                supported: "the span supports every fact in the claim, possibly in other words",
                distorted: "the claim takes a number, date, actor or outcome from the span but attaches it to the wrong thing",
                invented: "part of the claim is not in the span at all",
              },
            ),
          },
        });
        usage.input += answered.usage.input_tokens;
        usage.output += answered.usage.output_tokens;
        model = answered.model;
        const probabilities = answered.answers.verdict.probabilities as Record<string, number>;
        if (1 - (probabilities?.supported ?? 0) >= CLAIM_ALARM) alarm = true;
      } catch {
        failed = true;
      }
    });
  } finally {
    // Одна строка расхода на секцию, а не на утверждение: считаются деньги,
    // а не вопросы, и полтора десятка строк по центу ничего не добавляют.
    if (usage.input) {
      try {
        const { recordCall } = await import("../src/lib/readers");
        await recordCall({ readerId, stage: "reading-gate", model, tokensIn: usage.input, tokensOut: usage.output, costUsd: jevCost(usage.input) });
      } catch { /* расход не записался — сверка от этого не зависит */ }
    }
  }
  return alarm || failed;
}

/**
 * Повтор мысли между частями карточки.
 *
 * Счётчик слов (`restates`) ловит только повтор словами. На живой карточке
 * про Jev ответ говорил «числа вместо объяснений, почему — не понять»,
 * блок-цепочка — «числа с уверенностью, без объяснений», а абзац ниже —
 * «обычная модель даёт объяснение, Jev только число»: одна мысль трижды,
 * и ни одной общей пары слов сверх порога.
 *
 * Спрашивается по паре, а не про весь документ: на списке частей вопрос
 * «есть ли повтор» отвечает «да» почти всегда — всякая карточка про одно
 * и то же. Вход у Jev тарифицируется, выход нет, поэтому пары идут одним
 * запросом: десять вопросов на карточку стоят $0.00006.
 *
 * Порог тот же, что у дедупа: ниже 0,6 — «разные мысли». Цена ошибки
 * несимметрична в другую сторону, чем у сверки: лишний ремонт стоит цент,
 * а повтор читатель видит первым же взглядом и считает его нашей небрежностью.
 */
export const REPEAT_ALARM = 0.6;

export async function repeatedLayers(
  layers: { name: string; text: string }[],
  readerId: number,
): Promise<[string, string][]> {
  const pairs: [number, number][] = [];
  for (let i = 0; i < layers.length; i++) {
    for (let j = i + 1; j < layers.length; j++) pairs.push([i, j]);
  }
  if (!pairs.length) return [];
  try {
    const client = new TypeSafeClient();
    const questions = Object.fromEntries(pairs.map(([i, j], at) => [`p${at}`, choice(
      "Сообщают ли эти две части одно и то же? Одна мысль, пересказанная другими словами " +
      "или показанная схемой вместо предложения, — это повтор. Разные стороны одного " +
      "события — не повтор.",
      {
        same: "вторая часть не добавляет ничего, чего нет в первой",
        adds: "вторая часть сообщает то, чего в первой нет",
      },
    )]));
    const answered = await client.systemOne({
      state: Object.fromEntries(pairs.map(([i, j], at) => [`p${at}`, { first: layers[i].text, second: layers[j].text }])),
      questions,
    });
    const { recordCall } = await import("../src/lib/readers");
    await recordCall({
      readerId, stage: "reading-repeat", model: answered.model,
      tokensIn: answered.usage.input_tokens, tokensOut: answered.usage.output_tokens,
      costUsd: jevCost(answered.usage.input_tokens),
    });
    return pairs.flatMap(([i, j], at) => {
      const probabilities = (answered.answers as Record<string, { probabilities: Record<string, number> }>)[`p${at}`]?.probabilities;
      return (probabilities?.same ?? 0) >= REPEAT_ALARM ? [[layers[i].name, layers[j].name] as [string, string]] : [];
    });
  } catch {
    // Сторож молчит — повторов не называем: его дело добавлять дефекты,
    // а не придумывать их. Механический счётчик при этом работает.
    return [];
  }
}
