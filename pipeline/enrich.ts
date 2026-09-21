/**
 * Догрузка текста статьи по ссылке.
 *
 * Стоит рядом со сбором и до оценки по той же причине, что и расшифровка
 * роликов: Jev оценивает материал по заголовку и тексту, а фид текста
 * часто не отдаёт вовсе. У Hacker News описания нет по устройству API —
 * 138 материалов из 147 за трое суток пришли с пустым excerpt; рассылка
 * кладёт туда служебную строку «Community Wisdom 298» в двадцать знаков.
 *
 * Дальше это выглядело как работающий продукт. Оценка ставилась по одной
 * строке заголовка, дайджест по ней же писал «конспект», и читатель
 * получал гладкий текст, из которого нельзя узнать, что в статье:
 * в выпуске 20 сентября описание было длиннее своего источника
 * у 37 материалов из 40. Ни одной ошибки при этом не возникало.
 *
 * Модели шаг не стоит ничего: это запрос страницы и разбор разметки.
 * Дорожает только вход — у Jev на материал, у дайджеста на описание.
 */
import type { Sql } from "postgres";
import { fetchArticle } from "./article";
import { pooled, stripHtml } from "./fetch";
import { articleHtml, videoIdOf } from "./youtube";

/**
 * Ниже этого фид считается не отдавшим текста. Граница щедрая нарочно:
 * 500 знаков анонса — это лид, а не статья, и написать по нему конспект
 * так же нечем, как по заголовку. Материал, у которого фид отдал статью
 * целиком, порог проходит и в сеть не отправляется.
 */
export const SHORT_EXCERPT = 600;

/**
 * Сколько ссылок обходим за один прогон. Упирается не в деньги, а в время:
 * окно свежести двое суток, и то, что не успело сегодня, догрузится
 * следующей ночью — материал до тех пор живёт с тем, что дал фид.
 */
export const MAX_ARTICLES_PER_RUN = 200;

/** Сколько знаков текста кладём в excerpt — его читает Jev на каждом вопросе. */
const EXCERPT_CHARS = 1200;

/**
 * Ответил ли сайт по существу. fetchArticle складывает причины всех уровней
 * в одну строку, и разницы между «сайт отказал» и «связь не состоялась»
 * в ней нет — а она решает, ходить ли сюда ещё раз.
 *
 * Отметка на временной ошибке стоит дорого молча: одна ночь с оборванным
 * соединением — и материал живёт с пустым текстом до конца своего окна,
 * потому что повторно за ним уже не пойдут.
 */
export function refusedForGood(message: string): boolean {
  // Ни одного ответа по существу: домен не разрешился, соединение не встало,
  // сертификат не проверился, время вышло. Завтра может быть иначе.
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|CERT_|TLS|timed out|aborted|fetch failed|socket hang up/i.test(message)) {
    return false;
  }
  // Сервер ответил (любой статус) или страница разобралась, но статьи в ней
  // нет: платный доступ, антибот, релиз-нота в три строки. Завтра то же самое.
  return /HTTP \d{3}|текста меньше|не осталось текста|внутреннюю сеть|протокол не поддерживается|больше потолка|перенаправлений/i.test(message);
}

export type EnrichRow = {
  id: number;
  url: string;
  title: string;
  excerpt: string;
  /** Текст, который уже приехал со сбором: письмо целиком, полный RSS-item. */
  body: string | null;
};

/**
 * Берём всё окно, а не вставленное этим прогоном: первая попытка могла
 * не удаться — сайт ответил отказом, страница оказалась заглушкой, — и без
 * отметки материал остался бы с пустым текстом навсегда, потому что новым
 * он больше никогда не будет. Ровно этим когда-то отличался ролик,
 * расшифрованный не с первого раза.
 */
export async function pendingArticles(sql: Sql, windowDays: number): Promise<EnrichRow[]> {
  const rows = await sql<EnrichRow[]>`
    select i.id, i.url, i.title, i.excerpt, i.body
      from dailynews.items i
     where i.dup_of is null
       and i.enriched_at is null
       and length(i.excerpt) < ${SHORT_EXCERPT}
       and i.collected_at > now() - ${`${windowDays} days`}::interval
     order by i.id
  `;
  // Ролики забирает расшифровка: у них текст достаётся из субтитров,
  // а не со страницы, и конспект уже лежит в excerpt.
  return rows.filter((row) => !videoIdOf(row.url));
}

/** Обрезка по границе предложения: обрывок на середине слова уедет
 *  и в оценку Jev, и в промпт дайджеста как часть текста материала. */
export function clipText(text: string, chars = EXCERPT_CHARS): string {
  if (text.length <= chars) return text.trim();
  const cut = text.slice(0, chars);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (stop > chars / 2 ? cut.slice(0, stop + 1) : cut).trim();
}

/**
 * Текст для excerpt. Markdown приводится к тексту через ту же разметку,
 * которой он уедет в body: своего разбора markdown здесь не заводится.
 */
export function excerptFrom(markdown: string, chars = EXCERPT_CHARS): string {
  return clipText(stripHtml(articleHtml(markdown)), chars);
}

/**
 * Записать текст. Оценка снимается первой, а отметка ставится последней:
 * между двумя запросами процесс может умереть, и порядок решает, чем это
 * кончится. Снятая оценка без отметки — материал переберётся следующей
 * ночью, то есть починится сам. Отметка без снятой оценки — материал
 * остался бы с оценкой по заголовку до конца окна, и шаг скоринга его
 * больше не увидит: он берёт только тех, у кого оценки нет.
 */
async function writeText(sql: Sql, id: number, excerpt: string, body: string | null, kind: "article_text" | "feed_text"): Promise<void> {
  await sql`delete from dailynews.scores where item_id = ${id}`;
  await sql`
    update dailynews.items
       set excerpt = ${excerpt}, body = coalesce(${body}, body), enriched_at = now(), source_content_kind = ${kind}
     where id = ${id}
  `;
}

export async function enrichArticles(
  sql: Sql,
  windowDays: number,
  log: (msg: string) => void,
): Promise<{ done: number; failed: number; transient: number; pending: number }> {
  const all = await pendingArticles(sql, windowDays);
  if (all.length === 0) return { done: 0, failed: 0, transient: 0, pending: 0 };

  const take = all.slice(0, MAX_ARTICLES_PER_RUN);
  if (all.length > take.length) {
    log(`   без текста ${all.length}, догрузим ${take.length} — остальные в следующий прогон`);
  }

  let done = 0;
  let failed = 0;
  let transient = 0;
  await pooled(take, 6, async (row) => {
    try {
      // Текст, который уже лежит в базе со сбора, читается прямо отсюда,
      // и в сеть за ним никто не идёт. Письмо рассылки приезжает целиком:
      // у выпуска Lenny's в excerpt было двадцать знаков служебной строки
      // при пяти тысячах знаков письма рядом, в соседней колонке. Через
      // разбор статьи это не проходило: письмо свёрстано таблицами,
      // defuddle не признаёт его статьёй и оставляет от него меньше
      // ста двадцати слов. А ссылка «посмотреть в браузере» ведёт
      // на страницу подписки и отвечает отказом.
      const stored = row.body ? stripHtml(row.body) : "";
      if (stored.length >= SHORT_EXCERPT) {
        await writeText(sql, row.id, clipText(stored), null, "feed_text");
        done++;
        return;
      }

      const article = await fetchArticle(row.url, row.body);
      const excerpt = excerptFrom(article.markdown);
      // Пустой excerpt писать нельзя: колонка not null, и «текст забрали,
      // но он пуст» ничем не лучше того, что было.
      if (!excerpt) throw new Error("после разбора не осталось текста");
      await writeText(sql, row.id, excerpt, articleHtml(article.markdown) || null, article.via === "feed" ? "feed_text" : "article_text");
      done++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Отметка ставится только на отказ по существу: платный доступ, антибот,
      // страница без статьи. Оборванное соединение и не ответивший вовремя
      // сайт отметки не получают — за ними сходят следующей ночью.
      if (refusedForGood(message)) {
        await sql`update dailynews.items set enriched_at = now() where id = ${row.id}`;
        failed++;
      } else {
        transient++;
      }
      log(`   «${row.title.slice(0, 45)}»: ${message.slice(0, 90)}`);
    }
  });

  return { done, failed, transient, pending: all.length - take.length };
}
