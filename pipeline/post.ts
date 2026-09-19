/**
 * Пост его голосом по одному материалу выпуска.
 *
 * Порядок блоков в промпте — часть цены, как и в дайджесте: провайдер
 * кэширует совпадающее начало запроса и берёт за него в пятьдесят раз меньше
 * ($0.003 против $0.15 за миллион). Поэтому общие правила стоят первыми,
 * карточка автора — за ними, материал — последним. Замерено: второй запрос
 * с теми же правилами и той же карточкой пришёл с 1 790 кэшированными
 * токенами из 1 924.
 *
 * Цена одного нажатия на четыре сети по два варианта — около $0.001,
 * и почти всё это выход: он тарифицируется вчетверо дороже входа.
 *
 * Два варианта, а не один текст: отличаются они первой строкой и тем, что
 * вынесено вперёд. Его выбор между ними — единственный сигнал о его вкусе,
 * который не стоит ничего, и второй вариант обходится в $0.0001.
 */
import type { Axes } from "../src/lib/types";
import { NETWORKS, overLimit, postLength, type Network, type NetworkId } from "../src/lib/networks";
import { firstSet, resolve, type Usage } from "./digest";
import { cardBlock, type VoiceCard } from "./voice-card";

export type PostSource = {
  id: number;
  /** Заголовок из выпуска: он уже переведён и уже его языком. */
  title: string;
  summary: string;
  excerpt: string;
  url: string;
  source_label: string;
  axes?: Axes;
};

export type Draft = {
  network: NetworkId;
  variant: number;
  text: string;
  /** Длина с поправкой на ссылку: в X она всегда 23 символа. */
  length: number;
  over: boolean;
  /** Числа из поста, которых нет в материале. Пусто — всё сошлось. */
  unverified: string[];
};

export type PostResult = {
  drafts: Draft[];
  /** Что модель добавила от себя — по её же признанию. */
  added: string[];
  usage: Usage;
  model: string;
};

/** Сколько вариантов на сеть. Два: третий никто не читает. */
export const VARIANTS = 2;

/**
 * Общая часть промпта. Стоит первой и не содержит ничего персонального —
 * иначе кэш провайдера рвётся у всех сразу, и одинаковые правила
 * оплачиваются заново на каждом блогере.
 *
 * Каждое правило дано с провалом рядом: показать модели ошибку надёжнее,
 * чем описать требование.
 */
const RULES = `Ты пишешь черновик поста для автора по его карточке и одному материалу.
Он опубликует это под своим именем, поэтому голос его, а факты — из материала.

Общие правила, одинаковые для всех авторов:

— голос копируется, каркас применяется. Слова, ритм, лицо, длина, эмодзи
  и место ссылки — его. Каркас говорит, что вынести в первую строку
  и где поставить главное;

— один пост — одно утверждение. Два утверждения делят внимание пополам;

— первая строка не пересказывает заголовок новости и не начинается с «вышла
  новая версия». Она называет то, что изменилось, и для кого:

    плохо:   INEOS открыла в Дании хранилище CO2
    хорошо:  Первое в ЕС коммерческое хранилище CO2 берёт 400 тыс. тонн в год —
             это меньше одного процента того, что регион обещал закапывать к 2030-му

— число из материала попадает в пост, и рядом с ним то, с чем его сравнивать.
  «до 705 809» не говорит, выросло это или упало;

— суждение автора обязательно: пересказ он мог бы и переслать. Суждение —
  это «зря они переживают» или «дойдут ли до верхней планки», а не «важная
  новость для отрасли»;

— ничего, чего нет в материале. Ни цифр, ни сравнений, ни примеров, ни имён.
  Сравнение, звучащее правдоподобно, — самая частая выдумка:

    нельзя:  400 тыс. тонн — это меньше, чем выбрасывает небольшой цементный завод
             (в материале этого нет; под его именем это будет его ошибкой)
    можно:   400 тыс. тонн на старте против заявленных 4–8 млн (оба числа из материала)

— не добавляй приёмов, которых у него нет: «это меняет всё», «тред»,
  «сохрани, чтобы не потерять», призыв подписаться, вопрос в конце ради
  комментариев. Если он сам так делает — делай;

— ссылку ставь там, где её ставит он.

Вариантов на каждую сеть — два. Они отличаются первой строкой и тем, что
вынесено вперёд; факты и вердикт в них одни и те же. Два варианта одного
и того же текста с переставленными словами — это один вариант.

Отдельным полем "added" — только то, чего в материале нет: твои сравнения,
оценки масштаба, контекст из общих знаний. Каждое пунктом до восьми слов
(«сравнение с цементным заводом», «оценка доли рынка»). Что взято из материала,
перечислять не надо — это поле читает автор перед публикацией, чтобы знать,
что проверить, а не отчёт о проделанной работе. Нечего назвать — пустой массив.`;

const blockOf = (item: PostSource) =>
  [
    `ЗАГОЛОВОК: ${item.title}`,
    `О ЧЁМ: ${item.summary}`,
    `ТЕКСТ ИСТОЧНИКА: ${item.excerpt.slice(0, 1200) || "(нет)"}`,
    `ИЗДАНИЕ: ${item.source_label}`,
    `ССЫЛКА: ${item.url}`,
  ].join("\n");

export function promptFor(item: PostSource, card: VoiceCard, networks: Network[]): string {
  const shape = networks.map((network) => `"${network.id}": ["вариант 1", "вариант 2"]`).join(", ");
  return `${RULES}

Требования сетей:
${networks.map((network) => `— ${network.rule}`).join("\n")}

${cardBlock(card)}

Материал:
${blockOf(item)}

Ответь только валидным JSON, без markdown:
{${shape}, "added": ["..."]}`;
}

/**
 * Числа, которых нет в материале.
 *
 * Механическая проверка без модели: у поста под чужим именем самая дорогая
 * ошибка — правдоподобная выдумка, а запрет в промпте на неё протекает
 * (проверено: первый же черновик добавил сравнение с цементным заводом).
 *
 * Сверка нарочно снисходительная: цифры сравниваются как последовательности
 * без разделителей, поэтому «400 тыс.» находится в «400,000». Строгая ловила
 * бы каждый пост, и через неделю на предупреждение перестали бы смотреть —
 * а это то же самое, что его не показывать.
 */
export function unverifiedNumbers(text: string, source: string): string[] {
  const digitsOf = (value: string) => value.replace(/[\s .,]/g, "");
  const haystack = digitsOf(source);
  const found = new Set<string>();

  for (const match of text.matchAll(/\d[\d\s .,]*\d|\d/g)) {
    const raw = match[0].trim().replace(/[.,]$/, "");
    const digits = digitsOf(raw);
    // Однозначное число и год ловить незачем. Год автор пишет от себя
    // («в этом году», «в 2026-м»), в материале его часто нет вовсе, и каждое
    // такое срабатывание — ложная тревога. Тревога, горящая на каждом посте,
    // ничем не отличается от выключенной.
    if (digits.length < 2) continue;
    const asYear = Number(digits);
    if (digits.length === 4 && asYear >= 1900 && asYear <= 2100) continue;
    if (haystack.includes(digits)) continue;
    // Составное число вида «4–8» приходит половинами; проверяем и их.
    if (raw.split(/[^\d]+/).every((part) => part.length < 2 || haystack.includes(part))) continue;
    found.add(raw);
  }
  return [...found];
}

/** Разбор ответа: сети, варианты, длина, выдуманные числа. */
export function parseDrafts(
  answer: string,
  item: PostSource,
  networks: Network[],
): { drafts: Draft[]; added: string[] } {
  const json = answer.replace(/```(?:json)?/g, "").match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error(`модель вернула не JSON: ${answer.slice(0, 200)}`);
  const parsed = JSON.parse(json) as Record<string, unknown>;

  const source = [item.title, item.summary, item.excerpt].join(" ");
  const drafts: Draft[] = [];

  for (const network of networks) {
    const value = parsed[network.id];
    // Одна строка вместо массива — законный ответ модели на «дай два»:
    // вариант один, и это лучше, чем уронить всё нажатие.
    const texts = (Array.isArray(value) ? value : [value])
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .slice(0, VARIANTS);

    for (const [index, text] of texts.entries()) {
      drafts.push({
        network: network.id,
        variant: index + 1,
        text,
        length: postLength(network, text),
        over: overLimit(network, text),
        unverified: unverifiedNumbers(text, source),
      });
    }
  }

  // Пять пунктов и по сто знаков в каждом: красная простыня на пол-экрана
  // читается ровно один раз, а потом её перестают замечать вместе с тем
  // единственным пунктом, ради которого она есть.
  const added = Array.isArray(parsed.added)
    ? parsed.added
        .map((entry) => String(entry).trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  return { drafts, added };
}

export async function writePost(
  item: PostSource,
  card: VoiceCard,
  networkIds: NetworkId[],
): Promise<PostResult> {
  const { baseUrl, model, apiKey } = resolve();
  if (!apiKey) throw new Error("не задан LLM_API_KEY");

  const networks = networkIds.map((id) => NETWORKS[id]).filter(Boolean);
  if (networks.length === 0) throw new Error("не выбрана ни одна сеть");

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      // Четыре сети по два варианта — около двух тысяч токенов выхода.
      // Потолок делится с рассуждением модели, поэтому впятеро выше нужного:
      // при включённом рассуждении четырёх тысяч не хватало на ответ вовсе.
      max_tokens: 12_000,
      ...(firstSet(process.env.LLM_REASONING_EFFORT)
        ? { reasoning_effort: firstSet(process.env.LLM_REASONING_EFFORT) }
        : {}),
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: promptFor(item, card, networks) }],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const payload = await res.json();
  const answer: string = payload.choices?.[0]?.message?.content ?? "";
  if (!answer.trim()) {
    throw new Error(
      `модель вернула пустой ответ (обрыв: ${payload.choices?.[0]?.finish_reason}) — ` +
      `весь потолок ушёл на рассуждение, проверь LLM_REASONING_EFFORT`,
    );
  }
  const { drafts, added } = parseDrafts(answer, item, networks);
  if (drafts.length === 0) {
    throw new Error(`модель не дала ни одного текста (обрыв: ${payload.choices?.[0]?.finish_reason})`);
  }

  return {
    drafts,
    added,
    model,
    usage: {
      input: payload.usage?.prompt_tokens ?? 0,
      output: payload.usage?.completion_tokens ?? 0,
      cached:
        payload.usage?.prompt_cache_hit_tokens ??
        payload.usage?.prompt_tokens_details?.cached_tokens ??
        0,
      reasoning: payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      requests: 1,
    },
  };
}
