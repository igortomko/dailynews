/**
 * Что происходит между нажатием кнопки и книгой на читалке.
 *
 * Выпуск на Kindle (в run.ts) собирается из того, что дайджест уже написал:
 * заголовки и описания переведены прогоном, и стоит это ноль. Здесь другое —
 * статья целиком: забрать, перевести, собрать книгу. Минута работы
 * и около цента, поэтому у неё есть журнал, потолок и оценка качества.
 */
import { sql } from "../src/lib/db";
import { recordCall, spentToday } from "../src/lib/readers";
import type { Reader } from "../src/lib/types";
import { fetchArticle } from "./article";
import { translateArticle, splitBlocks } from "./translate";
import { scoreTranslation } from "./translation-quality";
import { buildEpub } from "./epub";
import { articleBlocker, sendArticleToKindle } from "./kindle";
import { llmCost, jevCost } from "./cost";

/**
 * Сколько ждать зависшую отправку, прежде чем считать её провалившейся.
 * Минута уходит на перевод, ещё сколько-то на картинки и письмо;
 * четверть часа — потолок с запасом.
 */
const STALE_MINUTES = 15;

/**
 * Разгрести зависшие отправки. Работа идёт вне запроса, и если процесс
 * умер посередине, статус так и остаётся queued. Частичный уникальный
 * индекс держит такую строку живой, и повторить отправку нельзя уже
 * никогда — притом что провалившуюся повторить как раз можно.
 *
 * Отдельного расписания под это нет намеренно: разгребать имеет смысл
 * ровно перед тем, как отправлять, а не каждые пять минут впустую.
 */
export async function reclaimStale(): Promise<void> {
  await sql`
    update dailynews.kindle_sends
       set status = 'failed',
           error = coalesce(error, 'отправка оборвалась: процесс не дожил до конца')
     where status = 'queued'
       and at < now() - ${`${STALE_MINUTES} minutes`}::interval
  `;
}


/**
 * Выполнить отправку и записать исход. Не бросает: вызывается из after()
 * и из бота, где некому поймать. Провал попадает в kindle_sends — оттуда
 * его видно в интерфейсе, а молчащая ошибка выглядела бы как «отправлено».
 */
export async function runArticleSend(
  sendId: number,
  reader: Reader,
  itemId: number,
): Promise<void> {
  try {
    const [item] = await sql<
      { url: string; title: string; title_ru: string | null; body: string | null }[]
    >`select url, title, title_ru, body from dailynews.items where id = ${itemId}`;
    if (!item) throw new Error(`материала ${itemId} нет`);

    // body — полный текст из фида, если он был. Тогда никуда идти не надо.
    const article = await fetchArticle(item.url, item.body);
    console.log(`  забрал ${article.words} слов (${article.via})`);

    // Перевод зависит от текста и языка, и больше ни от чего. Тот же
    // материал у второго читателя с тем же языком берётся отсюда и стоит
    // ноль: при двадцати читателях с общей темой девятнадцать переводов
    // из двадцати не случаются.
    const [cached] = await sql<{ markdown: string }[]>`
      select markdown from dailynews.item_translations
       where item_id = ${itemId} and language = ${reader.language}
    `;

    let body = cached?.markdown;
    let quality = null as Awaited<ReturnType<typeof scoreTranslation>>;

    if (body) {
      console.log("  перевод взят из кэша");
    } else {
      const translated = await translateArticle(article.markdown, reader.language);
      body = translated.markdown;
      await recordCall({
        readerId: reader.id, stage: "translate", model: translated.model,
        tokensIn: translated.usage.input, tokensOut: translated.usage.output,
        costUsd: llmCost(translated.usage),
      });
      await sql`
        insert into dailynews.item_translations (item_id, language, markdown, model)
        values (${itemId}, ${reader.language}, ${body}, ${translated.model})
        on conflict (item_id, language) do nothing
      `;

      // Оценка перевода — вторая петля, та же, что у описаний. Стоит доли
      // цента на пяти абзацах и не имеет права уронить отправку: она
      // измеряет, а не доставляет. Кэшированный перевод повторно
      // не оценивается: числа те же, а ряд по дням они бы засорили.
      quality = await scoreTranslation(
        splitBlocks(article.markdown),
        splitBlocks(body),
      ).catch(() => null);
      if (quality) {
        await recordCall({
          readerId: reader.id, stage: "translation-quality", model: quality.model,
          tokensIn: quality.inputTokens, costUsd: jevCost(quality.inputTokens),
        });
      }
    }

    const epub = await buildEpub({
      // Заголовок берётся из выпуска: он уже переведён прогоном, платить
      // за перевод одной строки второй раз незачем.
      title: item.title_ru || article.title,
      author: article.author,
      site: article.site,
      url: item.url,
      markdown: body,
      language: reader.language,
    });

    await sendArticleToKindle({
      to: reader.kindle_address!,
      sender: reader.kindle_sender!,
      title: item.title_ru || article.title,
      epub,
    });

    await sql`
      update dailynews.kindle_sends
         set status = 'sent', error = null, words = ${article.words},
             quality_total = ${quality?.total ?? null},
             quality_axes = ${quality ? sql.json(quality.axes as never) : null}
       where id = ${sendId}
    `;

    // Отправка — это сигнал отбора не хуже открытия: читатель захотел
    // потратить на материал вечер. Пишется в ту же таблицу, что и всё
    // остальное, чтобы калибровка видела её наравне с открытиями.
    // Скор берётся из выпуска этого читателя (digest_items.total), а не
    // из каталожного scores.total: у того же материала у соседа он другой,
    // и калибровка сравнивала бы своё чтение с чужим числом.
    await sql`
      insert into dailynews.reads (reader_id, item_id, event, score_snap, conf_snap)
      select ${reader.id}, ${itemId}, 'kindled', di.total, sc.confidence
        from dailynews.digest_items di
        join dailynews.digests d on d.id = di.digest_id
        join dailynews.scores sc on sc.item_id = di.item_id
       where di.item_id = ${itemId} and d.reader_id = ${reader.id}
       order by d.day desc
       limit 1
    `;

    console.log(
      `  на Kindle: ${item.title_ru || article.title} ` +
      `(${(epub.length / 1024).toFixed(0)} КБ, качество ${quality?.total?.toFixed(0) ?? "—"})`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      update dailynews.kindle_sends set status = 'failed', error = ${message.slice(0, 500)}
       where id = ${sendId}`;
    console.error(`  ! отправка на Kindle не удалась: ${message}`);
  }
}

/**
 * Поставить отправку в очередь. Возвращает id строки журнала либо причину
 * отказа — её показывает интерфейс сразу, а не через минуту в журнале.
 */
export async function queueArticleSend(
  reader: Reader,
  itemId: number,
): Promise<{ id: number } | { error: string }> {
  const blocker = articleBlocker(reader, await spentToday(reader.id));
  if (blocker) return { error: blocker };

  await reclaimStale();

  const [row] = await sql<{ id: number }[]>`
    insert into dailynews.kindle_sends (reader_id, item_id)
    values (${reader.id}, ${itemId})
    on conflict do nothing
    returning id
  `;
  if (!row) return { error: "уже отправляется или отправлено" };
  return { id: row.id };
}
