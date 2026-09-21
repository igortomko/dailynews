import { budgetedJev } from "./model-budget";
import { TypeSafeClient, noul, score } from "@typesafe-ai/sdk";

/**
 * Вторая петля вокруг перевода — та же, что с 0012 стоит вокруг описаний.
 *
 * Механические проверки в translate.ts ловят только грубый отказ: число
 * блоков и длину. Текст проходит обе и остаётся плохим русским — калька
 * за калькой, термины переведены насмерть, читать нельзя. На глаз это
 * не ловится: одну статью в день всегда можно прочесть и сказать
 * «нормально». Ловится рядом чисел по дням.
 *
 * Оценивается выборка абзацев, а не статья целиком: полсотни абзацев
 * стоили бы дороже самого перевода, а среднее по пяти уже даёт ряд.
 */
export type TranslationAxes = {
  natural: { score: number; max: number; confidence: number };
  complete: { score: number; max: number; confidence: number };
  calque: { noul: number };
  terms_kept: { noul: number };
};

export type TranslationQuality = {
  total: number;
  axes: TranslationAxes;
  sampled: number;
  inputTokens: number;
  model: string;
};

const QUESTIONS = {
  natural: score("Насколько это похоже на текст, написанный по-русски, а не переведённый?", [
    "сразу видно перевод: порядок слов чужой, читать спотыкаешься",
    "местами спотыкаешься, но смысл идёт",
    "читается как написанное по-русски",
  ]),
  complete: score("Всё ли из оригинала дошло до перевода?", [
    "заметно короче: подробности, оговорки или примеры пропали",
    "почти всё, потеряны мелочи",
    "всё: ни одно утверждение не выпало",
  ]),
  calque: noul("Есть ли в переводе калька с английского?", {
    true: "«является», «в то время как», «это позволяет», буквальные идиомы, цепочки родительных падежей",
    false: "русский синтаксис, глаголы вместо отглагольных существительных",
  }),
  // Отдельная ось, потому что ломается она в обе стороны: и когда термин
  // переводят насмерть («обработчик событий нажатия»), и когда оставляют
  // английским там, где у слова есть общепринятый русский эквивалент.
  terms_kept: noul("Правильно ли обошлись с техническими терминами и названиями?", {
    true: "названия продуктов и стандартов оставлены как есть, у остального взят принятый русский термин",
    false: "термин переведён дословно и стал непонятен, либо оставлен английским без нужды",
  }),
};

function composite(axes: TranslationAxes): number {
  return (
    40 * (axes.natural.score / axes.natural.max) +
    30 * (axes.complete.score / axes.complete.max) +
    15 * axes.terms_kept.noul -
    25 * axes.calque.noul
  );
}

/** Пары «оригинал — перевод», равномерно по статье: начало, середина
 *  и конец ломаются по-разному, и первые три абзаца обманывают. */
export function samplePairs(
  source: string[],
  translated: string[],
  take = 5,
): { from: string; to: string }[] {
  const pairs: { from: string; to: string }[] = [];
  const usable = Math.min(source.length, translated.length);
  if (usable === 0) return pairs;

  const step = Math.max(1, Math.floor(usable / take));
  for (let at = 0; at < usable && pairs.length < take; at += step) {
    const from = source[at];
    const to = translated[at];
    // Короткие блоки и листинги не о переводе: заголовок из двух слов
    // и кусок кода одинаково хороши в любом переводе и разбавляют ряд.
    if (from.length < 200 || /^(```|~~~|\s{4}|#|\||>)/.test(from)) continue;
    pairs.push({ from, to });
  }
  return pairs;
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export async function scoreTranslation(
  source: string[],
  translated: string[],
  readerId?: number,
): Promise<TranslationQuality | null> {
  const pairs = samplePairs(source, translated);
  if (pairs.length === 0) return null;

  const client = new TypeSafeClient();
  const collected: TranslationAxes[] = [];
  let inputTokens = 0;
  let model = "";

  await Promise.all(
    pairs.map(async (pair) => {
      try {
        const result = await budgetedJev(readerId, "translation-quality", { pair, questions: QUESTIONS }, () => client.systemOne({
          state: { Оригинал: pair.from, Перевод: pair.to },
          questions: QUESTIONS,
        }));
        const a = result.answers;
        collected.push({
          natural: { score: a.natural.score, max: 2, confidence: a.natural.confidence },
          complete: { score: a.complete.score, max: 2, confidence: a.complete.confidence },
          calque: { noul: a.calque.noul },
          terms_kept: { noul: a.terms_kept.noul },
        });
        inputTokens += result.usage.input_tokens;
        model = result.model;
      } catch (error) {
        // Оценка не обязана удаваться: она измеряет, а не доставляет.
        // Упавшая оценка не должна ронять отправку книги.
        console.error(`  ! оценка перевода: ${(error as Error).message}`);
      }
    }),
  );

  if (collected.length === 0) return null;

  const axes: TranslationAxes = {
    natural: {
      score: mean(collected.map((a) => a.natural.score)),
      max: 2,
      confidence: mean(collected.map((a) => a.natural.confidence)),
    },
    complete: {
      score: mean(collected.map((a) => a.complete.score)),
      max: 2,
      confidence: mean(collected.map((a) => a.complete.confidence)),
    },
    calque: { noul: mean(collected.map((a) => a.calque.noul)) },
    terms_kept: { noul: mean(collected.map((a) => a.terms_kept.noul)) },
  };

  return { total: composite(axes), axes, sampled: collected.length, inputTokens, model };
}
