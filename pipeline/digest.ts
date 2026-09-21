import type { Axes } from "../src/lib/types";
import { checkLexicon, repeatsHeadline } from "./lexicon";
import { complexityAt, styleOf, DEFAULT_VOICE, type Voice } from "../src/lib/voice";
import { stripHtml } from "./fetch";

/**
 * Сколько знаков статьи уходит в промпт на материал.
 *
 * Число выбрано замером, а не на глаз. При 3500 знаках `npm run replay`
 * дал 32,1 и 26,6 против «было» 29,6 и 29,7, а выход одного из прогонов
 * распух с 3981 токена до 9056 и оборвался на 26 описаниях из 27.
 * При 1400 — 33,8 и 27,9, выход 3774–4093, ни одного обрыва.
 *
 * Композитный балл в обоих случаях лежит внутри разброса генерации
 * (AGENTS.md: около двух с половиной баллов), то есть улучшения текста
 * замер не доказывает. Устойчиво двигаются только две оси, и обе — в ту
 * сторону, ради которой всё делалось: конкретика 0,82 → 0,90–0,99
 * во всех прогонах, пересказ заголовка 0,36 → 0,26–0,33. Остальное
 * гуляет шире эффекта.
 *
 * Поэтому взято меньшее: при равном качестве оно дешевле по выходу
 * и не обрывается.
 */
const ARTICLE_CHARS = 1400;

export { DEFAULT_VOICE, type Voice };

export type Survivor = {
  id: number;
  title: string;
  excerpt: string;
  /** Текст статьи целиком, если его забрали по ссылке (pipeline/enrich.ts). */
  body?: string | null;
  url: string;
  source_label: string;
  topic_label: string;
  total: number;
  axes: Axes;
};

/**
 * Что уходит в промпт как текст материала: статья целиком, если её забрали
 * по ссылке, и только иначе — то, что дал фид.
 *
 * Раньше здесь всегда стоял excerpt, и это был потолок качества описаний,
 * которого не видно ни в одной проверке: у 32 материалов из 40 фид отдавал
 * меньше двухсот знаков, а у 19 — ничего. Конспект писался по заголовку
 * и выходил гладким пересказом самого себя. Описание длиннее собственного
 * источника было у 37 материалов из 40.
 *
 * Потолок больше прежнего, но не «вся статья»: вход тарифицируется,
 * а первых тысяч знаков хватает, чтобы сказать, что в материале.
 * Блок стоит последним в промпте и общий кэш начала запроса не рвёт.
 */
export const textFor = (s: Survivor) => {
  const full = s.body ? stripHtml(s.body) : "";
  return full.length > s.excerpt.length ? full.slice(0, ARTICLE_CHARS) : s.excerpt.slice(0, 900);
};

export type Written = {
  id: number;
  title_ru: string;
  summary: string;
};

export type Usage = {
  input: number; output: number; cached: number; reasoning: number; requests: number;
};

export type DigestResult = {
  intro: string;
  items: Written[];
  flagged?: number;
  usage: Usage;
  /**
   * Что на самом деле ушло в провайдера. Вызывающий не выводит это заново:
   * своя копия резолюции разойдётся с `resolve` на пустой строке — Actions
   * подставляет её вместо отсутствующего секрета, — и в статистику попадёт
   * модель, которая не работала. Колонка, ради которой всё и заводилось.
   */
  model: string;
  reasoningEffort: string | null;
};

/**
 * Сколько материалов уходит в модель одним запросом.
 *
 * Двадцать было рассчитано на вход в 900 знаков с материала — столько давал
 * фид. С догруженной статьёй на материал уходит вчетверо больше, и на пачке
 * в двадцать модель перестала дописывать: `finish_reason` приходил `stop`,
 * то есть она заканчивала сама, отдав 21 описание из 27. Упирается не
 * в потолок ответа (32 000 токенов не выбраны и близко), а во внимание
 * на длинном входе.
 *
 * Отказ при этом выглядит как успех: выпуск собирается, просто часть
 * заголовков остаётся на языке источника. Заметно это только глазами
 * и только если смотреть, поэтому число недописанных печатается в лог.
 */
const CHUNK = 10;

/**
 * Запретные списки есть только для языков, которые проверены глазами.
 * Для остальных уходят принципы без перечня слов: список, придуманный
 * для непроверенного языка, ловил бы не те слова и звучал бы уверенно.
 */
const BANNED: Record<string, string> = {
  русском: `— оценок вместо фактов: «важный», «ключевой», «уникальный», «прорывной», «революционный»;
— зачинов: «стоит отметить», «важно понимать», «давайте разберёмся», «в современном мире»,
  «не секрет, что»;
— ссылок на безымянных: «эксперты считают», «исследования показывают» — назови, кто именно;
— оборотов «является инструментом для», «позволяет осуществлять», «выступает в роли» —
  глагол справляется сам;
— итогов: «таким образом», «подводя итог», «в заключение»`,
  английском: `— evaluation instead of fact: "key", "pivotal", "game changer", "transformative", "robust";
— throat-clearing: "it's worth noting", "in today's fast-changing world", "here's the thing";
— weasel attribution: "experts agree", "studies show" — name who;
— padded verbs: "serves as", "acts as a catalyst", "enables the ability to" — the verb alone;
— recap endings: "ultimately", "in conclusion", "in summary"`,
  португальском: `— avaliação no lugar do fato: "fundamental", "inovador", "revolucionário", "robusto";
— aberturas vazias: "vale destacar", "é importante ressaltar", "em um mundo cada vez mais";
— atribuição vaga: "especialistas afirmam", "estudos mostram" — diga quem;
— verbos inchados: "atua como", "possibilita", "viabiliza" — o verbo sozinho;
— fechos de resumo: "em suma", "por fim", "concluindo"`,
};

/** Общие правила, когда перечня для языка нет. */
const BANNED_FALLBACK = `— оценок вместо фактов: слов вроде «важный», «прорывной», «уникальный»;
— зачинов, которые ничего не сообщают, и итогов в конце;
— ссылок на безымянных: «эксперты», «исследования» — называй, кто именно;
— раздутых глаголов там, где хватает простого`;

function bannedFor(language: string): string {
  const key = Object.keys(BANNED).find((name) => language.toLowerCase().includes(name));
  return key ? BANNED[key] : BANNED_FALLBACK;
}

function voiceRules(voice: Voice): string {
  // Печатаем зажатое деление, а не то, что пришло: иначе в промпт уходит
  // «Сложность 9 из 5» рядом с требованием для пятого — модель читает
  // противоречие там, где его нет.
  const level = complexityAt(voice.complexity);
  return [
    `Сложность языка (${level.key} из 5): ${level.instruction}`,
    `Манера: ${styleOf(voice.style).instruction}`,
  ].join("\n\n");
}

/**
 * Настройка модели живёт только в окружении. Своего ключа у читателя нет:
 * раздел убран, и ключ в базе открытым текстом вместе с ним — хранить
 * чужой секрет ради настройки, которой никто не пользовался, незачем.
 */
/**
 * Пустая строка — это «не задано», а не значение. GitHub Actions подставляет
 * пустоту вместо несуществующего секрета, и `??` её пропускает: он
 * откатывается только на null и undefined. Из-за этого адрес провайдера
 * стал пустым, и fetch получил «/chat/completions».
 */
export const firstSet = (...values: (string | undefined)[]) =>
  values.find((value) => typeof value === "string" && value.trim() !== "")?.trim();

/** Экспортируется, чтобы перевод статьи решал провайдера тем же кодом:
 *  вторая копия дефолтов разъезжается с первой молча.
 *
 *  Настройки читателя здесь нет: раздел своих ключей убран, и ключ из базы
 *  вместе с ним. Всё приходит из окружения, и это единственный источник. */
export function resolve() {
  return {
    baseUrl:
      firstSet(process.env.LLM_BASE_URL) ??
      "https://generativelanguage.googleapis.com/v1beta/openai",
    model: firstSet(process.env.LLM_MODEL) ?? "gemini-2.5-flash",
    apiKey: firstSet(process.env.LLM_API_KEY) ?? "",
    // Рассуждение тарифицируется как выход и занимало 80% ответа:
    // 12411 токенов из 15494 на шестнадцати описаниях. Значение по
    // умолчанию у провайдера — «high», то есть самое дорогое, и молча.
    // Пусто — не шлём параметр вовсе: провайдер, который его не знает,
    // отвечает 400 на весь запрос.
    reasoningEffort: firstSet(process.env.LLM_REASONING_EFFORT),
  };
}

/**
 * Дорогая модель видит только выживших — пятнадцать материалов вместо трёхсот.
 * Отбор уже сделан кодом по оценкам Jev, здесь только письмо.
 */
export async function writeDigest(
  survivors: Survivor[],
  readerContext: string,
  voice: Voice = DEFAULT_VOICE,
): Promise<DigestResult> {
  const language = voice.language || "русском";
  const { baseUrl, model, apiKey, reasoningEffort } = resolve();
  if (!apiKey) {
    // Без ключа дайджест всё равно собирается — просто исходными заголовками.
    return {
      intro: "",
      flagged: 0,
      usage: { input: 0, output: 0, cached: 0, reasoning: 0, requests: 0 },
      model,
      reasoningEffort: reasoningEffort ?? null,
      items: survivors.map((s) => ({
        id: s.id,
        title_ru: s.title,
        summary: s.excerpt.slice(0, 300),
      })),
    };
  }

  const blockOf = (list: Survivor[]) => list
    .map((s) => [
      `--- id: ${s.id}`,
      `ЗАГОЛОВОК: ${s.title}`,
      `ИСТОЧНИК: ${s.source_label} · тема: ${s.topic_label}`,
      `ТЕКСТ: ${textFor(s) || "(нет)"}`,
    ].join("\n"))
    .join("\n\n");

  const promptFor = (list: Survivor[], askIntro: boolean) => `Ниже ${list.length} материалов, уже отобранных по интересам читателя.

Для каждого дай "title_ru" — заголовок: живой, не дословный перевод.

И "summary" — текст, после которого материал можно не открывать.

Заголовок и описание делят работу. Заголовок называет, что изменилось.
Описание пишется на том же языке и начинается там, где заголовок закончил, и никогда не пересказывает
его первым предложением — читатель только что это прочёл.

    заголовок:  Антидепрессанты не перестраивают мозг: 8 700 сканов
    плохо:      Исследование почти 8 700 МРТ показало, что структурные отличия…
                (то же самое во второй раз)
    хорошо:     Структурные отличия у людей на антидепрессантах объясняются
                тяжестью состояния и возрастом, а не самими препаратами.

Не у всякого материала есть событие. Разбор, эссе, колонка не сообщают,
что случилось, — они что-то утверждают. Тогда описание несёт мысль автора,
а не пересказ того, что материал существует.

    заголовок:  Куда исчезли кнопки «Download on the App Store»
    плохо:      Значки Apple и Google были дефолтным способом перевести
                посетителя в магазин в 2010-х… С сайтов они почти пропали.
                (история значков; что утверждает автор — неизвестно)
    хорошо:     Продуктовые сайты перестали вести в магазин приложений и
                ведут прямо в веб-версию: установка стала лишним шагом,
                а не воронкой. Автор показывает это на <примерах> и
                связывает со сменой правил Apple.

Механическая проверка на пересказ: число, названное в заголовке, в первом
предложении описания не повторяется, и первое предложение не начинается тем же
подлежащим с тем же глаголом. «В Datasette 0.65.5 исправлена уязвимость» →
«В Datasette 0.65.5 устранён критический баг» — это одно и то же дважды.

Проверка на смысл: после описания читатель должен уметь пересказать мысль материала
одним предложением. Если пересказать нечего — так и напиши, коротко, и это
честнее пересказа оглавления.

Что в описании должно быть:
— первым предложением: доказательство или механизм — откуда это известно,
  за счёт чего получилось, какие числа за этим стоят. Число идёт вместе
  со смыслом, а не голым: не «705 809», а «705 809 против 2,03 млн в 1974-м»,
  иначе читатель не поймёт, рост это или падение;
— дальше: что это меняет — появилась возможность, сдвинулась цена, закрылась дверь.
  Сторону изменения называй словом: больше или меньше, дороже или дешевле,
  быстрее или медленнее. Само число стороны не показывает — «до 705 809»
  не говорит, выросло это или упало;
— в конце: связь с читателем. Связь — это то, что он может сделать, проверить
  или решить иначе: заменить инструмент, заложить другую цену, поискать у себя
  ту же ошибку, повторить чужой приём, перестать чего-то ждать. Почти в каждом
  материале из его тем такое есть — ищи, а не ищи повод не искать. Отказаться
  можно, только если материал вообще не про его работу; тогда просто закончи
  фактом, не объявляя, что связи нет.

    плохо:      …инструмент публикации данных, который может быть полезен
                читателю для анализа или внутренних дашбордов.
                (польза предположена, а не названа: делать нечего)
    плохо:      …включая компоненты стека, используемые читателем, например
                PostgreSQL, что влияет на целостность данных.
                (совпало одно слово из стека, и дальше ничего не следует)
    плохо:      самая наглядная иллюстрация демографического сжатия развитых
                экономик (красивое обобщение вместо ответа «зачем мне это»)
    хорошо:     Дыру открывал перевод строки в имени таблицы — тот же приём
                стоит проверить везде, где имя таблицы приходит из запроса.

  Читателя не называй по имени и не обращайся к нему. «Полезно читателю»,
  «ему стоит», «в его проекте» — это объявление связи, а не связь. Связь видна
  по глаголу, который читатель может применить к себе, а не по упоминанию его.

  Последняя фраза начинается с сути, а не с разгона. «Это», «эта ситуация»,
  «данный случай» в начале — пустое подлежащее: читатель только что прочёл,
  о чём речь. И не пересказывай ему его же контекст — он знает, чем занят,
  как называется его продукт и какой у него стек.

    плохо:      Эта ситуация демонстрирует, как геополитические факторы
                влияют на энергетические рынки.
    хорошо:     Демонстрирует, как геополитические факторы влияют
                на энергетические рынки.
    плохо:      Это может быть критично для <имя> при разработке систем,
                где важен контроль над логикой, например в <его продукте>.
    хорошо:     Может быть критично при разработке систем, где важен
                контроль над логикой обработки данных.

— больше одного тире на весь текст.

Единицы пишутся сокращённо: км, мин, с, кг, г, млн, тыс., %, г. для года.
«27 минут» → «27 мин», «2019 года» → «2019 г.». Прилагательное от единицы
не сокращается, а разворачивается в оборот: не «10-километровые петли»
и не «10-км петли», а «петли на 5 и 10 км».

Длина — сколько нужно, чтобы материал можно было не открывать; обычно два-четыре
предложения. Цифры из источника должны попасть в текст. Детали чужой реализации —
только если читателю с ними что-то делать.


Язык выпуска: ${language}. Заголовки и описания пишутся на нём.

Чего в нём быть не должно:
${bannedFor(language)};

${voiceRules(voice)}

${askIntro ? `И ещё "intro" — одно-два предложения обо всей подборке: что сегодня главное и есть ли
связь между материалами. Без приветствий. Связи нет — так и скажи.` : ""}

Читатель: ${readerContext}

Материалы:
${blockOf(list)}

Ответь только валидным JSON, без markdown. Каждое описание — тройка
[id, заголовок, описание], без имён полей: имена повторяются на каждом
описании и стоят как текст.
{${askIntro ? '"intro": "...", ' : ""}"items": [[<число>, "...", "..."]]}`;

  const ask = async (list: Survivor[], askIntro: boolean) => {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      // Потолок делится между рассуждением модели и самим ответом, а не
      // отводится ответу целиком. На двадцати описаниях шестнадцати тысяч
      // не хватило: finish_reason пришёл length, доехало одно описание
      // из двадцати, и дайджест внешне собрался — просто девятнадцать
      // заголовков остались на языке источника.
      max_tokens: 32000,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: promptFor(list, askIntro) }],
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

    const parsed = parseDigest(match[0]);
    return {
      parsed,
      finish: payload.choices?.[0]?.finish_reason as string | undefined,
      // Главная статья расхода — именно этот ответ, и до сих пор она
      // нигде не измерялась: в stats попадала только цена Jev, вдесятеро
      // меньшая. Цену не считаем здесь: у провайдеров она меняется
      // и зависит от часа суток, а токены — факт.
      usage: payload.usage as
        | {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_cache_hit_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
            completion_tokens_details?: { reasoning_tokens?: number };
          }
        | undefined,
    };
  };

  // Кусками, а не одной простынёй: потолок ответа делится с рассуждением
  // модели, и на двадцати описаниях шестнадцати тысяч уже не хватало.
  // При сотне новостей в дайджесте один запрос не поместится ни в какой
  // разумный потолок, а обрыв стоит целого дня. Вступление просит только
  // первый кусок: в нём лучшие по отбору, о них вступление и пишется.
  const fromModel: Written[] = [];
  let intro = "";
  let finish: string | undefined;
  const usage: Usage = { input: 0, output: 0, cached: 0, reasoning: 0, requests: 0 };
  for (let at = 0; at < survivors.length; at += CHUNK) {
    const chunk = survivors.slice(at, at + CHUNK);
    const answer = await ask(chunk, at === 0);
    fromModel.push(...(answer.parsed.items ?? []));
    if (at === 0) intro = answer.parsed.intro ?? "";
    finish = answer.finish;
    usage.input += answer.usage?.prompt_tokens ?? 0;
    usage.output += answer.usage?.completion_tokens ?? 0;
    // Имя поля у провайдеров разное: DeepSeek отдаёт prompt_cache_hit_tokens,
    // OpenAI-совместимые (Gemini в их числе) — prompt_tokens_details.cached_tokens.
    // Читать одно — получить честный ноль на другом провайдере и решить,
    // что кэш не работает.
    usage.cached +=
      answer.usage?.prompt_cache_hit_tokens ??
      answer.usage?.prompt_tokens_details?.cached_tokens ??
      0;
    // Рассуждение тарифицируется как выход и в ответ не попадает:
    // без этой строки главная статья счёта выглядит как длинный текст.
    usage.reasoning += answer.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    usage.requests++;
  }

  const { items: written, missing } = matchWritten(survivors, fromModel);

  // Подстановка обязана быть заметной. Заголовок на языке источника вместо
  // перевода выглядит как работающий дайджест, и разница видна только глазами.
  if (missing > 0) {
    console.error(
      `  ! модель перевела ${survivors.length - missing} из ${survivors.length}; ` +
      `${missing} осталось без перевода (обрыв: ${finish})`,
    );
  }

  // Словарь сообщает, но не отбрасывает: одно слово не повод лишить
  // читателя новости. Растущее число попаданий — повод чинить промпт.
  let flagged = 0;
  for (const item of written) {
    const hits = checkLexicon(`${item.title_ru} ${item.summary}`);
    const echo = repeatsHeadline(item.title_ru, item.summary);
    if (hits.length === 0 && !echo) continue;
    flagged++;
    const what = [
      ...hits.map((hit) => `«${hit.term}» (${hit.reason})`),
      ...(echo ? ["первое предложение пересказывает заголовок"] : []),
    ].join(", ");
    console.error(`  ~ ${item.title_ru.slice(0, 48)}: ${what}`);
  }
  if (flagged > 0) console.error(`  ~ помечено ${flagged} из ${written.length}`);

  return { intro, items: written, flagged, usage, model, reasoningEffort: reasoningEffort ?? null };
}

/**
 * Разбор ответа модели, переживающий обрыв.
 *
 * Ответ приходит одной простынёй JSON на двадцать описаний, и провайдер
 * иногда обрывает её на середине массива. JSON.parse тогда падает целиком,
 * и день остаётся вообще без дайджеста из-за одного недописанного куска —
 * хотя девятнадцать описаний доехали целыми.
 *
 * Поэтому на обрыве вынимаем объекты, которые закрылись. Объекты плоские
 * (id, title_ru, summary), поэтому пары скобок достаточно. Недостающие
 * материалы подставит matchWritten, и она же сообщит об этом в лог:
 * молча отдать девятнадцать вместо двадцати нельзя.
 */
export function parseDigest(json: string): { intro?: string; items?: Written[] } {
  /** Тройка [id, заголовок, описание] — то, что просит промпт. */
  const fromTriple = (row: unknown): Written | null => {
    if (!Array.isArray(row) || row.length < 3) return null;
    const [id, title, summary] = row;
    if (id === undefined || id === null) return null;
    if (typeof title !== "string" || typeof summary !== "string") return null;
    return { id: id as Written["id"], title_ru: title, summary };
  };

  const items: Written[] = [];
  try {
    const parsed = JSON.parse(json) as { intro?: string; items?: unknown[] };
    for (const row of parsed.items ?? []) {
      const item = fromTriple(row);
      if (item) items.push(item);
    }
    return { intro: parsed.intro, items };
  } catch {
    // Ответ оборван на середине массива. Спасаем закрывшиеся тройки:
    // из-за одного недописанного куска нельзя терять весь день.
    for (const chunk of json.match(/\[\s*"?\d+"?\s*,[\s\S]*?"\s*\]/g) ?? []) {
      try {
        const item = fromTriple(JSON.parse(chunk));
        if (item) items.push(item);
      } catch {
        // Обрезанная тройка пропускается: она и есть место обрыва.
      }
    }
    const intro = json.match(/"intro"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
    console.error(`  ! ответ модели оборван, спасено ${items.length} описаний`);
    return { intro: intro.replace(/\\n/g, "\n").replace(/\\"/g, '"'), items };
  }
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
