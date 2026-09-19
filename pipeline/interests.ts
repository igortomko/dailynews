import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import { STARTER_TOPICS } from "../src/lib/starter-topics";

/**
 * Порядок стартовых интересов под конкретного человека.
 *
 * Один вопрос на читателя и только при заведении. `choice` отдаёт
 * вероятности по всем вариантам сразу, а не один ответ, — поэтому
 * двадцать семь интересов стоят один запрос, а не двадцать семь.
 *
 * Порядок показа, а не выбор за читателя: интересы остаются те же самые,
 * меняется только то, какие лежат первыми. Ошибиться здесь можно ровно
 * на «пришлось листать» — цена, за которую не жалко доли цента.
 *
 * Описание в Telegram пишут не все, а многие пишут «ищу себя». Пустая
 * строка сюда не приходит вовсе: вопрос без входа стоит столько же,
 * сколько с ним, а отвечает случайностью.
 */
export type Ranked = { slugs: string[]; inputTokens: number; model: string };

const EMPTY: Ranked = { slugs: [], inputTokens: 0, model: "" };

export async function rankTopics(bio: string): Promise<Ranked> {
  const text = bio.trim();
  if (text.length < 8) return EMPTY;

  const criteria: Record<string, string> = {};
  for (const topic of STARTER_TOPICS) criteria[topic.slug] = `${topic.label}: ${topic.hint}`;

  try {
    const client = new TypeSafeClient();
    const result = await client.systemOne({
      state: { "Человек о себе": text },
      questions: {
        topic: choice(
          "О чём этому человеку скорее всего интересно читать новости каждый день?",
          criteria,
        ),
      },
    });

    const probabilities = result.answers.topic.probabilities as Record<string, number>;
    const slugs = Object.entries(probabilities)
      .sort(([, a], [, b]) => b - a)
      .map(([slug]) => slug)
      // Вариант, которого нет в каталоге, отбрасываем: модель отвечает
      // именами вариантов, но каталог правится файлом, а не ответом.
      .filter((slug) => STARTER_TOPICS.some((topic) => topic.slug === slug));

    return { slugs, inputTokens: result.usage.input_tokens, model: result.model };
  } catch (error) {
    // Порядок интересов — украшение первого экрана. Свалиться на нём
    // значит не завести читателя из-за строчки в его профиле.
    console.error(`rankTopics: ${(error as Error).message}`);
    return EMPTY;
  }
}
