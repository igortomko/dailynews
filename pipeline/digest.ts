import type { Axes } from "../src/lib/types";

export type Survivor = {
  id: number;
  title: string;
  excerpt: string;
  url: string;
  source_label: string;
  topic_label: string;
  total: number;
  axes: Axes;
};

export type Written = {
  id: number;
  title_ru: string;
  summary: string;
};

export type DigestResult = { intro: string; items: Written[] };

const BASE_URL = process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai";
const MODEL = process.env.LLM_MODEL ?? "gemini-2.5-flash";

/**
 * Дорогая модель видит только выживших — пятнадцать материалов вместо трёхсот.
 * Отбор уже сделан кодом по оценкам Jev, здесь только письмо.
 */
export async function writeDigest(
  survivors: Survivor[],
  readerContext: string,
): Promise<DigestResult> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    // Без ключа дайджест всё равно собирается — просто исходными заголовками.
    return {
      intro: "",
      items: survivors.map((s) => ({
        id: s.id,
        title_ru: s.title,
        summary: s.excerpt.slice(0, 300),
      })),
    };
  }

  const block = survivors
    .map((s) => [
      `--- id: ${s.id}`,
      `ЗАГОЛОВОК: ${s.title}`,
      `ИСТОЧНИК: ${s.source_label} · тема: ${s.topic_label}`,
      `ТИП: ${s.axes.kind.choice} · горизонт: ${s.axes.horizon.choice}`,
      `ТЕКСТ: ${s.excerpt.slice(0, 900) || "(нет)"}`,
    ].join("\n"))
    .join("\n\n");

  const prompt = `${readerContext}

Ниже ${survivors.length} материалов, уже отобранных по интересам читателя. Для каждого дай:
1. "title_ru" — заголовок по-русски: живой, не дословный перевод.
2. "summary" — 2–3 предложения: что произошло, почему это важно именно этому читателю. Информативно, без восторгов и без воды. Если в материале есть цифры — они должны быть в саммари.

И ещё "intro" — одно-два предложения обо всей подборке: что сегодня главное и есть ли связь между материалами. Без приветствий.

Материалы:
${block}

Ответь только валидным JSON, без markdown:
{"intro": "...", "items": [{"id": <число>, "title_ru": "...", "summary": "..."}]}`;

  const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
    // Рассуждающие модели тратят на дайджест по несколько минут; потолок
    // должен быть выше их худшего случая, иначе прогон падает молча.
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const payload = await res.json();
  const text: string = payload.choices?.[0]?.message?.content ?? "";
  const json = text.replace(/```(?:json)?/g, "").trim();
  const match = json.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`LLM вернул не JSON: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(match[0]) as { intro?: string; items?: Written[] };
  const known = new Map(survivors.map((s) => [s.id, s]));

  // id приводим к числу: модель возвращает их то числом, то строкой, и при
  // строгом сравнении не совпадает ни один — тогда весь дайджест молча
  // заполняется подстановкой и выглядит как успешный.
  const written = (parsed.items ?? [])
    .map((item) => ({ ...item, id: Number(item.id) }))
    .filter((item) => known.has(item.id));

  const missing = survivors.filter((s) => !written.some((w) => w.id === s.id));
  for (const survivor of missing) {
    written.push({ id: survivor.id, title_ru: survivor.title, summary: survivor.excerpt.slice(0, 300) });
  }

  // Подстановка обязана быть заметной. Заголовок на языке источника вместо
  // перевода выглядит как работающий дайджест, и разница видна только глазами.
  if (missing.length > 0) {
    console.error(
      `  ! модель вернула ${written.length - missing.length} из ${survivors.length}; ` +
      `${missing.length} осталось без перевода (finish_reason: ${payload.choices?.[0]?.finish_reason})`,
    );
  }

  return { intro: parsed.intro ?? "", items: written };
}
