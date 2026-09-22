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
  podcastIntro, spokenMap, unabbreviate, unknownRuns, voiceFor, voiceForText,
  type AudioErrors,
} from "../src/lib/speech";
import { audioUrl, sendAudio } from "../src/lib/telegram";
import { cardForReader, recordCall } from "../src/lib/readers";
import { appOrigin } from "../src/lib/auth";
import { SOURCE_LANGUAGE } from "../src/lib/voice";
import type { Plan } from "../src/lib/plans";
import type { Reader } from "../src/lib/types";
import { llmCost } from "./cost";
import { GAP_MP3, GAP_SECONDS } from "./gap";
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
 * Текст, готовый к озвучке: сокращения без точки, латиница —
 * произношением.
 *
 * Произношение подставляется только там, где латиница чужая письменность:
 * английской статье оно противопоказано. Сокращения снимаются всем.
 */
export async function spokenText(
  text: string,
  language: string,
  usage: Usage,
): Promise<string> {
  // Сокращения снимаются раньше и независимо от письменности: точка
  // в «50 тыс.» обрывает фразу на любом языке, а произношение латиницы
  // нужно только тем, кому латиница чужая.
  const plain = unabbreviate(text, language);
  if (!NON_LATIN.has(language)) return plain;

  const known = spokenMap(plain, language, await learnedTerms(latinRuns(plain), language));
  const unknown = unknownRuns(plain, known);
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
  return applySpoken(plain, known);
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
/**
 * Значения `OUTPUT_FORMAT` — строчными (`audio-24khz-48kbitrate-mono-mp3`),
 * поэтому разбор без учёта регистра. С чувствительным к регистру он
 * не совпадал никогда и молча брал запасное число: правка, которая должна
 * была убрать зашитый битрейт, зашивала его второй раз и прятала.
 * Отсутствие совпадения — это поломка, а не повод подставить 48.
 */
const kbitrate = /(\d+)kbitrate/i.exec(FORMAT)?.[1];
if (!kbitrate) throw new Error(`не разобрал битрейт формата: ${FORMAT}`);
const BYTES_PER_SECOND = (Number(kbitrate) * 1000) / 8;

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
  // Считается по тому тексту, который и будет озвучен, — по карточке.
  // Пока озвучивалась статья, оценка шла по `items.body`, а звучал перевод:
  // 48 749 знаков превращались в 78 минут при квоте в 45, и кнопка
  // отказывала почти на всём, хотя карточка над ней обещала две минуты.
  const card = await cardForReader(reader.id, itemId);
  if (!card) return { error: t.audioNoText };

  const text = `${card.title}. ${card.summary}`.trim();
  if (text.length < 40) return { error: t.audioNoText };
  const want = estimateSeconds(text, reader.language);

  const blocker = audioBlocker(reader, plan, await secondsToday(reader.id), want, t, planLabel);
  if (blocker) return { error: blocker };

  // Второе нажатие на ту же карточку не заводит вторую озвучку. Решает
  // это индекс `audio_sends_one_in_flight` из 0047, а не проверка перед
  // вставкой: между чтением и записью помещается ровно этот случай.
  // `on conflict do nothing` превращает нарушение ключа во внятный отказ
  // вместо пятисотой.
  const [row] = await sql<{ id: number }[]>`
    insert into dailynews.audio_sends (reader_id, item_id, seconds)
    values (${reader.id}, ${itemId}, ${want})
    on conflict do nothing
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
    const card = await cardForReader(reader.id, itemId);
    if (!card) throw new Error(`карточки ${itemId} у читателя ${reader.id} нет`);

    const language = reader.language;

    // Готовая озвучка этой карточки: второе нажатие и подкаст, в который
    // она попала, стоят пересылку по file_id, а не синтез.
    const [ready] = await sql<{ file_id: string; seconds: number }[]>`
      select file_id, seconds from dailynews.card_audio
       where digest_id = ${card.digestId} and item_id = ${itemId}
    `;
    if (ready) {
      await step(sendId, "sending");
      await sendAudio(Number(reader.telegram_id), ready.file_id, {
        title: card.title,
        url: card.url,
        duration: ready.seconds,
      });
      // Пересылка — такая же доставка: читатель уже слушает, и упавшая
      // после неё запись не имеет права выдать это за провал.
      delivered = true;
      await sql`
        update dailynews.audio_sends
           set status = 'sent', seconds = ${ready.seconds}, fresh = false
         where id = ${sendId}
      `;
      console.log(`  озвучка взята готовой (${ready.seconds} с)`);
      return;
    }

    // Переводить нечего: карточка уже написана языком читателя. Отсюда
    // и вся разница с прежней озвучкой статьи — ни запроса к чужому
    // сайту, ни минуты перевода, ни цента за него.
    await step(sendId, "speaking");
    const usage: Usage = { requests: 0, input: 0, output: 0, cached: 0, reasoning: 0 };
    const spoken = await spokenText(`${card.title}. ${card.summary}`, language, usage);
    if (usage.requests > 0) {
      await recordCall({
        readerId: reader.id, stage: "spoken-terms", model: resolve().model,
        tokensIn: usage.input, tokensOut: usage.output, costUsd: llmCost(usage),
      });
    }

    const voice =
      language === SOURCE_LANGUAGE ? voiceForText(spoken) : voiceFor(language) ?? voiceForText(spoken);
    const audio = await synthesize(spoken, voice);
    const seconds = secondsOf(audio);

    await step(sendId, "sending");
    const sent = await sendAudio(Number(reader.telegram_id), audio, {
      title: card.title,
      url: card.url,
      duration: seconds,
    });
    delivered = true;

    // Кладём file_id только после успешной отправки: строка про аудио,
    // которого у Telegram нет, отдала бы ссылку в пустоту.
    await sql`
      insert into dailynews.card_audio (digest_id, item_id, file_id, seconds, voice)
      values (${card.digestId}, ${itemId}, ${sent.fileId}, ${seconds}, ${voice})
      on conflict (digest_id, item_id) do nothing
    `;
    await sql`
      update dailynews.audio_sends set status = 'sent', seconds = ${seconds} where id = ${sendId}
    `;
    console.log(`  озвучил «${card.title.slice(0, 50)}»: ${seconds} с, голос ${voice}`);
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

/**
 * Озвучка одной карточки: готовая или новая, всегда байтами.
 *
 * Байты нужны обоим путям — и подкасту на склейку, и первой отправке.
 * Готовая скачивается из Telegram: это тот же файл, который мы туда
 * и положили, и второй синтез дал бы другой, но не лучший.
 */
async function cardAudio(
  reader: Reader,
  itemId: number,
  usage: Usage,
): Promise<
  { audio: Buffer; seconds: number; title: string; voice: string; day: string } | null
> {
  const card = await cardForReader(reader.id, itemId);
  if (!card) return null;

  // Голос лежит в строке готовой озвучки, и берётся он оттуда, а не
  // вычисляется заново: вступление обязано звучать тем же голосом, что
  // первая карточка, а у языка оригинала он выбирается по её тексту —
  // которого при готовой озвучке мы не синтезируем вовсе.
  const [ready] = await sql<{ file_id: string; seconds: number; voice: string }[]>`
    select file_id, seconds, voice from dailynews.card_audio
     where digest_id = ${card.digestId} and item_id = ${itemId}
  `;
  if (ready) {
    const res = await fetch(await audioUrl(ready.file_id), { signal: AbortSignal.timeout(60_000) });
    if (res.ok) {
      return {
        audio: Buffer.from(await res.arrayBuffer()),
        seconds: ready.seconds,
        title: card.title,
        voice: ready.voice,
        day: card.day,
      };
    }
    // Ссылка Telegram живёт около часа, а строка у нас вечно. Не скачалось —
    // синтезируем заново: молча отдать подкаст без одной карточки значит
    // выдать неполное за целое.
    console.log(`  ~ готовая озвучка ${itemId} не скачалась, синтезирую заново`);
  }

  const spoken = await spokenText(`${card.title}. ${card.summary}`, reader.language, usage);
  const voice =
    reader.language === SOURCE_LANGUAGE
      ? voiceForText(spoken)
      : voiceFor(reader.language) ?? voiceForText(spoken);
  const audio = await synthesize(spoken, voice);
  const seconds = secondsOf(audio);

  const sent = await sendAudio(Number(reader.telegram_id), audio, {
    title: card.title,
    url: card.url,
    duration: seconds,
  });
  await sql`
    insert into dailynews.card_audio (digest_id, item_id, file_id, seconds, voice)
    values (${card.digestId}, ${itemId}, ${sent.fileId}, ${seconds}, ${voice})
    on conflict (digest_id, item_id) do nothing
  `;
  return { audio, seconds, title: card.title, voice, day: card.day };
}

/**
 * Вступление перед первой новостью: имя продукта и число.
 *
 * Синтезируется последним, а встаёт первым: голос и день берутся
 * у первой карточки — при языке оригинала голос выбирается по её тексту,
 * и до синтеза карточки его попросту нет.
 *
 * Не получилось — подкаст уходит без вступления, а причина идёт в лог.
 * Вступление это подпись на файле; ронять из-за неё три минуты работы
 * и потраченную квоту нельзя, а молчать о пропаже — тем более: без строки
 * «вступление не вышло» отличить это от «так и задумано» нечем.
 */
async function introAudio(
  reader: Reader,
  first: { voice: string; day: string },
  usage: Usage,
): Promise<Buffer | null> {
  try {
    const text = await spokenText(podcastIntro(first.day, first.voice), reader.language, usage);
    return await synthesize(text, first.voice);
  } catch (error) {
    console.log(
      `  ~ вступление не вышло: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Подкаст из нескольких карточек.
 *
 * Синтезируется по карточке, склеивается буфером: кадры mp3 стыкуются
 * встык, перекодировать нечем и незачем. Покарточно, а не одним куском,
 * потому что карточка совпадает сама с собой всегда, а «эти три в этом
 * порядке» — ни с чем: поменял порядок, и это уже другой файл. Карточка,
 * которую читатель уже слушал, достаётся подкасту даром.
 *
 * Порядок — тот, в котором карточки идут в выпуске, а не в котором их
 * отмечали: подкаст слушают как выпуск, а отмечают сверху вниз и вразнобой.
 */
export async function runPodcast(
  sendIds: number[],
  reader: Reader,
  itemIds: number[],
): Promise<void> {
  const usage: Usage = { requests: 0, input: 0, output: 0, cached: 0, reasoning: 0 };
  const mark = (status: string) =>
    sql`update dailynews.audio_sends set status = ${status} where id = any(${sendIds})`;
  let delivered = false;
  try {
    await mark("speaking");
    const parts: Buffer[] = [];
    const titles: string[] = [];
    let first: { voice: string; day: string } | null = null;
    let seconds = 0;
    for (const itemId of itemIds) {
      const piece = await cardAudio(reader, itemId, usage);
      if (!piece) continue;
      // Пауза между новостями, но не после последней.
      if (parts.length > 0) {
        parts.push(GAP_MP3);
        seconds += GAP_SECONDS;
      }
      parts.push(piece.audio);
      titles.push(piece.title);
      seconds += piece.seconds;
      first ??= { voice: piece.voice, day: piece.day };
    }
    if (parts.length === 0 || !first) throw new Error("ни одной карточки озвучить не вышло");

    // Вступление впереди и через ту же паузу, что между новостями: тишина
    // в начале файла читается как «не загрузилось», а её отсутствие делает
    // из «Reporta, двадцать первое сентября» первую фразу первой новости.
    const intro = await introAudio(reader, first, usage);
    if (intro) {
      parts.unshift(intro, GAP_MP3);
      seconds += secondsOf(intro) + GAP_SECONDS;
    }

    if (usage.requests > 0) {
      await recordCall({
        readerId: reader.id, stage: "spoken-terms", model: resolve().model,
        tokensIn: usage.input, tokensOut: usage.output, costUsd: llmCost(usage),
      });
    }

    await mark("sending");
    // Заголовок — сколько внутри и чем начинается: «Подкаст» без этого
    // неотличим от вчерашнего в списке файлов Telegram.
    await sendAudio(Number(reader.telegram_id), Buffer.concat(parts), {
      title: `${titles.length} · ${titles[0]}`,
      url: appOrigin("https://news.tomko.io"),
      duration: seconds,
    });
    delivered = true;
    // Секунды раскладываются по строкам: квота считается суммой, и одна
    // строка на весь подкаст сделала бы её неделимой при частичном отказе.
    const each = Math.round(seconds / sendIds.length);
    await sql`
      update dailynews.audio_sends set status = 'sent', seconds = ${each}
       where id = any(${sendIds})
    `;
    console.log(`  подкаст: ${parts.length} карточек, ${seconds} с`);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (delivered) {
      await sql`
        update dailynews.audio_sends
           set status = 'sent', error = ${`доставлено, но не записалось: ${text}`.slice(0, 500)}
         where id = any(${sendIds})
      `.catch(() => {});
      return;
    }
    await sql`
      update dailynews.audio_sends
         set status = 'failed', error = ${text.slice(0, 500)}, seconds = 0
       where id = any(${sendIds})
    `;
    console.log(`  ! подкаст не вышел: ${text}`);
  }
}
