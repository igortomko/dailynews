import "server-only";
import { sql } from "./db";
import { anyOf, HL_END, HL_OPTIONS, HL_START, SEARCH_CONFIG } from "./search";
import { isDay } from "./day";
import { stripHtml } from "../../pipeline/fetch";
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
  /**
   * Описание из фида. В карточке не показывается — нужно личным правилам:
   * исключение проверяется по тому же тексту, по которому шёл отбор,
   * плюс по написанному языком читателя. Текст статьи сюда не едет:
   * сорок статей на каждый показ ленты — это мегабайты ради проверки,
   * которую отбор уже сделал.
   */
  excerpt: string;
  title_ru: string | null;
  summary: string | null;
  summary_document?: unknown;
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
 *
 * Без осей: карточка читает из восьми одну — кликбейт, — а полный объект
 * ехал в браузер с каждой из пятидесяти карточек и весил треть полезной
 * нагрузки ленты (33 КБ из 91). Решение принимает сервер, в браузер уходит
 * ответ. Описание из фида по той же причине остаётся на сервере: его
 * читают только личные правила, и читают до отправки.
 *
 * `followed` — написание из списка «За чем следить», которое в материале
 * нашлось. Правило работает молча, в отборе, и без этой пометки читателю
 * неоткуда узнать, что оно вообще сработало.
 */
export type FeedCard = Omit<FeedItem, "axes" | "excerpt"> & {
  story: Publication[];
  clickbait: boolean;
  followed: string | null;
};

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
 *
 * День — уже проверенный `isDay` (`YYYY-MM-DD`), или null вместо
 * «последний». Проверять день по списку дней до запроса значило бы ждать
 * список, а потом ленту: два круга до базы вместо одного на каждом показе.
 * Страница сверяет день с тем же списком уже после и за день, за который
 * выпуска нет, спрашивает ещё раз.
 */
export async function getFeed(readerId: number, day: string | null): Promise<FeedItem[]> {
  // Проверка повторяется здесь, а не только у вызывающего: параметр назван
  // как в адресе, и однажды сюда придёт сырой — в каст к date он уйти не должен.
  const safeDay = isDay(day) ? day : null;
  const rows = await sql<(FeedItem & { rule_body: string | null })[]>`
    select i.id, i.url, i.title, i.excerpt, di.title as title_ru, di.summary, di.summary_document, i.image_url,
           case when exists(select 1 from dailynews.readers r
             where r.id=${readerId} and jsonb_array_length(r.exclude_rules)>0)
             then i.body end as rule_body,
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
     -- Один день, а не окно: лента листается датами, и смешивать выпуски
     -- значит показывать вчерашнее как сегодняшнее.
     --
     -- Каст обязателен: у нетипизированного параметра Postgres выбирает
     -- date - date -> integer вместо date - integer -> date. Null — последний
     -- выпуск этого читателя; сам день проверен до запроса (isDay), иначе
     -- «2026-02-31» из чужой ссылки ронял бы запрос вместо ленты.
     where d.reader_id = ${readerId}
       and d.day = coalesce(
         ${safeDay}::date,
         (select max(x.day) from dailynews.digests x where x.reader_id = ${readerId})
       )
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
  return rows.map(({ rule_body, ...row }) => ({
    ...row,
    excerpt: [row.excerpt, rule_body ? stripHtml(rule_body) : null].filter(Boolean).join("\n"),
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
 * половины сюжета обязаны находиться одним условием, под индексом
 * из 0041_story_index.sql.
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

export type ArchiveHit = {
  item_id: number;
  url: string;
  /** Заголовок из выпуска — его языком. Пустой бывает у старых строк. */
  title: string;
  /** Отрывок с метками подсветки: режется `highlight` из lib/search. */
  snippet: string;
  source_label: string;
  topic_label: string | null;
  day: string;
};

/**
 * Поиск по тому, что этому читателю уже присылали.
 *
 * Не архив интернета: только материалы его выпусков — отобранные из его
 * источников и написанные его языком. Поэтому первый аргумент читатель,
 * а не строка поиска: запрос без него отдал бы чужой выпуск вовремя,
 * без ошибок и совершенно не тот.
 *
 * Ищется сразу по двум текстам — по написанному для читателя
 * (`digest_items`) и по исходному (`items`). Одно без другого половинчато:
 * «uranium» стоит в заголовке источника, а «уран» — в описании выпуска,
 * и человек ищет тем словом, которое запомнил.
 *
 * Векторы хранимые: `digest_items.tsv` по заголовку и описанию выпуска
 * (словарём этого выпуска, `digest_items.ts_config`, миграция 0050)
 * и `items.tsv` по заголовку и анонсу источника (общим словарём, 0048);
 * оба считает Postgres при записи. Пока вектор считался на каждый запрос,
 * поиск стоил 50 мс на двухстах строках и рос линейно с архивом. Индекса
 * по-прежнему нет: запрос сужен читателем до его выпусков, это тысячи
 * строк, и сопоставление готовых векторов на них стоит микросекунды.
 *
 * Запрос разбирается дважды и каждый вектор сравнивается с запросом своего
 * словаря: описание — словарём выпуска, источник — общим. Разойдись словарь
 * вектора и запроса, запрос искал бы слова, которых в разобранном тексте
 * нет по построению. Отрывок режется словарём выпуска: описание в нём
 * главное, а совпадение в английском заголовке источника видно и так.
 */
async function found(readerId: number, query: string): Promise<ArchiveHit[]> {
  return sql<ArchiveHit[]>`
    with q as (select websearch_to_tsquery(${SEARCH_CONFIG}::regconfig, ${query}) as shared),
    hits as (
      select i.id::int as item_id, i.url,
             coalesce(nullif(di.title, ''), i.title) as title,
             v.doc as body,
             s.label as source_label,
             t.label as topic_label,
             d.day::text as day,
             di.ts_config, own.tsq,
             ts_rank_cd(di.tsv, own.tsq) + ts_rank_cd(i.tsv, q.shared) as rank
        from q
        join dailynews.digests d on d.reader_id = ${readerId}
        join dailynews.digest_items di on di.digest_id = d.id
        join dailynews.items i on i.id = di.item_id
        join dailynews.sources s on s.id = i.source_id
   left join dailynews.scores sc on sc.item_id = i.id
   left join dailynews.topics t on t.id = sc.topic_id
  -- Ищется по всему, отрывок режется из всего, кроме заголовка выпуска.
  --
  -- Разница ровно в нём, и она не косметическая с обеих сторон. Искать
  -- по заголовку источника обязательно: «uranium» стоит там, а «уран» —
  -- в описании. Резать отрывок из заголовка выпуска незачем: он и так
  -- стоит строкой выше, и совпадение в нём видно там — а в отрывке
  -- он выходил повторением самого себя, на каждой карточке.
  -- Запрос словарём этого выпуска: у каждой строки он свой.
  cross join lateral (select websearch_to_tsquery(di.ts_config, ${query}) as tsq) own
  cross join lateral (
               -- btrim обязателен: пустая колонка оставляет в склейке
               -- висячий пробел, а отрывок приходит без него — и проверка
               -- «до конца ли дочитано» становится всегда ложной. Многоточие
               -- при этом стоит на каждом отрывке и означает уже ничего.
               select btrim(concat_ws(' ', di.summary, i.title, i.excerpt)) as doc
             ) v
       where (di.tsv @@ own.tsq or i.tsv @@ q.shared)
         -- Скрытое пальцем вниз не возвращается и здесь: иначе «убрать
         -- из ленты» означало бы «убрать с одной страницы из двух».
         and not exists (
           select 1 from dailynews.reads r
            where r.item_id = i.id and r.reader_id = ${readerId} and r.event = 'down'
         )
       order by rank desc, d.day desc
       limit 40
    )
    -- Отрывок считается уже после отбора и предела: ts_headline разбирает
    -- текст заново на каждой строке, и считать его по всему архиву значит
    -- платить за то, чего никто не увидит.
    select item_id, url, title, source_label, topic_label, day,
           -- Многоточие ставится по краям, которых отрывок не достал.
           -- Без него вырезанный кусок начинается со строчной буквы
           -- и обрывается на полуслове — и читается как поломка, а не
           -- как цитата. Ставить его всегда — врать на тех отрывках,
           -- что начинаются с начала описания.
           case when left(e.body, length(m.plain)) = m.plain then '' else '…' end
             || h.snippet
             || case when right(e.body, length(m.plain)) = m.plain then '' else '…' end
             as snippet
      from hits e,
           lateral (
             select ts_headline(e.ts_config, e.body, e.tsq, ${HL_OPTIONS})
                      as snippet
           ) h,
           -- Тот же отрывок без меток: сравнивать с описанием надо текст,
           -- а не текст вперемешку с управляющими символами.
           lateral (
             select replace(replace(h.snippet, ${HL_START}, ''), ${HL_END}, '') as plain
           ) m
     order by e.rank desc, e.day desc
  `;
}

/**
 * Найденное и то, пришлось ли ослаблять запрос.
 *
 * Два захода, а не один: сначала все слова, и только если не нашлось
 * ничего — хотя бы одно. Обратный порядок утопил бы точное совпадение
 * в материалах, где сошлось одно слово из четырёх.
 */
export async function searchArchive(
  readerId: number,
  query: string,
): Promise<{ hits: ArchiveHit[]; loose: boolean }> {
  const strict = await found(readerId, query);
  if (strict.length > 0) return { hits: strict, loose: false };

  const loose = anyOf(query);
  if (!loose) return { hits: strict, loose: false };

  const hits = await found(readerId, loose);
  return { hits, loose: hits.length > 0 };
}

/**
 * Размер архива этого читателя. Стоит на пустом поиске вместо «введите
 * запрос»: «ищу по 340 материалам из 28 выпусков» отвечает на вопрос,
 * который возникает раньше, — есть ли вообще в чём искать.
 */
export async function archiveSize(readerId: number): Promise<{ items: number; days: number }> {
  const [row] = await sql<{ items: number; days: number }[]>`
    select count(*)::int as items, count(distinct d.day)::int as days
      from dailynews.digests d
      join dailynews.digest_items di on di.digest_id = d.id
     where d.reader_id = ${readerId}
       -- Скрытое пальцем вниз не ищется, значит и не считается: число
       -- стоит рядом со словами «искали по», и завышать его — врать
       -- ровно там, где оно и приведено как честный ответ.
       and not exists (
         select 1 from dailynews.reads r
          where r.item_id = di.item_id and r.reader_id = ${readerId} and r.event = 'down'
       )
  `;
  return row ?? { items: 0, days: 0 };
}

