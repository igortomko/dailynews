/**
 * Озвучка статьи.
 *
 * Озвучивается перевод, а не оригинал: он уже лежит в `item_translations`
 * по паре «материал + язык», и той же парой ключуется аудио. Двум
 * читателям на одном языке статья звучит одинаково — озвучивать её
 * дважды значит платить за один и тот же ответ столько раз, сколько
 * у ленты людей, ровно как с оценкой в первых двух каскадах.
 *
 * Хранилища своего нет и не будет: готовый mp3 уходит в Telegram, а назад
 * берётся `file_id`. Переотправка по нему мгновенна и ничего не весит.
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { sql } from "../src/lib/db";
import {
  applySpoken, audioBlocker, chunks, estimateSeconds, latinRuns, NON_LATIN,
  spokenMap, unknownRuns, voiceFor, voiceForText, type AudioErrors,
} from "../src/lib/speech";
import { sendAudio } from "../src/lib/telegram";
import { itemForReader, recordCall } from "../src/lib/readers";
import { SOURCE_LANGUAGE } from "../src/lib/voice";
import type { Plan } from "../src/lib/plans";
import type { Reader } from "../src/lib/types";
import { fetchArticle } from "./article";
import { translateArticle } from "./translate";
import { llmCost } from "./cost";
import { resolve, type Usage } from "./digest";

/**
 * Что уже известно про произношение: затравка из кода и накопленное в базе.
 * Накопленное перекрывает затравку — словарь правится данными, а не выкаткой.
 */
async function learnedTerms(
  terms: string[],
  language: string,
): Promise<Record<string, string>> {
  if (terms.length === 0) return {};
  const rows = await sql<{ term: string; spoken: string }[]>`
    select term, spoken from dailynews.spoken_terms
     where language = ${language} and term = any(${terms.map((t) => t.toLowerCase())})
  `;
  return Object.fromEntries(rows.map((r) => [r.term, r.spoken]));
}

/**
 * Спросить модель, как читаются незнакомые термины.
 *
 * Спрашиваем список, а не переписанный текст. Отдай мы модели статью
 * целиком — она бы её заодно и пересказала, и отличить это от успеха
 * было бы нечем: текст на месте, звучит гладко, просто уже не тот.
 * Список терминов подставляется механически, и трогать текст модели
 * нечем по устройству.
 */
export async function askSpoken(
  terms: string[],
  language: string,
  usage: Usage,
): Promise<Record<string, string>> {
  if (terms.length === 0) return {};
  // Провайдера решает тот же код, что у дайджеста и перевода: вторая копия
  // дефолтов разъезжается с первой молча, и разойтись она может в сторону
  // «ходим не туда», а не «не ходим вовсе».
  const { baseUrl, model, apiKey } = resolve();
  if (!apiKey) {
    console.log("  ! ключа модели нет — термины останутся как написаны");
    return {};
  }

  const prompt = `Ниже латинские термины из новости. Напиши, как каждый звучит на ${language} языке, буквами этого языка.

Правила:
— пиши произношение, а не перевод: Google → гугл, а не «поисковик»;
— аббревиатуры по буквам через дефис: API → эй-пи-ай;
— если термин уже читается по правилам этого языка, повтори его как есть.

Пример провала: Gemini → «близнецы». Это перевод, он не годится: читателю
нужно услышать название продукта, а не созвездие.

Ответь строками вида «термин = произношение», по строке на термин, без
нумерации и без пояснений.

${terms.join("\n")}`;

  // Всё, что может не получиться, здесь кончается пустым словарём,
  // а не исключением. Непрочитанный термин — это оговорка диктора;
  // упавшая озвучка — это минута работы и цент перевода в мусор.
  // Разница между ними стоит одного try.
  let payload: {
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices?: { message?: { content?: string } }[];
  };
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        // Как звучит слово — не предмет для размышления, а справка.
        reasoning_effort: "none",
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      console.log(`  ! произношение не спросилось: HTTP ${res.status}`);
      return {};
    }
    payload = await res.json();
  } catch (error) {
    console.log(
      `  ! произношение не спросилось: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {};
  }
  usage.requests += 1;
  usage.input += payload.usage?.prompt_tokens ?? 0;
  usage.output += payload.usage?.completion_tokens ?? 0;

  const wanted = new Set(terms.map((t) => t.toLowerCase()));
  const out: Record<string, string> = {};
  for (const line of String(payload.choices?.[0]?.message?.content ?? "").split("\n")) {
    const at = line.indexOf("=");
    if (at < 1) continue;
    const term = line.slice(0, at).trim().toLowerCase();
    const spoken = line.slice(at + 1).trim();
    // Берём только то, что спрашивали: строка про термин, которого
    // в статье нет, — это придуманный моделью ответ на свой же вопрос.
    if (spoken && wanted.has(term)) out[term] = spoken;
  }
  return out;
}

/**
 * Текст, готовый к озвучке: латиница заменена произношением.
 *
 * Для языков на латинице возвращается как есть — там менять нечего
 * и нельзя.
 */
export async function spokenText(
  text: string,
  language: string,
  usage: Usage,
): Promise<string> {
  if (!NON_LATIN.has(language)) return text;

  const known = spokenMap(text, language, await learnedTerms(latinRuns(text), language));
  const unknown = unknownRuns(text, known);
  if (unknown.length > 0) {
    const asked = await askSpoken(unknown, language, usage);
    const rows = Object.entries(asked);
    if (rows.length > 0) {
      await sql`
        insert into dailynews.spoken_terms ${sql(
          rows.map(([term, spoken]) => ({ term, spoken, language, source: "model" })),
        )}
        on conflict (term, language) do nothing
      `;
      for (const [term, spoken] of rows) known.set(term, spoken);
    }
    const left = unknown.filter((run) => !known.has(run.toLowerCase()));
    if (left.length > 0) {
      // Молчать нельзя: непрочитанный термин звучит как оговорка диктора,
      // и по звуку не отличить «модель не ответила» от «так и задумано».
      console.log(`  ~ без произношения остались: ${left.join(", ")}`);
    }
  }
  return applySpoken(text, known);
}

/**
 * Синтез. Куски склеиваются буфером: кадры mp3 стыкуются встык,
 * перекодировать нечем и незачем.
 */
export async function synthesize(text: string, voice: string): Promise<Buffer> {
  const parts: Buffer[] = [];
  for (const piece of chunks(text)) {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, FORMAT);
    try {
      const { audioStream } = await tts.toStream(piece);
      const buffers: Buffer[] = [];
      for await (const chunk of audioStream) buffers.push(Buffer.from(chunk));
      parts.push(Buffer.concat(buffers));
    } finally {
      tts.close();
    }
  }
  return Buffer.concat(parts);
}

/**
 * Формат потока — один на синтез и на подсчёт.
 *
 * Длительность считается делением на битрейт, и битрейт обязан быть тем же,
 * которым просили синтез. Напиши его числом отдельно — смена формата
 * поедет только в одном месте, а квота продолжит считать по старому,
 * не ошибившись ни разу заметно.
 */
const FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
const BYTES_PER_SECOND = Number(/(\d+)KBITRATE/.exec(FORMAT)?.[1] ?? 48) * 1000 / 8;

export const secondsOf = (audio: Buffer): number => Math.round(audio.length / BYTES_PER_SECOND);


/**
 * Сколько секунд озвучки читатель получил сегодня.
 *
 * Считается по отправкам, а не по счётчику в `readers`: счётчик пришлось бы
 * гасить по расписанию, а расписание здесь ходит раз в сутки — то есть
 * в день сброса квоты не было бы вовсе.
 *
 * Считается и пересылка готового: слушает он одинаково, платим мы по-разному,
 * а квота — про его время, а не про наш счёт.
 */
export async function secondsToday(readerId: number): Promise<number> {
  const [row] = await sql<{ total: number }[]>`
    select coalesce(sum(seconds), 0)::int as total
      from dailynews.audio_sends
     where reader_id = ${readerId}
       and status in ('queued', 'translating', 'speaking', 'sending', 'sent')
       and at > now() - interval '1 day'
  `;
  return row?.total ?? 0;
}

/**
 * Поставить озвучку в очередь.
 *
 * Отказ возвращается строкой, а не исключением: её показывает интерфейс
 * сразу, а не через минуту в журнале.
 */
export async function queueAudioSend(
  reader: Reader,
  plan: Plan,
  itemId: number,
  t: AudioErrors & { audioNoText: string; audioAlreadySpeaking: string },
  planLabel: string,
): Promise<{ id: number; seconds: number } | { error: string }> {
  // Оценка считается по тому тексту, который и будет озвучен: перевод
  // на кириллицу длиннее английского оригинала примерно на треть, а фид
  // отдаёт куда меньше, чем догрузка. Мерить по `items.body`, а звучать
  // переводом — значит отказывать на коротком и пропускать за предел
  // на длинном, и оба раза числа выглядят правдоподобно.
  const [ready] = await sql<{ markdown: string }[]>`
    select markdown from dailynews.item_translations
     where item_id = ${itemId} and language = ${reader.language}
  `;
  const [item] = await sql<{ body: string | null; excerpt: string | null }[]>`
    select body, excerpt from dailynews.items where id = ${itemId}
  `;
  if (!item) return { error: t.audioNoText };

  const source = ready?.markdown ?? item.body ?? item.excerpt ?? "";
  if (source.trim().length < 200) return { error: t.audioNoText };
  // Без готового перевода длина известна только приблизительно: догрузка
  // даёт больше текста, перевод — ещё. Берётся запас, чтобы разрешить
  // то, что потом не влезет, было нельзя.
  const want = Math.ceil(estimateSeconds(source, reader.language) * (ready ? 1 : 1.4));

  const blocker = audioBlocker(reader, plan, await secondsToday(reader.id), want, t, planLabel);
  if (blocker) return { error: blocker };

  // Второе нажатие на ту же карточку не заводит вторую озвучку: два
  // одновременных запроса оба видят свободную квоту, и читатель уходит
  // за предел вдвое. Ограничение в базе, а не проверка перед вставкой:
  // между чтением и записью помещается ровно этот случай.
  const [row] = await sql<{ id: number }[]>`
    insert into dailynews.audio_sends (reader_id, item_id, seconds)
    select ${reader.id}, ${itemId}, ${want}
     where not exists (
       select 1 from dailynews.audio_sends
        where reader_id = ${reader.id} and item_id = ${itemId}
          and status in ('queued', 'translating', 'speaking', 'sending')
     )
    returning id
  `;
  if (!row) return { error: t.audioAlreadySpeaking };
  return { id: row.id, seconds: want };
}

const step = (sendId: number, status: string) =>
  sql`update dailynews.audio_sends set status = ${status} where id = ${sendId}`;

/**
 * Озвучить и отправить.
 *
 * Порядок шагов — тот же, что у читалки, и по той же причине: перевод
 * дорогой и кэшируется, синтез дешёвый и нет. Шаг пишется в базу до
 * работы, а не после: интерфейс спрашивает «на чём сейчас», и ответ
 * «перевожу» обязан появиться в начале перевода, а не в конце.
 */
export async function runAudioSend(
  sendId: number,
  reader: Reader,
  itemId: number,
): Promise<void> {
  // Слушает он или нет — решается один раз и до разбора ошибки.
  let delivered = false;
  try {
    // Заголовок — общий запрос с читалкой: он знает про то, что
    // `items.title_ru` нет с 0020, и скоуплен по читателю.
    const item = await itemForReader(reader.id, itemId);
    if (!item) throw new Error(`материала ${itemId} нет`);

    const title = item.title;
    const language = reader.language;

    // Готовое аудио на этом языке — вторая отправка не стоит ничего:
    // ни синтеза, ни трафика, только пересылка по file_id.
    const [ready] = await sql<{ file_id: string; seconds: number }[]>`
      select file_id, seconds from dailynews.item_audio
       where item_id = ${itemId} and language = ${language}
    `;
    if (ready) {
      await step(sendId, "sending");
      await sendAudio(Number(reader.telegram_id), ready.file_id, {
        title,
        url: item.url,
        duration: ready.seconds,
      });
      await sql`
        update dailynews.audio_sends
           set status = 'sent', seconds = ${ready.seconds}, fresh = false
         where id = ${sendId}
      `;
      console.log(`  озвучка взята готовой (${ready.seconds} с)`);
      return;
    }

    await step(sendId, "translating");

    // За статьёй идём только когда её нечем заменить: готовый перевод
    // делает догрузку бесполезной, а она стоит запроса к чужому сайту
    // и секунд ожидания. Раньше она шла всегда, в том числе у читателя,
    // которому оставалось только переслать готовое.
    let body: string;
    const [cached] = await sql<{ markdown: string }[]>`
      select markdown from dailynews.item_translations
       where item_id = ${itemId} and language = ${language}
    `;
    if (cached) {
      body = cached.markdown;
    } else if (language === SOURCE_LANGUAGE) {
      // Читатель просил не переводить — переводить и не надо.
      body = (await fetchArticle(item.url, item.body)).markdown;
    } else {
      const article = await fetchArticle(item.url, item.body);
      const translated = await translateArticle(article.markdown, language);
      body = translated.markdown;
      await recordCall({
        readerId: reader.id, stage: "translate", model: translated.model,
        tokensIn: translated.usage.input, tokensOut: translated.usage.output,
        costUsd: llmCost(translated.usage),
      });
      await sql`
        insert into dailynews.item_translations (item_id, language, markdown, model)
        values (${itemId}, ${language}, ${body}, ${translated.model})
        on conflict (item_id, language) do nothing
      `;
    }

    await step(sendId, "speaking");
    const usage: Usage = { requests: 0, input: 0, output: 0, cached: 0, reasoning: 0 };
    const plain = `${title}. ${stripMarkdown(body)}`;
    const spoken = await spokenText(plain, language, usage);
    if (usage.requests > 0) {
      await recordCall({
        readerId: reader.id, stage: "spoken-terms", model: process.env.LLM_MODEL ?? "?",
        tokensIn: usage.input, tokensOut: usage.output, costUsd: llmCost(usage),
      });
    }

    const voice =
      language === SOURCE_LANGUAGE ? voiceForText(spoken) : voiceFor(language) ?? voiceForText(spoken);
    const audio = await synthesize(spoken, voice);
    const seconds = secondsOf(audio);

    await step(sendId, "sending");
    const sent = await sendAudio(Number(reader.telegram_id), audio, {
      title,
      url: item.url,
      duration: seconds,
    });

    // Отсюда и ниже читатель уже слушает. Провал записи — это наша
    // бухгалтерия, а не его неудача: пометить строку `failed` с нулём
    // секунд значило бы отдать озвучку бесплатно и не списать квоту,
    // причём выглядело бы это как честный отказ.
    delivered = true;

    // Кладём file_id только после успешной отправки: строка про аудио,
    // которого у Telegram нет, отдала бы второму читателю ссылку в пустоту.
    await sql`
      insert into dailynews.item_audio (item_id, language, file_id, seconds, voice)
      values (${itemId}, ${language}, ${sent.fileId}, ${seconds}, ${voice})
      on conflict (item_id, language) do nothing
    `;
    await sql`
      update dailynews.audio_sends
         set status = 'sent', seconds = ${seconds}
       where id = ${sendId}
    `;
    console.log(`  озвучил «${title.slice(0, 50)}»: ${seconds} с, голос ${voice}`);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (delivered) {
      // Доставлено, но не записалось. Отправка состоялась, значит и квота
      // списывается; в ошибку идёт причина, чтобы разрыв было видно.
      await sql`
        update dailynews.audio_sends
           set status = 'sent', error = ${`доставлено, но не записалось: ${text}`.slice(0, 500)}
         where id = ${sendId}
      `.catch(() => {});
      console.log(`  ! озвучка ушла, но запись не легла: ${text}`);
      return;
    }
    // Секунды снимаются вместе с отказом: неудавшаяся озвучка не имеет
    // права съесть квоту дня — иначе три поломки подряд закрывают день
    // читателю, который не услышал ничего.
    await sql`
      update dailynews.audio_sends
         set status = 'failed', error = ${text.slice(0, 500)}, seconds = 0
       where id = ${sendId}
    `;
    console.log(`  ! озвучка не вышла: ${text}`);
  }
}

/**
 * Разметка вслух не читается.
 *
 * Голос произносит `##` как «решётка решётка», а ссылку — вместе с адресом.
 * Убирается механически: это не разбор markdown, а снятие знаков, которые
 * в звуке лишние.
 */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/(\*\*|__|\*|_)/g, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
