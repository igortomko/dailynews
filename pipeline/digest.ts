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
  const { items: written, missing } = matchWritten(survivors, parsed.items ?? []);

  // Подстановка обязана быть заметной. Заголовок на языке источника вместо
  // перевода выглядит как работающий дайджест, и разница видна только глазами.
  if (missing > 0) {
    console.error(
      `  ! модель перевела ${survivors.length - missing} из ${survivors.length}; ` +
      `${missing} осталось без перевода (обрыв: ${payload.choices?.[0]?.finish_reason})`,
    );
  }

  return { intro: parsed.intro ?? "", items: written };
}

/**
 * Сопоставляет ответ модели с отобранными материалами.
 *
 * Вынесено отдельно и без сети, потому что ломалось дважды: драйвер отдаёт
 * bigint строкой, модель возвращает id числом, и строгое сравнение не
 * совпадает ни разу. Оба раза это выглядело как плохой перевод, а не как
 * ошибка сопоставления — заголовок на языке источника внешне неотличим от
 * работающего дайджеста.
 */
export function matchWritten(
  survivors: Pick<Survivor, "id" | "title" | "excerpt">[],
  fromModel: Written[],
): { items: Written[]; missing: number } {
  const byId = new Map(survivors.map((s) => [Number(s.id), s]));
  const items: Written[] = [];
  const seen = new Set<number>();

  for (const item of fromModel) {
    const id = Number(item.id);
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, title_ru: item.title_ru, summary: item.summary });
  }

  for (const [id, survivor] of byId) {
    if (seen.has(id)) continue;
    items.push({ id, title_ru: survivor.title, summary: survivor.excerpt.slice(0, 300) });
  }

  return { items, missing: byId.size - seen.size };
}
