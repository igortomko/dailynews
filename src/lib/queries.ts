import "server-only";
import { sql } from "./db";
import type { SourceYield } from "./source-health";
import type { Axes, Source } from "./types";
import type { Publication } from "./story";

/**
 * Запросы ленты. У каждого первым аргументом идёт читатель, и это не
 * формальность: запрос без reader_id в общей базе отдаёт чужой выпуск —
 * вовремя, без ошибок и совершенно не тот.
 *
 * Обязательный параметр, а не «текущий читатель» внутри: забыть передать
 * его нельзя, компилятор не даст. Внутри бы забылось однажды и молча.
 */
export type FeedItem = {
  id: number;
  url: string;
  title: string;
  title_ru: string | null;
  summary: string | null;
  image_url: string | null;
  source_label: string;
  /** Нужен сюжету: источник, повторивший сам себя, — не «ещё один источник». */
  source_id: number;
  topic_slug: string | null;
  topic_label: string | null;
  total: number;
  confidence: number;
  axes: Axes;
  day: string;
  /**
   * Время самого материала, а не день выпуска. Раньше карточка показывала
   * `day`, и это был отказ, похожий на успех: дата есть, выглядит свежей,
   * но у всех материалов выпуска она одна и та же и отсчитывается от полудня
   * того дня. В ленте за сегодня все двенадцать карточек честно писали «1ч»,
   * хотя внутри лежали материалы возрастом от суток до недели.
   */
  published_at: Date;
  read_count: number;
  /**
   * Уехал ли материал на читалку. Состояние жило только в карточке:
   * перезагрузка теряла его, кнопка снова предлагала отправить, а повтор
   * ловил 409 от частичного индекса — отказ там, где всё было сделано.
   * Провалившуюся отправку сюда не считаем: её повторить можно и нужно.
   */
  kindled: boolean;
  /**
   * Попадался ли материал на глаза до этого захода. Лента идёт по убыванию
   * скора, а читают её сверху вниз — значит виденное лежит подряд с начала,
   * и граница между ним и остальным отвечает на «докуда я вчера дочитал».
   */
  seen: boolean;
};

/**
 * Карточка ленты вместе со своим сюжетом: материал и его повторы
 * в источниках этого читателя. Пустой сюжет — обычный случай: повтор
 * есть у единиц.
 */
export type FeedCard = FeedItem & { story: Publication[] };

export async function getSources(): Promise<Source[]> {
  return sql<Source[]>`
    select * from dailynews.sources where deleted_at is null order by kind, label
  `;
}


export type SourceHealth = Source & SourceYield & {
  /** Сколько дней подряд отвечает и не даёт ни одной свежей записи. */
  silent_days: number | null;
  mean_score: number | null;
};

/**
 * Источники вместе с тем, что от них было толку этому читателю.
 *
 * last_count отвечает только на вопрос «сколько дал вчера». Полезен ли
 * источник вообще — видно лишь в ряду: сколько материалов дал, сколько
 * из них дошло до его выпусков, сколько он из них увидел и открыл, какой
 * у них средний скор и какая доля оказалась перепечатками. Всё это уже
 * лежит в items, scores, digest_items и reads — новых данных не нужно.
 *
 * Все три личных числа считаются по reader_id, и это не формальность.
 * Состав выпуска лежит в digest_items на всех читателей сразу: без условия
 * по читателю «дошло до выпуска» означало бы «дошло до чьего-то выпуска»,
 * и источник, который отбор этому читателю не берёт ни разу, выглядел бы
 * тем полезнее, чем больше у ленты соседей.
 *
 * Окно в тридцать дней, иначе источник, заведённый вчера, выглядит хуже
 * того, что живёт в каталоге полгода. Условие по свежести стоит в join,
 * а не в where: иначе источник без единого материала выпал бы из списка
 * вместо того, чтобы показать ноль.
 */
export async function getSourceHealth(readerId: number): Promise<SourceHealth[]> {
  return sql<SourceHealth[]>`
    select s.*,
           case when s.silent_since is null then null
                else (current_date - s.silent_since::date)::int end as silent_days,
           count(i.id)::int as items,
           count(i.id) filter (where i.dup_of is not null)::int as duplicates,
           -- Через exists, а не join: у материала бывает несколько строк
           -- чтения и несколько выпусков, и join размножил бы строки —
           -- источник считался бы тем полезнее, чем чаще его открывали
           -- заново.
           count(i.id) filter (where exists (
             select 1 from dailynews.digest_items di
               join dailynews.digests d on d.id = di.digest_id
              where di.item_id = i.id and d.reader_id = ${readerId}
           ))::int as in_my_digests,
           count(i.id) filter (where exists (
             select 1 from dailynews.reads r
              where r.item_id = i.id and r.reader_id = ${readerId} and r.event = 'seen'
           ))::int as shown,
           count(i.id) filter (where exists (
             select 1 from dailynews.reads r
              where r.item_id = i.id and r.reader_id = ${readerId}
                and r.event in ('opened', 'outbound')
           ))::int as opened,
           round(avg(sc.total)::numeric, 1)::float as mean_score
      from dailynews.sources s
      -- Только свои: каталог общий, а список источников — это список того,
      -- из чего собирают выпуск этому читателю. Чужая строка здесь была бы
      -- ровно тем отказом, что выглядит как успех: список полон, убрать
      -- из него нечего, и в выпуске всё равно не то.
      join dailynews.reader_sources rs on rs.source_id = s.id and rs.reader_id = ${readerId}
      left join dailynews.items i
             on i.source_id = s.id
            and i.collected_at > now() - interval '30 days'
      left join dailynews.scores sc on sc.item_id = i.id
     where s.deleted_at is null
     group by s.id
     -- Порядок по вниманию, а не по алфавиту: в списке из тридцати строк
     -- сломанное обязано быть сверху. По kind наверх всплывали десять
     -- сабреддитов подряд, а источник с ошибкой лежал где-то в середине.
     order by (s.last_error is not null) desc,
              (s.silent_since is not null) desc,
              count(i.id) desc,
              s.label
  `;
}

/** Дни, за которые у этого читателя есть выпуск, от свежего к старому. */
export async function getDigestDays(readerId: number): Promise<string[]> {
  const rows = await sql<{ day: string }[]>`
    select day::text as day from dailynews.digests
     where reader_id = ${readerId}
     order by day desc limit 90
  `;
  return rows.map((row) => row.day);
}

/**
 * Лента: только то, что дошло до дайджеста этого читателя. Весь остальной
 * поток остаётся в items — он нужен калибровке и дедупу, но показывать его
 * незачем, иначе отбор теряет смысл.
 *
 * Заголовок и описание берутся из digest_items, а не из items: они написаны
 * языком, сложностью и манерой этого читателя.
 */
export async function getFeed(readerId: number, day: string): Promise<FeedItem[]> {
  const rows = await sql<FeedItem[]>`
    select i.id, i.url, i.title, di.title as title_ru, di.summary, i.image_url,
           s.label as source_label, s.id as source_id,
           t.slug as topic_slug, t.label as topic_label,
           di.total, sc.confidence, sc.axes,
           d.day::text as day,
           -- coalesce обязателен: у письма и части фидов своей даты нет,
           -- а без неё карточка осталась бы вовсе без времени.
           coalesce(i.published_at, i.collected_at) as published_at,
           (select count(*)::int from dailynews.reads r
             where r.item_id = i.id and r.reader_id = ${readerId}
               and r.event in ('opened', 'outbound')) as read_count,
           exists (select 1 from dailynews.reads r
                    where r.item_id = i.id and r.reader_id = ${readerId}
                      and r.event = 'seen') as seen,
           exists (select 1 from dailynews.kindle_sends ks
                    where ks.item_id = i.id and ks.reader_id = ${readerId}
                      and ks.status in ('queued', 'sent')) as kindled
      from dailynews.digests d
      join dailynews.digest_items di on di.digest_id = d.id
      join dailynews.items i on i.id = di.item_id
      join dailynews.scores sc on sc.item_id = i.id
      join dailynews.sources s on s.id = i.source_id
 left join dailynews.topics t on t.id = sc.topic_id
     -- Каст обязателен: у нетипизированного параметра Postgres выбирает
     -- date - date -> integer вместо date - integer -> date.
     -- Один день, а не окно: лента листается датами, и смешивать выпуски
     -- значит показывать вчерашнее как сегодняшнее.
     where d.reader_id = ${readerId}
       and d.day = ${day}::date
       -- Скрытое рукой не возвращается: иначе палец вниз означал бы
       -- «скрыть до перезагрузки страницы».
       and not exists (
         select 1 from dailynews.reads r
          where r.item_id = i.id and r.reader_id = ${readerId} and r.event = 'down'
       )
     order by di.total desc
  `;

  // Драйвер разбирает jsonb сам, но не во всех формах запроса отдаёт
  // ожидаемый OID колонки. Если axes придёт строкой, карточка молча
  // покажет прочерк вместо каждого бейджа — отказ, который не заметен.
  //
  // Number обязателен, хотя тип и обещает число: id и source_id — bigint,
  // и драйвер отдаёт их строкой. Сюжет карточки, разложенный по числовым
  // ключам, не находился ни разу — ни ошибки, ни пустого места, строка
  // «о том же написали» просто не появлялась. Приводим здесь, а не ::int
  // в запросе: каст сузил бы bigint до int4 и однажды уронил бы всю ленту
  // целиком, а глобальная подмена типа в драйвере уже ломала запись
  // («to: 20 шлёт int8 в колонки int»).
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    source_id: Number(row.source_id),
    axes: typeof row.axes === "string" ? JSON.parse(row.axes) : row.axes,
  }));
}

/**
 * Сюжеты для карточек ленты: что ещё выходило про то же самое.
 *
 * Ключ сюжета — coalesce(dup_of, id): у оригинала это он сам, у повтора —
 * его оригинал. Одним выражением, а не «оригинал или его повторы»: обе
 * половины сюжета обязаны находиться одним условием, под индексом 0040.
 *
 * Читатель здесь не отдельным аргументом, а списком его источников — тем же,
 * которым отбирается выпуск (`sourcesForPlan`). Это не послабление правила
 * про reader_id, а его же исполнение: изоляцию даёт именно этот список,
 * и взять его шире значило бы показать в «твоих источниках» чужие. Тариф
 * в нём уже учтён — ссылка на источник, выключенный понижением тарифа,
 * была бы предложением, на которое нельзя нажать.
 *
 * Один запрос на ленту, а не на карточку: сорок карточек — это сорок
 * обращений, и заметно это станет не на владельце.
 */
export async function getStories(
  sourceIds: number[],
  itemIds: number[],
): Promise<Map<number, Publication[]>> {
  const stories = new Map<number, Publication[]>();
  if (sourceIds.length === 0 || itemIds.length === 0) return stories;

  const rows = await sql<(Publication & { card_id: number })[]>`
    with cards as (
      -- Каст обязателен: items.id — bigint, а нетипизированный массив
      -- уходит в int и не совпадает ни с одной строкой.
      select id, coalesce(dup_of, id) as story_id
        from dailynews.items
       where id = any(${itemIds}::bigint[])
    )
    select c.id as card_id,
           p.id as item_id, p.url,
           p.source_id as source_id, s.label as source_label, s.kind,
           p.published_at, p.points
      from cards c
      join dailynews.items p on coalesce(p.dup_of, p.id) = c.story_id
      join dailynews.sources s on s.id = p.source_id
     where p.source_id = any(${sourceIds}::bigint[])
     order by c.id, p.id
  `;

  // Number на границе, как и в ленте: bigint приезжает строкой, а ключом
  // Map и слагаемым счётчика источников обязано быть число.
  for (const { card_id, ...publication } of rows) {
    const key = Number(card_id);
    const story = stories.get(key) ?? [];
    story.push({
      ...publication,
      item_id: Number(publication.item_id),
      source_id: Number(publication.source_id),
    });
    stories.set(key, story);
  }
  return stories;
}

export type SummaryQualityRow = {
  day: string;
  items: number;
  mean: number;
  repeats: number;
  relevant: number;
  evaluative: number;
};

/**
 * Качество описаний по дням. Смысл не в отдельном числе, а в ряду:
 * правка промпта либо двигает его, либо нет, и на глаз это не видно —
 * двенадцать описаний в день всегда читаются нормально.
 */
export async function getSummaryQuality(readerId: number): Promise<SummaryQualityRow[]> {
  return sql<SummaryQualityRow[]>`
    select d.day::text as day,
           count(*)::int as items,
           round(avg(di.summary_score)::numeric, 1)::float as mean,
           count(*) filter (where (di.summary_axes->'repeats_headline'->>'noul')::float > 0.5)::int as repeats,
           count(*) filter (where (di.summary_axes->'reader_relevance'->>'noul')::float > 0.5)::int as relevant,
           count(*) filter (where (di.summary_axes->'evaluative'->>'noul')::float > 0.5)::int as evaluative
      from dailynews.digests d
      join dailynews.digest_items di on di.digest_id = d.id
     where d.reader_id = ${readerId}
       and di.summary_score is not null
     group by d.day
     order by d.day desc
     limit 21
  `;
}

export type CalibrationRow = {
  bucket: string;
  shown: number;
  opened: number;
  open_rate: number;
};

/**
 * Калибровка: сравнение того, что система считала важным, с тем, что
 * действительно открывали. Высокий скор без открытий означает, что ось
 * подобрана неверно, а не что читатель ленивый.
 *
 * Скор берётся из digest_items — снимок на момент отбора его весами.
 * Взять текущий было бы сравнением с числом, которого читатель не видел.
 */
export async function getCalibration(readerId: number): Promise<{
  byScore: CalibrationRow[];
  byConfidence: CalibrationRow[];
  byAxis: { axis: string; value: string; shown: number; opened: number; open_rate: number }[];
  totals: { shown: number; opened: number; days: number };
}> {
  const shown = sql`
    select i.id, di.total, sc.confidence, sc.axes,
           exists (
             select 1 from dailynews.reads r
              where r.item_id = i.id and r.reader_id = ${readerId}
                and r.event in ('opened', 'outbound')
           ) as was_opened
      from dailynews.digests d
      join dailynews.digest_items di on di.digest_id = d.id
      join dailynews.items i on i.id = di.item_id
      join dailynews.scores sc on sc.item_id = i.id
     where d.reader_id = ${readerId}
  `;

  const byScore = await sql<CalibrationRow[]>`
    with shown as (${shown})
    select width_bucket(total, 0, 140, 7)::text as bucket,
           count(*)::int as shown,
           count(*) filter (where was_opened)::int as opened,
           round(avg(case when was_opened then 1 else 0 end)::numeric, 3)::float as open_rate
      from shown group by 1 order by 1
  `;

  const byConfidence = await sql<CalibrationRow[]>`
    with shown as (${shown})
    select width_bucket(confidence, 0, 1, 5)::text as bucket,
           count(*)::int as shown,
           count(*) filter (where was_opened)::int as opened,
           round(avg(case when was_opened then 1 else 0 end)::numeric, 3)::float as open_rate
      from shown group by 1 order by 1
  `;

  const byAxis = await sql<{ axis: string; value: string; shown: number; opened: number; open_rate: number }[]>`
    with shown as (${shown}),
    unpacked as (
      select 'тип' as axis, axes->'kind'->>'choice' as value, was_opened from shown
      union all
      select 'горизонт', axes->'horizon'->>'choice', was_opened from shown
      union all
      select 'тема', axes->'topic'->>'choice', was_opened from shown
      union all
      select 'новизна', round((axes->'novelty'->>'score')::numeric, 0)::text, was_opened from shown
      union all
      select 'конкретика', round((axes->'specifics'->>'score')::numeric, 0)::text, was_opened from shown
    )
    select axis, value,
           count(*)::int as shown,
           count(*) filter (where was_opened)::int as opened,
           round(avg(case when was_opened then 1 else 0 end)::numeric, 3)::float as open_rate
      from unpacked
     where value is not null
     group by axis, value
    having count(*) >= 3
     order by axis, open_rate desc
  `;

  const [totals] = await sql<{ shown: number; opened: number; days: number }[]>`
    with shown as (${shown})
    select count(*)::int as shown,
           count(*) filter (where was_opened)::int as opened,
           (select count(*)::int from dailynews.digests where reader_id = ${readerId}) as days
      from shown
  `;

  return { byScore, byConfidence, byAxis, totals };
}

/**
 * Сколько вышло за сутки у источников этого читателя — число для картинки
 * на «О проекте».
 *
 * Настоящее, а не круглое: «около трёхсот» рядом с реальными двенадцатью —
 * это иллюстрация, и в день, когда поток просел вдвое, она врёт молча.
 *
 * Сбор общий на всех, а опрашивается по тарифу лишь часть каталога
 * (`sourcesForPlan`), поэтому список источников передаётся снаружи: счёт
 * по всему каталогу завысил бы число у всякого, кто не на Pro, — и подпись
 * «у твоих источников» стала бы неправдой.
 */
export async function getCollectedLast24h(sourceIds: number[]): Promise<number> {
  if (sourceIds.length === 0) return 0;
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from dailynews.items
     where collected_at >= now() - interval '24 hours'
       and source_id = any(${sourceIds}::bigint[])
  `;
  return row?.n ?? 0;
}

/**
 * Чужие источники, которые уже кормят эти темы.
 *
 * Считается по собранному: сколько материалов источник дал по этим темам
 * за месяц. Это не рейтинг «хороших» источников вообще — это ответ на «кто
 * пишет о том, что ты выбрал», и он взрослеет вместе с каталогом сам,
 * без второго списка, который кто-то должен поддерживать руками.
 *
 * Своих в ответе нет: предлагать взять то, что уже взято, — это предложение,
 * на которое нельзя нажать.
 */
export async function catalogFor(
  readerId: number,
  topicSlugs: string[],
  kinds: string[],
  limit = 12,
): Promise<{ id: number; kind: string; label: string; url: string; items: number }[]> {
  if (topicSlugs.length === 0 || kinds.length === 0) return [];
  return sql<{ id: number; kind: string; label: string; url: string; items: number }[]>`
    select s.id::int as id, s.kind, s.label, s.url, count(distinct i.id)::int as items
      from dailynews.sources s
      join dailynews.items i on i.source_id = s.id
           and i.collected_at > now() - interval '30 days' and i.dup_of is null
      join dailynews.scores sc on sc.item_id = i.id
      join dailynews.topics t on t.id = sc.topic_id and t.slug = any(${topicSlugs})
     where s.deleted_at is null
       -- Виды тарифа: X платный, и предлагать его бесплатному читателю
       -- значит показать кнопку, которая откажет после нажатия.
       and s.kind = any(${kinds})
       and not exists (
         select 1 from dailynews.reader_sources rs
          where rs.source_id = s.id and rs.reader_id = ${readerId}
       )
     group by s.id
     -- distinct обязателен и здесь, и в порядке: материал, попавший сразу
     -- в две выбранные темы, join отдаёт дважды, и «12 материалов за месяц»
     -- превращается в двадцать четыре.
     order by count(distinct i.id) desc, s.label
     limit ${limit}
  `;
}
