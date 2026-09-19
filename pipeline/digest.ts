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

export type LlmConfig = { base_url?: string; model?: string; api_key?: string };

/**
 * Окружение старше настройки в базе: ключ, заданный переменной, не должен
 * молча подменяться тем, что кто-то вписал в интерфейсе.
 */
function resolve(config: LlmConfig) {
  return {
    baseUrl: process.env.LLM_BASE_URL ?? config.base_url ?? "https://generativelanguage.googleapis.com/v1beta/openai",
    model: process.env.LLM_MODEL ?? config.model ?? "gemini-2.5-flash",
    apiKey: process.env.LLM_API_KEY ?? config.api_key ?? "",
  };
}

/**
 * Дорогая модель видит только выживших — пятнадцать материалов вместо трёхсот.
 * Отбор уже сделан кодом по оценкам Jev, здесь только письмо.
 */
export async function writeDigest(
  survivors: Survivor[],
  readerContext: string,
  config: LlmConfig = {},
): Promise<DigestResult> {
  const { baseUrl, model, apiKey } = resolve(config);
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

Ниже ${survivors.length} материалов, уже отобранных по интересам читателя.

Для каждого дай "title_ru" — заголовок по-русски: живой, не дословный перевод.

И "summary" — текст, после которого материал можно не открывать.

Заголовок и описание делят работу. Заголовок называет, что изменилось.
Описание начинается там, где заголовок закончил, и никогда не пересказывает
его первым предложением — читатель только что это прочёл.

    заголовок:  Антидепрессанты не перестраивают мозг: 8 700 сканов
    плохо:      Исследование почти 8 700 МРТ показало, что структурные отличия…
                (то же самое во второй раз)
    хорошо:     Структурные отличия у людей на антидепрессантах объясняются
                тяжестью состояния и возрастом, а не самими препаратами.

Что в описании должно быть:
— первым предложением: доказательство или механизм — откуда это известно,
  за счёт чего получилось, какие числа за этим стоят. Число идёт вместе
  со смыслом, а не голым: не «705 809», а «705 809 против 2,03 млн в 1974-м»,
  иначе читатель не поймёт, рост это или падение;
— дальше: что это меняет — появилась возможность, сдвинулась цена, закрылась дверь;
— в конце: чем это касается читателя. Только если связь настоящая: нет связи —
  закончи фактом, выдумывать не надо. Обобщение вместо связи не годится:
  «самая наглядная иллюстрация демографического сжатия развитых экономик» —
  это красивые слова, а не ответ, зачем читателю эта новость.

Чего в нём быть не должно:
— оценок вместо фактов: «важный», «ключевой», «уникальный», «прорывной», «революционный»;
— зачинов: «стоит отметить», «важно понимать», «давайте разберёмся», «в современном мире»,
  «не секрет, что»;
— ссылок на безымянных: «эксперты считают», «исследования показывают» — назови, кто именно;
— оборотов «является инструментом для», «позволяет осуществлять», «выступает в роли» —
  глагол справляется сам;
— больше одного тире на весь текст;
— итогов: «таким образом», «подводя итог», «в заключение».

Длина — сколько нужно, чтобы материал можно было не открывать; обычно два-четыре
предложения. Цифры из источника должны попасть в текст. Детали чужой реализации —
только если читателю с ними что-то делать.

И ещё "intro" — одно-два предложения обо всей подборке: что сегодня главное и есть ли
связь между материалами. Без приветствий. Связи нет — так и скажи.

Материалы:
${block}

Ответь только валидным JSON, без markdown:
{"intro": "...", "items": [{"id": <число>, "title_ru": "...", "summary": "..."}]}`;

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
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
