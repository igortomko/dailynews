/**
 * Карточка автора: чем он пишет и что у него заходит.
 *
 * Две части, и это главное решение здесь.
 *
 * **Голос** копируется буквально: ритм, лицо, эмодзи, длина, место ссылки.
 * **Каркас** берётся не из общих правил «как писать виральный пост», а из его
 * же постов с просмотрами выше медианы канала.
 *
 * Почему именно так — замерено 19 сентября 2026 на живом канале. Голос
 * у его удачных и неудачных постов одинаков: разговорный тон, отсутствие
 * эмодзи кроме 🔗 перед ссылкой, длина 300–700 символов — всё это есть
 * и в постах на 95 тысяч просмотров, и в постах на 35 тысяч. Отличаются
 * каркасы: цифра в первой-второй фразе, крупный игрок в подлежащем, личный
 * вердикт в конце. Значит, копирование голоса виральности не двигает вовсе,
 * и «сделать лучше» можно только каркасом — иначе мы уходим от его стиля,
 * ничего не выигрывая.
 *
 * Чего здесь нет намеренно: общих советов из интернета. Совет «добавь вопрос
 * в конце» верен в среднем и неверен для автора, который так не делает
 * никогда: пост станет заметно чужим, а прирост просмотров останется
 * гипотезой. Поэтому каркас — всегда сравнение его постов между собой.
 */
import type { RawItem, Source } from "../src/lib/types";
import { NETWORKS, type NetworkId } from "../src/lib/networks";
import { complexityAt, styleOf, type Voice } from "../src/lib/voice";
import { fetchRss, fetchTelegramFeed, fetchX } from "./fetch";
import { firstSet, resolve, type Usage } from "./digest";

export type OwnPost = {
  text: string;
  /** Просмотры или лайки — что площадка отдала. Пусто — каркас не считается. */
  views: number | null;
  at: Date | null;
  where: NetworkId;
};

export type VoiceCard = {
  /** Как он пишет. Копируется буквально. */
  voice: string[];
  /** Чем его удачные посты отличаются от средних. Применяется. */
  frame: string[];
  /** Чего у него не бывает. Запрет сильнее правила: его видно в примерах. */
  taboo: string[];
  /** Сколько постов прочитано. Меньше десяти — каркасу верить нельзя. */
  built_from: number;
  /** Откуда читали: подпись в интерфейсе обязана быть честной. */
  sources: string[];
  /** Была ли у постов статистика: без неё frame — догадка, и это видно. */
  ranked: boolean;
};

/**
 * Свежие посты моложе двух суток выбрасываются: просмотры добираются
 * примерно столько, и без этого «верхние по просмотрам» означало бы
 * «самые старые», а каркас собирался бы из возраста, а не из текста.
 */
const MATURE_MS = 48 * 3600 * 1000;

/** Меньше этого числа постов — медиану считать не на чем. */
export const MIN_FOR_FRAME = 8;

/**
 * Сколько постов и сколько символов уходит в модель.
 *
 * Потолок не ради качества, а ради цены: карточка по двадцати постам стоит
 * $0.0011, а фид блога отдаёт шестьдесят статей на десять тысяч знаков
 * каждая — это уже полтора миллиона знаков в одном запросе. Голос виден
 * и по сорока началам.
 */
const MAX_POSTS = 40;
const MAX_CHARS = 1200;

/**
 * Прочитать его собственные посты.
 *
 * Читается только то, что площадка отдаёт: публичный канал Telegram
 * и RSS блога — бесплатно, твиты — за деньги через тот же twitterapi.io,
 * которым ходит прогон. LinkedIn и Threads не отдают ничего, и у них
 * единственный путь — вставленный текст.
 *
 * Ошибка одной площадки не роняет остальные: канал могли закрыть, блог —
 * переехать, а собрать голос по тому, что ответило, всё равно можно.
 */
export async function readOwnPosts(
  channels: { network: NetworkId; handle: string | null }[],
  sample = "",
): Promise<{ posts: OwnPost[]; failed: { network: NetworkId; why: string }[] }> {
  const posts: OwnPost[] = [];
  const failed: { network: NetworkId; why: string }[] = [];

  for (const channel of channels) {
    const network = NETWORKS[channel.network];
    if (!network?.readable || !channel.handle) continue;
    try {
      posts.push(...(await readOne(channel.network, channel.handle)));
    } catch (error) {
      failed.push({
        network: channel.network,
        why: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Вставленное руками — такой же корпус, просто без статистики. Разделитель —
  // пустая строка: так их и копируют из мессенджера.
  for (const block of sample.split(/\n\s*\n/)) {
    const text = block.trim();
    if (text.length > 40) posts.push({ text, views: null, at: null, where: "blog" });
  }

  return { posts, failed };
}

async function readOne(network: NetworkId, handle: string): Promise<OwnPost[]> {
  // Синтетический источник, а не свой фетчер: у прогона уже есть разбор
  // каждой площадки вместе с проверкой адреса и отсечкой по внутренней сети.
  // Второй разбор той же разметки разошёлся бы с первым молча.
  const source = {
    id: 0,
    kind: network === "blog" ? "rss" : network,
    label: handle,
    // handle лежит уже разобранным — тем самым, что вернул discover: имя
    // канала, адрес фида, запрос `from:имя`. Прибавка `from:` оставлена
    // для вписанного руками ника: без неё запрос к X ушёл бы за постами
    // со словом «ник», а не за его собственными.
    url: network === "x" && !handle.startsWith("from:") ? `from:${handle.replace(/^@/, "")}` : handle,
    config: network === "x" ? { max_age_days: 365, max_pages: 3 } : {},
    active: true,
    input_url: null,
    last_ok_at: null,
    last_count: null,
    last_error: null,
    silent_since: null,
    deleted_at: null,
  } as Source;

  const raw: RawItem[] =
    network === "telegram"
      ? (await fetchTelegramFeed(source)).items
      : network === "x"
        ? await fetchX(source)
        : await fetchRss(source);

  return raw
    .slice(0, MAX_POSTS)
    .map((item) => ({
      // У поста в канале заголовок — это его же первая строка (так его
      // разбирает прогон), и в корпус она уехала бы дважды.
      text: (item.excerpt || item.title).slice(0, MAX_CHARS),
      views: item.views ?? item.points ?? null,
      at: item.published_at,
      where: network,
    }))
    .filter((post) => post.text.trim().length > 40);
}

/** Медиана, а не среднее: один пост, улетевший в десять раз, сдвинул бы среднее. */
export function medianViews(posts: OwnPost[]): number | null {
  const numbers = posts.map((post) => post.views).filter((v): v is number => typeof v === "number");
  if (numbers.length < MIN_FOR_FRAME) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Что уходит в модель.
 *
 * Зрелость и медиана считаются кодом, а не моделью: «выше медианы» —
 * арифметика, и просить её у модели значит платить за то, что посчитает
 * любой `sort`, и получить это иногда неправильно.
 */
export function corpusOf(posts: OwnPost[]): { text: string; ranked: boolean; used: number } {
  const now = Date.now();
  const mature = posts.filter((post) => !post.at || now - post.at.getTime() > MATURE_MS);
  const pool = (mature.length >= MIN_FOR_FRAME ? mature : posts).slice(0, MAX_POSTS);
  const median = medianViews(pool);

  const text = pool
    .map((post, index) => {
      const mark =
        median !== null && typeof post.views === "number"
          ? ` · просмотров ${post.views} (${post.views >= median ? "выше" : "ниже"} медианы ${median})`
          : "";
      return `--- пост ${index + 1}${mark}\n${post.text}`;
    })
    .join("\n\n");

  return { text, ranked: median !== null, used: pool.length };
}

const PROMPT_HEAD = `Ниже посты одного автора из его собственных каналов.

Составь его карточку автора: её дадут модели, чтобы она писала посты его голосом.

"voice" — как он пишет. 6–10 пунктов, каждый проверяемый по текстам: длина фраз,
от какого лица, обращается ли к читателю и как, эмодзи и знаки — какие именно
и в каком месте, чем открывает пост, чем закрывает, ставит ли ссылку и где,
типичная длина в символах, чего не делает никогда.

"taboo" — слова и приёмы, которых у него нет ни в одном посте, хотя у других
авторов на ту же тему они обычны. 3–6 пунктов.

Пиши пунктами, которые можно проверить по этим же текстам. «Пишет живо»
проверить нельзя, «начинает пост с подлежащего-компании» — можно.`;

const PROMPT_RANKED = `"frame" — чем его посты выше медианы отличаются от постов ниже медианы.
3–5 пунктов, каждый — сравнение, а не совет: «в верхних первая строка называет
конфликт или число, в нижних — название продукта». Если разницы не видно,
скажи это одним пунктом и не выдумывай остальные.`;

const PROMPT_UNRANKED = `"frame" — оставь пустым массивом: статистики у этих постов нет,
а каркас без неё был бы догадкой, выданной за наблюдение.`;

/**
 * Собрать карточку. Один вызов на читателя, а не на пост: карточка уходит
 * в промпт на каждое нажатие, и пересчитывать её каждый раз — это платить
 * за один и тот же ответ столько раз, сколько он нажмёт.
 */
export async function buildVoiceCard(
  posts: OwnPost[],
): Promise<{ card: VoiceCard; usage: Usage; model: string }> {
  const { baseUrl, model, apiKey } = resolve();
  const { text, ranked, used } = corpusOf(posts);
  const sources = [...new Set(posts.map((post) => post.where))];

  if (!apiKey || used === 0) {
    throw new Error(apiKey ? "нет ни одного поста, из которого брать голос" : "не задан LLM_API_KEY");
  }

  const prompt = `${PROMPT_HEAD}

${ranked ? PROMPT_RANKED : PROMPT_UNRANKED}

Посты:
${text}

Ответь только валидным JSON, без markdown:
{"voice": ["..."], "frame": ["..."], "taboo": ["..."]}`;

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      // Потолок делится с рассуждением модели, а не отводится ответу целиком.
      // На четырёх тысячах карточка не доехала вовсе: провайдер по умолчанию
      // рассуждает «высоко», весь потолок уходил на текст, которого никто
      // не увидит, и ответ приходил пустым (урок дайджеста, 32 000 на двадцать
      // описаний).
      max_tokens: 12_000,
      ...(firstSet(process.env.LLM_REASONING_EFFORT)
        ? { reasoning_effort: firstSet(process.env.LLM_REASONING_EFFORT) }
        : {}),
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const payload = await res.json();
  const answer: string = payload.choices?.[0]?.message?.content ?? "";
  // Пустой ответ и испорченный JSON — разные поломки, и лечатся они разным.
  // Пустой означает, что потолок ушёл на рассуждение модели: об этом должно
  // быть сказано словами, иначе следующий читатель кода пойдёт править разбор.
  if (!answer.trim()) {
    throw new Error(
      `модель вернула пустой ответ (обрыв: ${payload.choices?.[0]?.finish_reason}) — ` +
      `весь потолок ушёл на рассуждение, проверь LLM_REASONING_EFFORT`,
    );
  }
  const card = parseCard(answer, { built_from: used, sources, ranked });

  return {
    card,
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

/**
 * Разбор ответа.
 *
 * Пустой голос — это отказ, и он обязан быть слышен: карточка без единого
 * пункта выглядит как работающая настройка, а посты по ней пишутся ничьим
 * голосом. Поэтому пустой `voice` — ошибка, а пустой `frame` — законное
 * состояние: у постов могло не быть статистики.
 */
export function parseCard(
  answer: string,
  meta: { built_from: number; sources: string[]; ranked: boolean },
): VoiceCard {
  const cleaned = answer.replace(/```(?:json)?/g, "");
  // Незакрытая скоба — это обрыв, а не «не JSON»: закрывшиеся строки из такого
  // ответа спасаются ниже. Требовать закрывающую значило бы выбрасывать
  // карточку целиком из-за последнего недописанного пункта.
  const opens = cleaned.indexOf("{");
  if (opens < 0) throw new Error(`модель вернула не JSON: ${answer.slice(0, 200)}`);
  const json = cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned.slice(opens);

  const lines = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 12)
      : [];

  /**
   * Разбор, переживающий кривой JSON.
   *
   * Ответ — три массива строк на две с половиной тысячи знаков, и провайдер
   * то обрывает его на середине, то не экранирует кавычку внутри цитаты
   * (поймано на живом канале: JSON.parse падал на 1550-м символе). Уронить
   * из-за этого всю карточку — значит потерять и то, что доехало целым,
   * ровно как это было с дайджестом до `parseDigest`.
   *
   * Поэтому сначала обычный разбор, а на его отказе — закрывшиеся строки
   * по каждому ключу. Молчать о подмене нельзя: разбор по кусочкам работает
   * и на ответе, который стал хуже, и заметить это можно только по логу.
   */
  const salvage = (key: string): string[] => {
    const at = json.indexOf(`"${key}"`);
    if (at < 0) return [];
    const tail = json.slice(at + key.length + 2);
    const body = tail.slice(0, tail.indexOf("]") + 1 || undefined);
    return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map((match) => {
        try {
          return String(JSON.parse(`"${match[1]}"`)).trim();
        } catch {
          return match[1].trim();
        }
      })
      .filter(Boolean)
      .slice(0, 12);
  };

  let parsed: Partial<Record<"voice" | "frame" | "taboo", unknown>>;
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch (error) {
    console.error(
      `  ~ карточка автора: ответ не разобрался как JSON (${
        error instanceof Error ? error.message : error
      }), собираю из закрывшихся строк`,
    );
    parsed = { voice: salvage("voice"), frame: salvage("frame"), taboo: salvage("taboo") };
  }

  const voice = lines(parsed.voice);
  if (voice.length === 0) throw new Error("в ответе нет ни одного пункта про голос");

  return {
    voice,
    frame: meta.ranked ? lines(parsed.frame) : [],
    taboo: lines(parsed.taboo),
    built_from: meta.built_from,
    sources: meta.sources,
    ranked: meta.ranked,
  };
}

/**
 * Карточка из настроек подачи — когда читать нечего.
 *
 * Не заглушка: сложность и манера в продукте уже есть, читатель их выставил,
 * и писать пост, игнорируя их, было бы хуже. Но каркаса здесь нет и быть
 * не может, и интерфейс обязан сказать это вслух: иначе блогер прочтёт общий
 * черновик и решит, что возможность не работает.
 */
export function cardFromVoice(voice: Voice): VoiceCard {
  return {
    voice: [
      `Сложность языка (${complexityAt(voice.complexity).key} из 5): ${complexityAt(voice.complexity).instruction}`,
      `Манера: ${styleOf(voice.style).instruction}`,
      `Язык: ${voice.language}.`,
    ],
    frame: [],
    taboo: [],
    built_from: 0,
    sources: [],
    ranked: false,
  };
}

/** Блок карточки в промпте. Один и тот же для настоящей и для запасной. */
export function cardBlock(card: VoiceCard): string {
  const list = (lines: string[]) => lines.map((line) => `\n— ${line}`).join("");
  return [
    `Голос автора:${list(card.voice)}`,
    card.frame.length
      ? `Каркас его удачных постов (замечено сравнением его же постов между собой):${list(card.frame)}`
      : `Каркаса нет: постов со статистикой не набралось. Не придумывай приёмов за него —
держись голоса и общих правил выше.`,
    card.taboo.length ? `Чего у него не бывает:${list(card.taboo)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
