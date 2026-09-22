import "server-only";
import { sql } from "./db";
import { anyOf, HL_END, HL_OPTIONS, HL_START, SEARCH_CONFIG } from "./search";
import { FEED_DAYS_MAX, isDay } from "./day";
import { stripHtml } from "../../pipeline/fetch";
import { WEEK_DAYS, type Issue } from "../../pipeline/kindle";
import { parseStoredReading } from "./reading-document";
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
   * Озвучка этой карточки уже готова.
   *
   * Приходит с сервера, а не живёт в памяти вкладки: без этого перезагрузка
   * теряла кнопку «слушать», и нажатие озвучивало заново то, что уже лежит
   * в Telegram, — второй раз тратя квоту на ту же минуту звука.
   */
  voiced: boolean;
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
 *
 * `days` — окно, растущее назад от этого дня: пропустил три дня, выбрал
 * их в календаре и получил одну ленту вместо трёх. Повторов между днями
 * быть не может — отбор исключает уже уходившее по сюжету
 * (`coalesce(dup_of, id)` в `pipeline/select.ts`), а не по материалу.
 *
 * `maxChars` — заказ времени, переведённый в знаки (`charsForMinutes`).
 * Режется в самом запросе оконной суммой, а не фильтром в браузере: пять
 * дней по сорок карточек — это впятеро больший HTML ровно у того, кто
 * просил десять минут. `cut` — сколько карточек осталось за отсечкой:
 * молча показать шесть из сорока значит выдать часть выпуска за выпуск.
 *
 * `chars` — длина показанного, той же меркой, какой считает отсечку сам
 * запрос. Складывать её потом в браузере значило бы завести вторую формулу
 * одного числа: у карточки без перевода заголовок в базе пуст, и «время
 * показанного» разошлось бы с тем, по чему резали.
 */
export async function getFeed(
  readerId: number,
  day: string | null,
  { days = 1, maxChars = null }: { days?: number; maxChars?: number | null } = {},
): Promise<{ items: FeedItem[]; cut: number; chars: number }> {
  // Проверка повторяется здесь, а не только у вызывающего: параметр назван
  // как в адресе, и однажды сюда придёт сырой — в каст к date он уйти не должен.
  const safeDay = isDay(day) ? day : null;
  // Прижимается здесь, а не только у адреса: запрос зовут ещё книга Kindle
  // и проверки, и окно в тысячу дней стоило бы страницы, а не ошибки.
  const span = Number.isInteger(days) ? Math.min(FEED_DAYS_MAX, Math.max(1, days)) : 1;
  const limit = typeof maxChars === "number" && maxChars > 0 ? Math.round(maxChars) : null;
  const rows = await sql<
    (FeedItem & {
      rule_body: string | null;
      card_chars: number;
      before_chars: string | null;
      window_cards: string;
    })[]
  >`
    -- Якорь считается один раз: подставленный в два условия подзапрос
    -- за максимальным днём выполнялся бы дважды на каждый показ ленты.
    with anchor as (
      select coalesce(
        ${safeDay}::date,
        (select max(x.day) from dailynews.digests x where x.reader_id = ${readerId})
      ) as day
    ),
    cards as (
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
                      and ks.status in ('queued', 'sent')) as kindled,
           exists (select 1 from dailynews.card_audio ca
                    where ca.digest_id = d.id and ca.item_id = i.id) as voiced,
           -- Ровно та же сумма, что в digestProgress и в cardChars:
           -- заголовок и описание, без разделителя. Разойдись они — заказ
           -- считался бы одним числом, а показанное время другим.
           (char_length(coalesce(di.title, '')) + char_length(coalesce(di.summary, ''))) as card_chars
      from dailynews.digests d
      join dailynews.digest_items di on di.digest_id = d.id
      join dailynews.items i on i.id = di.item_id
      join dailynews.scores sc on sc.item_id = i.id
      join dailynews.sources s on s.id = i.source_id
 left join dailynews.topics t on t.id = sc.topic_id
     cross join anchor a
     -- Окно, а не равенство дню: якорь плюс длина назад. Смешивать выпуски
     -- можно ровно потому, что день назван на самой карточке, — без подписи
     -- вчерашнее читалось бы как сегодняшнее.
     --
     -- Каст обязателен: у нетипизированного параметра Postgres выбирает
     -- date - date -> integer вместо date - integer -> date. Null вместо дня —
     -- последний выпуск этого читателя; сам день проверен до запроса (isDay),
     -- иначе «2026-02-31» из чужой ссылки ронял бы запрос вместо ленты.
     where d.reader_id = ${readerId}
       and d.day <= a.day
       and d.day > a.day - ${span}::int
       -- Скрытое рукой не возвращается: иначе палец вниз означал бы
       -- «скрыть до перезагрузки страницы».
       and not exists (
         select 1 from dailynews.reads r
          where r.item_id = i.id and r.reader_id = ${readerId} and r.event = 'down'
       )
       -- Карточка без проверенной выжимки — не карточка. Прогон её больше
       -- и не сохраняет, но выпуски, собранные до этого, держат заглушки
       -- «подготовить не удалось»: отбор, прогресс выпуска и догрузка
       -- их уже не считают, и лента не должна быть единственным местом,
       -- где они видны.
       and coalesce(di.summary_document->>'status', 'verified') <> 'unavailable'
    )
    -- Оконная сумма стоящих ПЕРЕД карточкой, а не вместе с ней: первая
    -- проходит всегда (перед ней ноль), и выпуск с одной длинной карточкой
    -- не оборачивается пустой лентой. Та же спецификация — fitCards,
    -- и их равенство проверяет npm run verify:db.
    --
    -- i.id вторым в порядке: при равном скоре порядок окна и порядок
    -- выдачи обязаны совпадать, иначе отсечка режет не тот хвост.
    -- window_cards считается внутри подзапроса, а не снаружи: WHERE
    -- отрабатывает раньше оконных функций своего уровня, и счёт, взятый
    -- рядом с отсечкой, посчитал бы ровно то, что после неё осталось.
    select *
      from (
        select *,
               count(*) over () as window_cards,
               sum(card_chars) over (
                 order by total desc, id
                 rows between unbounded preceding and 1 preceding
               ) as before_chars
          from cards
      ) counted
     where ${limit}::int is null or coalesce(before_chars, 0) < ${limit}::int
     order by total desc, id
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
  // Служебные колонки снимаются с карточки здесь: длина и оконная сумма
  // нужны были запросу, а в браузер ехать им незачем.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- снимаются с карточки, а не читаются
  const items = rows.map(({ rule_body, card_chars, before_chars, window_cards, ...row }) => ({
    ...row,
    excerpt: [row.excerpt, rule_body ? stripHtml(rule_body) : null].filter(Boolean).join("\n"),
    id: Number(row.id),
    source_id: Number(row.source_id),
    axes: typeof row.axes === "string" ? JSON.parse(row.axes) : row.axes,
  }));
  // Счёт окна приезжает из bigint строкой, как и id. Пустое окно — ноль
  // отрезанных, а не NaN: строка над лентой считается из этого числа.
  const inWindow = rows.length > 0 ? Number(rows[0].window_cards) : 0;
  return {
    items,
    cut: Math.max(0, inWindow - items.length),
    chars: rows.reduce((sum, row) => sum + Number(row.card_chars), 0),
  };
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
 *
 * Знаки идут вторым числом того же запроса, а не вторым кругом до базы:
 * из них считается, сколько заняло бы просмотреть весь поток, а значит
 * и сколько времени лента сняла. Сумма та же, что у карточки выпуска
 * (`cardChars`), — заголовок и анонс, всё, что читатель прошёл бы глазами
 * в своей читалке.
 */
/**
 * Два числа, без которых предложение тарифа врёт: сколько собрали его
 * источники за сутки и читает ли он ленту вообще.
 *
 * Одним запросом и вместе с сюжетами карточек, а не своим кругом до базы:
 * соединений в пуле пять, а лента и так спрашивает шесть раз. Оба числа
 * нужны одному и тому же решению (`upgradeReason`), и разъехаться они
 * не должны.
 *
 * Активность — открытия, а не показы. Показ значит «пролистал мимо»:
 * у единственного внешнего читателя на 22 сентября 2026 было восемь показов
 * и ноль открытий, и предлагать ему платный тариф значило бы продавать то,
 * чего он ещё не читал.
 */
export async function getUpgradeFacts(
  readerId: number,
  sourceIds: number[],
): Promise<{ collected: number; active: boolean; sources: number; topics: number }> {
  const [row] = await sql<{ collected: number; active: boolean; sources: number; topics: number }[]>`
    select
      (select count(*)::int from dailynews.items
        where collected_at >= now() - interval '24 hours'
          and source_id = any(${sourceIds.length ? sourceIds : [0]}::bigint[])) as collected,
      exists (select 1 from dailynews.reads
               where reader_id = ${readerId}
                 and event in ('opened', 'outbound')
                 and at > now() - interval '7 days') as active,
      (select count(*)::int from dailynews.reader_sources rs
         join dailynews.sources s on s.id = rs.source_id
        where rs.reader_id = ${readerId} and s.deleted_at is null) as sources,
      (select count(*)::int from dailynews.reader_topics where reader_id = ${readerId}) as topics
  `;
  return {
    collected: row?.collected ?? 0,
    active: row?.active ?? false,
    sources: row?.sources ?? 0,
    topics: row?.topics ?? 0,
  };
}

export async function getCollectedLast24h(
  sourceIds: number[],
): Promise<{ count: number; chars: number }> {
  if (sourceIds.length === 0) return { count: 0, chars: 0 };
  const [row] = await sql<{ n: number; chars: number }[]>`
    select count(*)::int as n,
           coalesce(sum(
             char_length(coalesce(title, '')) + char_length(coalesce(excerpt, ''))
           ), 0)::int as chars
      from dailynews.items
     where collected_at >= now() - interval '24 hours'
       and source_id = any(${sourceIds}::bigint[])
  `;
  return { count: row?.n ?? 0, chars: row?.chars ?? 0 };
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
         -- Заглушка «выжимку подготовить не удалось» не карточка и в ленте:
         -- найтись в поиске она может только собой, и это не ответ.
         and coalesce(di.summary_document->>'status', 'verified') <> 'unavailable'
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
       and coalesce(di.summary_document->>'status', 'verified') <> 'unavailable'
  `;
  return row ?? { items: 0, days: 0 };
}

/**
 * Выпуски недели для книги: семь дней по сегодняшний включительно.
 *
 * Читателем первым аргументом, как всякий запрос о содержимом: без него
 * книга придёт вовремя, целой и с чужими выпусками. Дни — от старого
 * к новому, карточки внутри дня — в порядке отбора, тем же `total desc`,
 * что и в ленте: книга обязана совпадать с тем, что читатель видел.
 *
 * Скрытое пальцем вниз в книгу не едет: «убрать из ленты» не может означать
 * «убрать с одного экрана из двух». Заглушки несобравшихся карточек — тоже,
 * по той же причине, по которой их не показывает лента.
 */
export async function weekIssues(readerId: number, endDay: string): Promise<Issue[]> {
  const rows = await sql<{
    day: string;
    intro: string;
    title: string;
    summary: string;
    summary_document: unknown;
    url: string;
    source_label: string;
    topic_label: string;
  }[]>`
    select d.day::text as day, d.intro,
           di.title, di.summary, di.summary_document,
           i.url, s.label as source_label,
           coalesce(t.label, '') as topic_label
      from dailynews.digests d
      join dailynews.digest_items di on di.digest_id = d.id
      join dailynews.items i on i.id = di.item_id
      join dailynews.sources s on s.id = i.source_id
 left join dailynews.scores sc on sc.item_id = i.id
 left join dailynews.topics t on t.id = sc.topic_id
     -- Каст обязателен: у нетипизированного параметра Postgres выбирает
     -- date - date -> integer вместо date - integer -> date.
     where d.reader_id = ${readerId}
       and d.day <= ${endDay}::date
       and d.day > ${endDay}::date - ${WEEK_DAYS}::int
       and coalesce(di.summary_document->>'status', 'verified') <> 'unavailable'
       and not exists (
         select 1 from dailynews.reads r
          where r.item_id = i.id and r.reader_id = ${readerId} and r.event = 'down'
       )
     order by d.day asc, di.total desc
  `;

  const byDay = new Map<string, Issue>();
  for (const row of rows) {
    const issue = byDay.get(row.day) ?? { day: row.day, intro: row.intro, articles: [] };
    issue.articles.push({
      title: row.title,
      summary: row.summary,
      reading: parseStoredReading(row.summary_document) ?? undefined,
      url: row.url,
      source_label: row.source_label,
      topic_label: row.topic_label,
    });
    byDay.set(row.day, issue);
  }
  return [...byDay.values()];
}
