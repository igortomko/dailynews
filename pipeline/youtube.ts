/**
 * Что сказано в ролике — без просмотра.
 *
 * Фид YouTube отдаёт заголовок и описание, а содержания в нём нет: оценка
 * и дайджест писались по одной строке, и выглядело это как обычный материал
 * с коротким текстом. Здесь берётся расшифровка (субтитры, чаще всего
 * автоматические) и сжимается в две вещи разом: конспект для ленты
 * и пересказ для читалки. Один вызов на ролик, общий для всех читателей —
 * как и оценка Jev: содержание ролика не зависит от того, кто читает.
 *
 * **Субтитры отдаются только жилым адресам.** С VPS и с раннера GitHub
 * YouTube отвечает «Sign in to confirm you're not a bot» на любой клиент —
 * проверено на обоих. Лечится исходящим каналом: `YT_PROXY` указывает
 * на прокси Cloudflare WARP, который прогон поднимает контейнером рядом
 * (`.github/workflows/digest.yml`). Без переменной запрос идёт напрямую —
 * так работает ручной прогон с домашней машины.
 *
 * Отказ здесь ничего не роняет: материал остаётся с описанием из фида,
 * а прогон называет причину вслух. Молчаливое падение на описание было бы
 * ровно той поломкой, ради которой всё это затевалось.
 */
import { XMLParser } from "fast-xml-parser";
import { ProxyAgent } from "undici";
import { marked } from "marked";
import { stripHtml } from "./fetch";
import { resolve, type Usage } from "./digest";

/** Клиент, которому YouTube отдаёт дорожки субтитров без аттестации.
 *  Веб-клиент требует PO-токен и отвечает UNPLAYABLE, андроидный — 400. */
const CLIENT = {
  clientName: "IOS",
  clientVersion: "20.03.02",
  userAgent: "com.google.ios.youtube/20.03.02 (iPhone16,2; U; CPU iOS 18_2_1 like Mac OS X;)",
};

/** Час речи — это около 60 тысяч знаков. Дальше режем: лекция на три часа
 *  стоила бы втрое дороже ради того же конспекта. */
const MAX_TRANSCRIPT = 60_000;

/** Сколько роликов расшифровываем за один прогон. Потолок нужен не скорости,
 *  а счёту: добавить десять каналов — минутное дело, и каждый новый ролик
 *  это отдельный вызов модели. */
export const MAX_VIDEOS_PER_RUN = 40;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });

/** Прокси берётся из окружения на каждый запрос, а не один раз при загрузке
 *  модуля: тесты и сухой прогон задают его сами. */
function dispatcher() {
  const proxy = process.env.YT_PROXY?.trim();
  return proxy ? { dispatcher: new ProxyAgent(proxy) } : {};
}

/**
 * Номер ролика из адреса. Три формы: `watch?v=`, `youtu.be/<id>`
 * и `/shorts/<id>` — короткие метражи приходят тем же фидом, что и обычные.
 */
export function videoIdOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const valid = (id: string | undefined) => (id && /^[\w-]{11}$/.test(id) ? id : null);

  if (host === "youtu.be") return valid(parsed.pathname.slice(1).split("/")[0]);
  if (host !== "youtube.com" && host !== "m.youtube.com") return null;

  const path = parsed.pathname.split("/").filter(Boolean);
  if (path[0] === "shorts" || path[0] === "live" || path[0] === "embed") return valid(path[1]);
  return valid(parsed.searchParams.get("v") ?? undefined);
}

type CaptionTrack = { baseUrl: string; languageCode?: string; kind?: string };

export type Tracklist = {
  captionTracks?: CaptionTrack[];
  audioTracks?: { defaultCaptionTrackIndex?: number }[];
  defaultAudioTrackIndex?: number;
};

/**
 * Дорожка субтитров, которую стоит читать.
 *
 * Сперва — та, что отвечает звуку ролика: у популярных каналов переводы
 * лежат в том же списке, что и оригинал, и «первая человеческая» выбирала
 * арабскую у английской лекции. Конспект выходил арабским, ошибок при этом
 * не было ни одной. Оригинал YouTube помечает не в самой дорожке, а через
 * основную аудиодорожку — `audioTracks[defaultAudioTrackIndex]`.
 *
 * Пометки нет (ролик без переводов) — берём написанную человеком, иначе
 * машинную: она хуже в именах и числах, но это всё, что есть.
 */
export function pickTrack(list: Tracklist): CaptionTrack | null {
  const tracks = list.captionTracks ?? [];
  const index = list.audioTracks?.[list.defaultAudioTrackIndex ?? 0]?.defaultCaptionTrackIndex;
  if (typeof index === "number" && tracks[index]) return tracks[index];
  return tracks.find((t) => t.kind !== "asr") ?? tracks[0] ?? null;
}

/** Разбор ответа timedtext: `<transcript><text start dur>…`. Реплики
 *  склеиваются пробелом, пометки звукорежиссёра («[Music]») выбрасываются —
 *  в конспекте от них нет ничего, а в счёте они есть. */
export function parseTimedText(xml: string): string {
  const doc = parser.parse(xml) as { transcript?: { text?: unknown } };
  const nodes = doc?.transcript?.text;
  const list = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];

  return list
    .map((node) => {
      const raw = typeof node === "object" && node !== null
        ? String((node as Record<string, unknown>)["#text"] ?? "")
        : String(node ?? "");
      // Сущности в ответе двойные: «&amp;gt;&amp;gt;» — разметка диктора.
      return stripHtml(stripHtml(raw));
    })
    .join(" ")
    .replace(/\[[^\]]{0,40}\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TRANSCRIPT);
}

/**
 * Расшифровка ролика. Возвращает null, когда субтитров у ролика нет вовсе,
 * и бросает, когда YouTube не отдал их нам — это разные вещи: первое
 * нормально и часто, второе означает, что канал заблокирован и чинить
 * надо прокси.
 */
export async function fetchTranscript(videoId: string): Promise<{ text: string; lang: string } | null> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": CLIENT.userAgent },
    body: JSON.stringify({
      videoId,
      context: { client: { clientName: CLIENT.clientName, clientVersion: CLIENT.clientVersion, hl: "en", gl: "US" } },
    }),
    signal: AbortSignal.timeout(30_000),
    ...dispatcher(),
  });
  if (!res.ok) throw new Error(`player HTTP ${res.status}`);

  const payload = (await res.json()) as {
    playabilityStatus?: { status?: string; reason?: string };
    captions?: { playerCaptionsTracklistRenderer?: Tracklist };
  };

  const status = payload.playabilityStatus?.status;
  if (status && status !== "OK") {
    // LOGIN_REQUIRED на датацентровом адресе — не «ролик недоступен»,
    // а «нас приняли за робота». Разница важная: первое чинить нечем,
    // второе чинится исходящим каналом.
    throw new Error(`${status}: ${payload.playabilityStatus?.reason ?? "без причины"}`);
  }

  const track = pickTrack(payload.captions?.playerCaptionsTracklistRenderer ?? {});
  if (!track?.baseUrl) return null;

  // Адрес приходит из чужого ответа: без проверки хоста он уводит куда угодно,
  // в том числе внутрь сети общей машины.
  const url = new URL(track.baseUrl);
  if (url.hostname !== "www.youtube.com") throw new Error(`дорожка ведёт на ${url.hostname}`);

  const captions = await fetch(url, {
    headers: { "user-agent": CLIENT.userAgent },
    signal: AbortSignal.timeout(30_000),
    ...dispatcher(),
  });
  if (!captions.ok) throw new Error(`timedtext HTTP ${captions.status}`);

  const text = parseTimedText(await captions.text());
  return text ? { text, lang: track.languageCode ?? "" } : null;
}

export type VideoWriteup = {
  /** Для ленты: что в ролике сказано. Ложится в `items.excerpt` — оттуда
   *  его читают и Jev, и дайджест. */
  summary: string;
  /** Для читалки: пересказ целиком, разметкой. Ложится в `items.body`,
   *  где его ждёт тот же путь, что и полный текст статьи из фида. */
  article: string;
  model: string;
  usage: Usage;
};

const prompt = (title: string, channel: string, transcript: string, lang: string) =>
  `Ниже расшифровка ролика «${title}» с канала ${channel}.

Расшифровка машинная: знаки препинания расставлены наугад, имена и термины
бывают услышаны неверно, повторы и оговорки остались как есть. Читай её
как речь, а не как текст, и восстанавливай смысл, а не буквы.

Ответь JSON: {"summary": "...", "article": "..."}

"summary" — что в ролике сказано. Не о чём он и не чему посвящён, а что
именно в нём утверждается: вывод, числа, на чём вывод держится. Читатель
решает по этому тексту, смотреть ли ролик, поэтому пересказ вступления —
худший из возможных ответов. Три-четыре предложения, не длиннее 800 знаков.

    плохо:   Автор разбирает диаграмму Смита и объясняет, почему она пугает
             студентов. Показан большой печатный экземпляр.
    хорошо:  Диаграмма Смита — это график комплексного сопротивления,
             свёрнутый так, что бесконечная плоскость помещается в круг.
             Пугает она не математикой, а тем, что ей учат до того,
             как объяснят, зачем сворачивать.

"article" — пересказ для чтения вместо ролика: разделы по смыслу, каждое
утверждение со своим основанием, числа и имена из расшифровки сохранены.
Не конспект по пунктам и не стенограмма — связный текст, по которому видно
ход мысли автора. Разметка markdown, подзаголовки уровня ##. Длина по
содержанию: короткий ролик — несколько абзацев, лекция — несколько страниц.
Чего в расшифровке нет, того не придумывай; неразборчивое место пропусти,
а не угадай.

Оба текста пиши на языке расшифровки${lang ? ` (код языка: ${lang})` : ""}, а не на языке
этой инструкции: конспект общий для всех читателей, и каждому его переведёт
его же дайджест. Перевод перевода теряет числа и имена.

Ни «в этом видео», ни «автор говорит, что»: пиши утверждения прямо, будто
это статья на ту же тему.

Расшифровка:
${transcript}`;

/** Сжать расшифровку. Один вызов на ролик, два текста в ответе: вход тут
 *  дорогой (расшифровка целиком), и платить за него дважды незачем. */
/**
 * Разбор ответа модели. Отдельно от запроса, потому что проверяется тестом:
 * пустой пересказ — не исключение, а частый случай, и распознавать его надо
 * по содержимому, а не по тому, упал запрос или нет.
 */
export function parseWriteup(text: string, fallbackModel: string, payload: {
  model?: string;
  usage?: Record<string, unknown>;
} = {}): VideoWriteup {
  const match = text.replace(/```(?:json)?/g, "").match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`модель вернула не JSON: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(match[0]) as { summary?: unknown; article?: unknown };
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const article = typeof parsed.article === "string" ? parsed.article.trim() : "";
  if (!summary) throw new Error("в ответе нет summary");

  const usage = (payload.usage ?? {}) as Record<string, any>;
  return {
    summary: summary.slice(0, 1200),
    article,
    model: payload.model ?? fallbackModel,
    usage: {
      input: usage.prompt_tokens ?? 0,
      output: usage.completion_tokens ?? 0,
      cached: usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0,
      reasoning: usage.completion_tokens_details?.reasoning_tokens ?? 0,
      requests: 1,
    },
  };
}

/** Сложить расход двух попыток: платим за обе, и в журнале это одна строка. */
const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cached: a.cached + b.cached,
  reasoning: a.reasoning + b.reasoning,
  requests: a.requests + b.requests,
});

export async function describeVideo(
  title: string,
  channel: string,
  transcript: string,
  lang = "",
): Promise<VideoWriteup> {
  const { baseUrl, model, apiKey } = resolve();
  if (!apiKey) throw new Error("нет LLM_API_KEY");

  const ask = async (): Promise<VideoWriteup> => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        // Выключено по замеру, а не по вере: на восемнадцати тысячах знаков
        // расшифровки рассуждение съело 6709 токенов выхода из 8500 и дало
        // тот же конспект — 37 секунд и $0.0030 против 8 секунд и $0.0010.
        // Обдумывать здесь нечего: что сказано в ролике, в расшифровке
        // уже написано, работа — сжать, а не решить.
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt(title, channel, transcript, lang) }],
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const payload = await res.json();
    return parseWriteup(payload.choices?.[0]?.message?.content ?? "", model, payload);
  };

  const first = await ask();
  if (first.article) return first;

  // Пересказ теряется не из-за ролика, а из-за модели: на одной и той же
  // расшифровке в 5415 знаков первый ответ дал 236 токенов выхода и только
  // конспект, второй — 950 токенов и пересказ на 2365 знаков. Отказ при этом
  // выглядел успехом: лента получала описание, а книга уходила качать
  // страницу ролика, где текста нет вовсе.
  console.error(`  ~ ролик «${title.slice(0, 40)}»: пересказ не пришёл, спрашиваю второй раз`);
  const second = await ask().catch(() => null);
  if (!second) return first;

  const usage = addUsage(first.usage, second.usage);
  if (!second.article) {
    console.error(`  ~ ролик «${title.slice(0, 40)}»: пересказа нет и со второго раза — в ленту пойдёт только конспект`);
    return { ...second, usage };
  }
  return { ...second, usage };
}

/**
 * Разметка для читалки. Пересказ приходит из модели markdown'ом, а `body`
 * читает тот же разбор, что и полный текст статьи из фида, — он ждёт HTML.
 * Положишь markdown как есть — defuddle не найдёт в нём ни одного абзаца
 * и отправка статьи пойдёт качать страницу ролика, где текста нет вовсе.
 */
export const articleHtml = (markdown: string) =>
  markdown ? `<article>${marked.parse(markdown, { async: false })}</article>` : "";
