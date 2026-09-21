import { sql } from "./db";
import type { Draft, PostSource } from "../../pipeline/post";
import { canonUrl, normalizeTitle } from "../../pipeline/normalize";
import { fetchArticle } from "../../pipeline/article";
import { fetchTranscript, videoIdOf } from "../../pipeline/youtube";
import { syntheticUrl, titleOf, type Drop } from "./drops";

/**
 * Черновики постов: что предложили и что он взял.
 *
 * Хранятся все варианты, а не только выбранный. Выбор между двумя первыми
 * строками — единственный сигнал о его вкусе, который не стоит ничего,
 * а восстановить его задним числом нельзя: не сохранили в момент нажатия —
 * не узнаем никогда.
 *
 * Рядом ложится `taken_text` — то, что он скопировал после своих правок.
 * Разница между нашим черновиком и его правкой — самый сильный сигнал
 * из всех доступных, и получить его больше негде: опубликованный пост
 * в канале нам ещё искать, а эту разницу браузер отдаёт сам.
 *
 * reader_id первым аргументом в каждом запросе. Пост — персональная вещь
 * в общей базе, и запрос без читателя вернул бы чужой черновик его голосом:
 * вовремя, без ошибок и совершенно не тот.
 */

export type SavedDraft = Draft & { id: number };

/**
 * Материал для поста — из выпуска этого читателя, а не из общей `items`.
 *
 * reader_id здесь не формальность, а сама проверка права: материал, которого
 * ему не показывали, постом не становится. Запрос без читателя отдал бы
 * соседний выпуск — вовремя, без ошибок и совершенно не тот.
 *
 * Заголовок и описание берутся из `digest_items`: они уже его языком и его
 * манерой, а в `items` лежит оригинал. Пост по оригиналу вышел бы на языке
 * источника у читателя, который читает по-русски.
 */
export async function postSourceFor(
  readerId: number,
  itemId: number,
): Promise<PostSource | undefined> {
  const [item] = await sql<PostSource[]>`
    select i.id::int as id, coalesce(di.title, i.title) as title,
           coalesce(di.summary, '') as summary, coalesce(i.excerpt, '') as excerpt,
           i.url, s.label as source_label
      from dailynews.digest_items di
      join dailynews.digests d on d.id = di.digest_id
      join dailynews.items i on i.id = di.item_id
      join dailynews.sources s on s.id = i.source_id
     where d.reader_id = ${readerId} and di.item_id = ${itemId}
     order by d.day desc
     limit 1
  `;
  return item;
}

export async function saveDrafts(
  readerId: number,
  itemId: number,
  drafts: Draft[],
): Promise<SavedDraft[]> {
  if (drafts.length === 0) return [];
  const rows = await sql<{ id: number; network: string; variant: number }[]>`
    insert into dailynews.reader_posts ${sql(
      drafts.map((draft) => ({
        reader_id: readerId,
        item_id: itemId,
        network: draft.network,
        variant: draft.variant,
        text: draft.text,
      })),
    )}
    returning id::int as id, network, variant
  `;
  // Возвращается тот же порядок, что пришёл: клиент показывает варианты
  // по сети и варианту, а не по номеру строки в базе.
  return drafts.map((draft) => ({
    ...draft,
    id:
      rows.find((row) => row.network === draft.network && row.variant === draft.variant)?.id ?? 0,
  }));
}

/**
 * Он скопировал пост.
 *
 * Отметка ставится по id черновика и читателю вместе: id приходит из браузера,
 * и без читателя в условии чужой номер помечал бы чужую строку. `taken_text`
 * пишется только когда он правил текст — иначе в базе лежала бы копия того,
 * что и так лежит рядом.
 */
export async function takeDraft(
  readerId: number,
  postId: number,
  text: string,
): Promise<boolean> {
  const rows = await sql`
    update dailynews.reader_posts
       set taken_at = now(),
           taken_text = case when text = ${text} then null else ${text} end
     where id = ${postId} and reader_id = ${readerId}
    returning id
  `;
  return rows.length > 0;
}

/** Сколько постов он взял за сутки. Видно в интерфейсе рядом с расходом. */
export async function takenToday(readerId: number): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from dailynews.reader_posts
     where reader_id = ${readerId}
       and taken_at >= date_trunc('day', now())
  `;
  return row?.n ?? 0;
}

/**
 * Достать текст и завести материал. Возвращает то же, что `postSourceFor`
 * для новости из выпуска, — дальше путь общий.
 */
export async function dropSourceFor(drop: Drop): Promise<PostSource> {
  // Источник заводится здесь, а не миграцией: строка нового вида, лежащая
  // в базе, ломает повторное применение миграций — 0026 заново вешает свой
  // список видов, где `manual` ещё нет.
  const [source] = await sql<{ id: number }[]>`
    insert into dailynews.sources (kind, label, url, active)
    values ('manual', 'Свои входы', 'manual://drops', false)
    on conflict (kind, url) do update set label = excluded.label
    returning id::int as id
  `;

  let title: string;
  let excerpt: string;
  let url: string;

  if (drop.kind === "link") {
    const article = await fetchArticle(drop.url);
    if (!article.markdown) throw new Error("по ссылке не нашлось текста — пришли мысль словами");
    title = article.title || drop.url;
    excerpt = article.markdown;
    url = drop.url;
  } else if (drop.kind === "video") {
    const id = videoIdOf(drop.url);
    const transcript = id ? await fetchTranscript(id) : null;
    if (!transcript?.text) throw new Error("субтитров у ролика нет — перескажи мысль словами");
    title = drop.note || `Ролик ${id}`;
    excerpt = transcript.text;
    url = drop.url;
  } else {
    title = titleOf(drop.text);
    excerpt = drop.text;
    url = syntheticUrl(drop.kind, drop.text);
  }

  const note = "note" in drop && drop.note ? `\n\nПометка автора: ${drop.note}` : "";
  const body = `${excerpt}${note}`.slice(0, 20_000);

  const [item] = await sql<{ id: number }[]>`
    insert into dailynews.items (source_id, url, url_canon, title, title_norm, excerpt, published_at)
    values (${source.id}, ${url}, ${canonUrl(url)}, ${title}, ${normalizeTitle(title)}, ${body}, now())
    on conflict (url_canon) do update set excerpt = excluded.excerpt, title = excluded.title
    returning id::int as id
  `;

  return {
    id: item.id,
    title,
    summary: "",
    excerpt: body,
    url: drop.kind === "thought" || drop.kind === "post" ? "" : url,
    source_label: drop.kind === "post" ? "Пересланный пост" : "Свои входы",
  };
}
