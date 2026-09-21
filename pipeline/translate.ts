import { budgetedFetch } from "./model-budget";
/**
 * Перевод статьи целиком, кусками, с проверкой на молчаливое сокращение.
 *
 * Главный отказ здесь тот же, что у дайджеста: модель получает длинный
 * текст и возвращает пересказ вместо перевода. Книга приходит, текст
 * на русском, абзацы на месте — просто их вдвое меньше, и заметить это
 * можно только сверив с оригиналом. Поэтому куски небольшие, а на выходе
 * считаются блоки и длина.
 */
import { resolve, type Usage } from "./digest";

/** Больше — меньше запросов, но выше шанс, что потолок ответа делится
 *  с рассуждением модели и ответ оборвётся. Шесть тысяч знаков — это
 *  примерно полторы тысячи слов, полстатьи среднего лонгрида. */
const CHUNK_CHARS = 6000;

/**
 * Ниже этой доли от исходника ответ считается пересказом, а не переводом.
 * Русский длиннее английского процентов на десять-пятнадцать, поэтому
 * честный перевод почти никогда не короче оригинала. Шесть десятых —
 * запас на языки, где бывает наоборот.
 */
const MIN_RATIO = 0.6;

const isCode = (block: string) => /^(```|~~~|    \S|\t)/.test(block);

/**
 * Текст уже на языке читателя — переводить нечего.
 *
 * Проверка грубая и намеренно такая: она закрывает случай, который правда
 * случается (русский читатель, русский источник в ленте), и ничего
 * не делает в остальных. Тонкое определение языка здесь стоило бы дороже
 * той статьи, ради которой заводится.
 */
export function alreadyIn(text: string, language: string): boolean {
  if (!/рус/i.test(language)) return false;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return false;
  const cyrillic = text.match(/[\u0400-\u04FF]/g)?.length ?? 0;
  return cyrillic / letters > 0.5;
}

/**
 * Разбиение по пустой строке: так markdown и устроен, и так блок
 * остаётся блоком — заголовок не слипается со следующим абзацем.
 *
 * Отступ слева сохраняется. Общий trim выглядел безобиднее, но съедал
 * те самые четыре пробела, по которым узнаётся листинг с отступом:
 * ветка про код в isCode не срабатывала никогда, и такой листинг
 * молча уезжал в перевод.
 */
export function splitBlocks(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+$/, ""))
    .filter((block) => block.trim() !== "");
}

/** Куски по несколько блоков: перевод по одному абзацу теряет связность,
 *  а одной простынёй обрывается. */
export function chunkBlocks(blocks: string[], limit = CHUNK_CHARS): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;

  for (const block of blocks) {
    if (current.length > 0 && size + block.length > limit) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += block.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const SEPARATOR = "\n<<<§>>>\n";

function promptFor(blocks: string[], language: string): string {
  return `Переведи текст статьи на ${language}. Это перевод, а не пересказ:
каждый блок на входе даёт ровно один блок на выходе, той же длины и с тем же
содержанием. Ничего не выбрасывай и ничего не добавляй от себя.

Что сохранить как есть:
— разметку markdown: заголовки, списки, цитаты, ссылки, выделение;
— код внутри \`обратных кавычек\` и имена функций, флагов, файлов;
— названия продуктов, компаний и стандартов: C++26, Cloudflare, WebAssembly;
— числа и единицы.

Пример провала: на входе абзац в шесть предложений про то, как менялось
поведение компилятора, на выходе одно предложение «компилятор стал вести
себя иначе». Это пересказ, он не годится.

Второй пример провала: заголовок «## Why this matters» превратился
в «## Почему это важно для разработчиков». Дописывать нельзя даже то,
что кажется уместным.

Блоки разделены строкой ${SEPARATOR.trim()}. Ответь переведёнными блоками
через тот же разделитель, в том же порядке, без нумерации и без пояснений.

${blocks.join(SEPARATOR)}`;
}

type Resolved = ReturnType<typeof resolve>;

async function ask(prompt: string, config: Resolved, usage: Usage, readerId?: number): Promise<string> {
  const res = await budgetedFetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 32000,
      // Рассуждение выключено намеренно, и это самая крупная экономия
      // здесь. Оно тарифицируется как выход, а у дайджеста занимало 80%
      // ответа — 12411 токенов из 15494. Дайджесту есть что обдумывать:
      // что важно, как связать. Переводу нечего: соответствие исходнику
      // и есть вся задача. Значение по умолчанию у провайдеров — «high»,
      // то есть самое дорогое, и молча.
      reasoning_effort: "none",
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(300_000),
  }, readerId, "translate");
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const payload = await res.json();
  usage.requests += 1;
  usage.input += payload.usage?.prompt_tokens ?? 0;
  usage.output += payload.usage?.completion_tokens ?? 0;
  usage.cached += payload.usage?.prompt_cache_hit_tokens ?? payload.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  usage.reasoning += payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

  // Обрыв по потолку — это не «почти получилось», а испорченный кусок:
  // последний блок оборван на середине предложения.
  if (payload.choices?.[0]?.finish_reason === "length") {
    throw new Error("ответ оборван по потолку токенов");
  }
  return String(payload.choices?.[0]?.message?.content ?? "").trim();
}

export type Translated = { markdown: string; usage: Usage; model: string };

/** Почему кусок забракован. Пустая строка — всё в порядке. */
export function chunkProblem(source: string[], translated: string[]): string {
  if (translated.length !== source.length) {
    return `блоков ${translated.length} вместо ${source.length}`;
  }
  const from = source.join("").length;
  const to = translated.join("").length;
  if (to < from * MIN_RATIO) {
    return `короче оригинала: ${to} знаков против ${from}`;
  }
  return "";
}

/**
 * Перевести статью. Бросает, если кусок не удалось перевести дважды:
 * половина статьи на русском, половина на английском — это отказ,
 * который выглядит как успех, и молчать о нём нельзя.
 */
export async function translateArticle(
  markdown: string,
  language: string,
  readerId?: number,
): Promise<Translated> {
  const resolved = resolve();
  if (!resolved.apiKey) throw new Error("нет ключа модели: переводить нечем");

  const usage: Usage = { input: 0, output: 0, cached: 0, reasoning: 0, requests: 0 };

  // Ноль запросов и ноль денег там, где переводить нечего. Без этого
  // русская статья из русского источника уходила в модель, возвращалась
  // почти собой же и стоила ровно столько же, сколько настоящий перевод.
  if (alreadyIn(markdown, language)) {
    return { markdown, usage, model: resolved.model };
  }

  const blocks = splitBlocks(markdown);
  const out: string[] = [];

  for (const chunk of chunkBlocks(blocks)) {
    // Код не переводится: внутри него любая правка — это поломка.
    // Куски целиком из кода уходят мимо модели и заодно даром.
    const payload = chunk.filter((block) => !isCode(block));
    if (payload.length === 0) {
      out.push(...chunk);
      continue;
    }

    let done: string[] | null = null;
    let problem = "";

    // Внутри try, а не снаружи: таймаут, сетевая ошибка и обрыв по потолку
    // должны тратить попытку, а не отменять перевод целиком. Раньше
    // комментарий обещал две попытки, а любое исключение из ask()
    // улетало мимо цикла и роняло всю статью с первой же икоты.
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      try {
        const answer = await ask(promptFor(payload, language), resolved, usage, readerId);
        const parts = answer.split(SEPARATOR.trim()).map((p) => p.trim()).filter(Boolean);
        problem = chunkProblem(payload, parts);
        if (!problem) done = parts;
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
      if (!done) {
        console.error(`  ! кусок не перевёлся (${problem}), попытка ${attempt + 1} из 2`);
      }
    }

    if (!done) throw new Error(`кусок не перевёлся: ${problem}`);

    // Код возвращается на своё место: порядок блоков внутри куска обязан
    // совпадать с исходным, иначе листинг уедет в середину чужого абзаца.
    let at = 0;
    for (const block of chunk) out.push(isCode(block) ? block : done[at++]);
  }

  return { markdown: out.join("\n\n"), usage, model: resolved.model };
}
