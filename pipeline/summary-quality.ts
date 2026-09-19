import { TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";

/**
 * Оценка собственного выхода.
 *
 * Словарь ловит механические признаки — слово «ключевой», единицу словом.
 * «Полезное ли это описание» регуляркой не проверить, и на глаз тоже:
 * двенадцать описаний в день читаются нормально, а сдвиг качества после
 * правки промпта виден только рядом чисел.
 *
 * Стоит доли цента: двенадцать описаний вместо трёхсот материалов.
 */
export type SummaryAxes = {
  self_sufficient: { score: number; max: number; confidence: number };
  specifics: { score: number; max: number; confidence: number };
  repeats_headline: { noul: number };
  reader_relevance: { noul: number };
  evaluative: { noul: number };
  direction_clear: { noul: number };
};

export type SummaryQuality = { item_id: number; total: number; axes: SummaryAxes };

function questions(readerContext: string) {
  return {
    self_sufficient: score(
      "Хватит ли этого описания, чтобы не открывать сам материал?",
      [
        "нет: только намёк, суть осталась в источнике",
        "частично: понятно о чём, но без подробностей",
        "да: факт, цифры и следствие на месте",
      ],
    ),
    specifics: score("Сколько в описании конкретики?", [
      "общие слова, ни цифр, ни имён",
      "часть подкреплена",
      "цифры, имена и названный источник",
    ]),
    repeats_headline: noul("Первое предложение описания пересказывает заголовок?", {
      true: "повторяет ту же мысль другими словами",
      false: "продолжает её: доказательство, механизм, следствие",
    }),
    reader_relevance: noul(
      `Читатель: ${readerContext}\n\nСказано ли в описании, чем это касается именно его?`,
      {
        true: "названа связь с его работой, продуктом или решениями",
        false: "связи нет либо вместо неё общее рассуждение",
      },
    ),
    evaluative: noul("Есть ли в описании оценки вместо фактов?", {
      true: "«важный», «ключевой», «прорывной» и подобное",
      false: "только факты и следствия",
    }),
    direction_clear: noul("Понятно ли из описания, в какую сторону изменение?", {
      true: "рост или падение назван словами, число подпирает",
      false: "числа без направления либо направления нет вовсе",
    }),
  };
}

/** Веса подобраны так, что самодостаточность весит больше остального. */
function composite(axes: SummaryAxes): number {
  return (
    30 * (axes.self_sufficient.score / axes.self_sufficient.max) +
    20 * (axes.specifics.score / axes.specifics.max) +
    20 * axes.reader_relevance.noul +
    15 * axes.direction_clear.noul -
    20 * axes.repeats_headline.noul -
    15 * axes.evaluative.noul
  );
}

export async function scoreSummaries(
  items: { id: number; title: string; summary: string }[],
  readerContext: string,
): Promise<{ scored: SummaryQuality[]; inputTokens: number }> {
  const client = new TypeSafeClient();
  const asked = questions(readerContext);

  const scored: SummaryQuality[] = [];
  let inputTokens = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (!item.summary) continue;
      try {
        const result = await client.systemOne({
          state: { Заголовок: item.title, Описание: item.summary },
          questions: asked,
        });
        const a = result.answers;
        const axes: SummaryAxes = {
          self_sufficient: { score: a.self_sufficient.score, max: 2, confidence: a.self_sufficient.confidence },
          specifics: { score: a.specifics.score, max: 2, confidence: a.specifics.confidence },
          repeats_headline: { noul: a.repeats_headline.noul },
          reader_relevance: { noul: a.reader_relevance.noul },
          evaluative: { noul: a.evaluative.noul },
          direction_clear: { noul: a.direction_clear.noul },
        };
        scored.push({ item_id: item.id, total: composite(axes), axes });
        inputTokens += result.usage.input_tokens;
      } catch (error) {
        console.error(`  ! оценка описания «${item.title.slice(0, 40)}»: ${(error as Error).message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(6, items.length) }, worker));
  return { scored, inputTokens };
}
