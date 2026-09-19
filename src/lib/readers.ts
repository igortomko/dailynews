import { sql } from "./db";
import type { Reader, ReaderChannel, ReaderTopic, Source, Topic, VoiceCardRow } from "./types";
import { kindleSenderName } from "./kindle-setup";

/**
 * Всё, что знает о читателях. Живёт отдельно от queries.ts, потому что нужно
 * и конвейеру, и вебу: queries.ts помечен server-only и в конвейер не ходит.
 *
 * Ни одна выборка здесь не обходится без reader_id. Запрос без него в общей
 * ленте — это чужие данные, показанные вовремя и без единой ошибки в логе.
 */
/**
 * Колонки перечислены здесь, а `select *` не используется: часть из них
 * приходится приводить (bigint отдаётся строкой), и звёздочка тащила бы
 * заодно `llm`, который не читает никто.
 *
 * Цена такого списка: колонка, заведённая миграцией и прочитанная кодом,
 * но забытая здесь, приходит как `undefined` — и молча. Так и вышло
 * с подпиской: 0029 завела `subscription_status` и `plan_ends_at`,
 * `effectivePlan` их читает, а список остался прежним — платящий читатель
 * считался бесплатным и в вебе, и в прогоне. Ни ошибки, ни предупреждения:
 * тариф просто не работал. Поэтому `npm run verify:db` сверяет этот список
 * с колонками живой таблицы.
 */
const COLUMNS = sql`
  id::int as id, telegram_id::text as telegram_id, username, owner,
  reader_context, digest_size, weights, language, complexity, style,
  kindle_address, kindle_sender, kindle_digest, kindle_approved,
  plan, daily_cap_usd, onboarded_at,
  subscription_id, subscription_status, plan_renews_at, plan_ends_at, portal_url,
  paused_at, sleep_asked_at, resume_at,
  bio, suggested_topics, channel_checked_at::text as channel_checked_at,
  voice_card, voice_built_at, voice_sample
`;

export async function getReader(id: number): Promise<Reader | undefined> {
  const [reader] = await sql<Reader[]>`
    select ${COLUMNS} from dailynews.readers where id = ${id}
  `;
  return reader;
}

/** Все читатели прогона. Порядок по id: у выпуска должен быть один и тот же
 *  хозяин от прогона к прогону, даже когда кто-то переименовался. */
export async function allReaders(): Promise<Reader[]> {
  return sql<Reader[]>`select ${COLUMNS} from dailynews.readers order by id`;
}

export async function getReaderTopics(readerId: number): Promise<ReaderTopic[]> {
  return sql<ReaderTopic[]>`
    select t.id::int as id, t.slug, t.label, t.hint, rt.weight, rt.position
      from dailynews.reader_topics rt
      join dailynews.topics t on t.id = rt.topic_id
     where rt.reader_id = ${readerId}
     order by rt.position, t.id
  `;
}

/**
 * Темы, которые уходят в вопрос Jev. Не весь каталог, а те, что кому-то
 * нужны: заброшенная тема удлиняет промпт на каждом материале потока
 * и добавляет варианту шанс поймать чужое.
 */
export async function topicsInUse(): Promise<Topic[]> {
  return sql<Topic[]>`
    select t.id::int as id, t.slug, t.label, t.hint, t.weight, t.position, t.active
      from dailynews.topics t
     where exists (select 1 from dailynews.reader_topics rt where rt.topic_id = t.id)
     order by t.position, t.id
  `;
}

/** Каталог целиком — то, что предлагается читателю при настройке интересов. */
export async function catalogTopics(): Promise<Topic[]> {
  return sql<Topic[]>`
    select id::int as id, slug, label, hint, weight, position, active
      from dailynews.topics where active order by position, id
  `;
}

/**
 * Обратный адрес для Kindle. Замораживается не при выдаче, а при одобрении.
 *
 * Пока читатель не подтвердил, что добавил адрес в список одобренных Amazon,
 * менять его безопасно: он нигде не записан. После подтверждения смена
 * означает молчаливую потерю доставки — в Amazon останется одобренным
 * прежний, а новый будет отбрасываться без единой ошибки.
 *
 * Отсюда и перевыдача: строка, перенесённая из profile, пришла без Telegram,
 * и адрес достался запасной. Как только читатель привязывает аккаунт,
 * появляется его id, и до одобрения адрес пересобирается из него.
 *
 * Зовётся при заведении через /start и при сохранении адреса читалки.
 * Только первого не хватало — читатель, вписавший адрес до того, как написал
 * боту, оставался без отправителя, и доставка тихо пропускалась.
 */
export async function freezeKindleSender(
  id: number,
  telegramId: string | number | null,
): Promise<void> {
  const candidate = kindleSenderName(id, telegramId);
  try {
    await sql`
      update dailynews.readers set kindle_sender = ${candidate}
       where id = ${id}
         and not kindle_approved
         and kindle_sender is distinct from ${candidate}
    `;
  } catch {
    // Зовётся из входа через /start. Свалиться здесь значит не пустить
    // читателя в ленту из-за адреса, который он ещё даже не видел:
    // прежний адрес остаётся, и он рабочий.
  }
}

/**
 * Читатель по его Telegram. Здесь заводится тот, кто написал боту впервые.
 *
 * telegram_id сравнивается в SQL, а не в JS: из драйвера bigint приходит
 * строкой, и `"136" !== 136` не совпало бы ни разу — вход отказывал бы молча.
 */
export async function ensureReader(
  telegramId: number,
  username: string | null,
): Promise<Reader> {
  // Владелец забирает строку, перенесённую из profile: в ней его контекст,
  // веса и пройденный онбординг. Иначе он завёлся бы вторым читателем
  // с пустой лентой, а настроенная строка осталась бы ничьей.
  const ownerTelegramId = Number(process.env.TELEGRAM_CHAT_ID);
  if (Number.isSafeInteger(ownerTelegramId) && ownerTelegramId === telegramId) {
    await sql`
      update dailynews.readers
         set telegram_id = ${telegramId}, username = ${username}, updated_at = now()
       where owner and telegram_id is null
    `;
  }

  const [reader] = await sql<Reader[]>`
    insert into dailynews.readers (telegram_id, username)
    values (${telegramId}, ${username})
    on conflict (telegram_id) do update
      set username = excluded.username, updated_at = now()
    returning ${COLUMNS}
  `;

  if (!reader.kindle_sender) {
    await freezeKindleSender(reader.id, reader.telegram_id);
    return (await getReader(reader.id)) ?? reader;
  }
  return reader;
}

/** Потрачено на модель за сегодня. Потолок считается по читателю: вход
 *  бесплатный и мгновенный, и сто аккаунтов заводятся за вечер. */
export async function spentToday(readerId: number): Promise<number> {
  const [row] = await sql<{ spent: number }[]>`
    select coalesce(sum(cost_usd), 0)::float as spent
      from dailynews.model_calls
     where reader_id = ${readerId}
       and at >= date_trunc('day', now())
  `;
  return row?.spent ?? 0;
}

export type CallRecord = {
  readerId: number | null;
  stage:
    | "score" | "digest" | "summary" | "translate" | "translation-quality"
    | "video" | "interests"
    // Карточка автора и пост — такие же оплаченные вызовы, и потолок
    // читателя считается по той же таблице.
    | "voice" | "post" | "post-quality";
  model: string;
  tokensIn: number;
  tokensOut?: number;
  costUsd: number;
};

/**
 * Статьи, про которые ещё не спросили. Отдельной функцией, чтобы запрос
 * проверялся на настоящем Postgres (`npm run verify:db`): прошлая его
 * версия спрашивала несуществующую колонку и падала каждую ночь, а прогон
 * при этом отчитывался успехом.
 */
export async function pendingKindleAsks(readerId: number) {
  // Заголовок берётся из выпуска этого читателя, а не из общей items:
  // колонки items.title_ru не существует с тех пор, как тексты дайджеста
  // стали персональными, и запрос падал каждую ночь строкой в логе —
  // «дочитал?» не спрашивалось ни разу, а прогон при этом отчитывался
  // успехом. Своего заголовка в выпуске нет (статью отправили не из него) —
  // остаётся исходный.
  const pending = await sql<{ item_id: number; title: string }[]>`
    select ks.item_id,
           coalesce(
             (select di.title
                from dailynews.digest_items di
                join dailynews.digests d on d.id = di.digest_id
               where d.reader_id = ks.reader_id and di.item_id = ks.item_id
               order by d.day desc
               limit 1),
             i.title
           ) as title
      from dailynews.kindle_sends ks
      join dailynews.items i on i.id = ks.item_id
     where ks.reader_id = ${readerId}
       and ks.status = 'sent'
       and ks.at < now() - interval '12 hours'
       and ks.at > now() - interval '7 days'
       and not exists (
         select 1 from dailynews.reads r
          where r.reader_id = ks.reader_id and r.item_id = ks.item_id
            and r.event in ('finished', 'unfinished')
       )
     order by ks.at
     limit 3
  `;
  return pending;
}

/** Строка на каждый вызов модели. Без неё потолок нечем проверять,
 *  а перерасход виден только в счёте в конце месяца. */
export async function recordCall(call: CallRecord): Promise<void> {
  await sql`
    insert into dailynews.model_calls (reader_id, stage, model, tokens_in, tokens_out, cost_usd)
    values (
      ${call.readerId}, ${call.stage}, ${call.model},
      ${call.tokensIn}, ${call.tokensOut ?? 0}, ${call.costUsd}
    )
  `;
}

/**
 * Ответ на «дочитал?» из бота.
 *
 * Пишется select-ом из собственной отправки, а не значениями из апдейта:
 * нажатие приходит с telegram_id, и без этой связки чужой ответ лёг бы
 * в чужую калибровку. Скор — снимок из выпуска этого читателя, как
 * и у всех остальных событий чтения.
 */
export async function recordFinished(
  telegramId: number,
  itemId: number,
  finished: boolean,
): Promise<void> {
  await sql`
    insert into dailynews.reads (reader_id, item_id, event, score_snap, conf_snap)
    select r.id, ${itemId}, ${finished ? "finished" : "unfinished"}, di.total, sc.confidence
      from dailynews.readers r
      join dailynews.kindle_sends ks on ks.reader_id = r.id and ks.item_id = ${itemId}
      join dailynews.digest_items di on di.item_id = ks.item_id
      join dailynews.digests d on d.id = di.digest_id and d.reader_id = r.id
      join dailynews.scores sc on sc.item_id = ks.item_id
     where r.telegram_id = ${telegramId}::bigint and ks.status = 'sent'
     order by d.day desc
     limit 1
  `;
}

/**
 * Вернуть ленту спящему читателю.
 *
 * Снимается и пауза, и отметка вопроса: без второго следующая пауза
 * наступила бы молча, без нового вопроса — читатель решил бы, что лента
 * снова сломалась.
 */
export async function resumeReader(telegramId: number, afterDays = 0): Promise<void> {
  // Отпуск — это не уход: пауза остаётся, но у неё появляется дата конца,
  // и спрашивать второй раз не нужно.
  if (afterDays > 0) {
    await sql`
      update dailynews.readers
         set resume_at = now() + ${`${afterDays} days`}::interval, updated_at = now()
       where telegram_id = ${telegramId}
    `;
    return;
  }
  await sql`
    update dailynews.readers
       set paused_at = null, sleep_asked_at = null, resume_at = null, updated_at = now()
     where telegram_id = ${telegramId}
  `;
}

/** Лента вернулась сама: срок отпуска вышел. */
export async function wakeReader(readerId: number): Promise<void> {
  await sql`
    update dailynews.readers
       set paused_at = null, sleep_asked_at = null, resume_at = null, updated_at = now()
     where id = ${readerId}
  `;
}

/** Поставить на паузу и запомнить, что вопрос уже задан. */
export async function pauseReader(readerId: number): Promise<void> {
  await sql`
    update dailynews.readers
       set paused_at = now(), sleep_asked_at = now(), updated_at = now()
     where id = ${readerId}
  `;
}

/**
 * Когда читатель последний раз что-то делал в ленте.
 *
 * Событие любое, включая показ: карточка отмечается показанной только
 * при заходе на сайт, и это уже признак живого читателя. Telegram сюда
 * не считается — там пролистывание неотличимо от чтения.
 */
export async function lastActivityAt(readerId: number): Promise<string | null> {
  const [row] = await sql<{ at: string | null }[]>`
    select max(r.at)::text as at
      from dailynews.reads r
      join dailynews.digest_items di on di.item_id = r.item_id
      join dailynews.digests d on d.id = di.digest_id
     where d.reader_id = ${readerId}
  `;
  return row?.at ?? null;
}

/**
 * Площадки читателя: откуда берётся голос и куда он публикует.
 *
 * reader_id первым аргументом, как и во всех остальных запросах о содержимом:
 * список площадок без него — это чужие каналы, показанные без единой ошибки.
 */
export async function getChannels(readerId: number): Promise<ReaderChannel[]> {
  return sql<ReaderChannel[]>`
    select network, handle, input_url, label, created_at
      from dailynews.reader_channels
     where reader_id = ${readerId}
     order by created_at, network
  `;
}

/** Одна площадка на сеть: upsert, а не вставка — вторая ссылка заменяет первую. */
export async function saveChannel(
  readerId: number,
  network: string,
  channel: { handle?: string | null; input_url?: string | null; label?: string | null } = {},
): Promise<void> {
  await sql`
    insert into dailynews.reader_channels (reader_id, network, handle, input_url, label)
    values (
      ${readerId}, ${network},
      ${channel.handle ?? null}, ${channel.input_url ?? null}, ${channel.label ?? null}
    )
    on conflict (reader_id, network) do update
      -- Отмечает сеть галочкой тот же запрос, что добавляет канал ссылкой,
      -- и галочка не должна стирать разобранный адрес: coalesce оставляет
      -- прежнее, когда нового не принесли.
      set handle    = coalesce(excluded.handle, dailynews.reader_channels.handle),
          input_url = coalesce(excluded.input_url, dailynews.reader_channels.input_url),
          label     = coalesce(excluded.label, dailynews.reader_channels.label)
  `;
}

export async function deleteChannel(readerId: number, network: string): Promise<void> {
  await sql`
    delete from dailynews.reader_channels
     where reader_id = ${readerId} and network = ${network}
  `;
}

/**
 * Описание из Telegram и порядок стартовых интересов под него.
 *
 * Пишется один раз при заведении, пока читатель подписывается на канал.
 * Считать это при открытии первого экрана значило бы показать ему спиннер
 * ровно там, где он решает, стоит ли продолжать.
 */
export async function saveSuggestions(
  readerId: number,
  bio: string | null,
  slugs: string[],
): Promise<void> {
  await sql`
    update dailynews.readers
       set bio = ${bio}, suggested_topics = ${slugs}, updated_at = now()
     where id = ${readerId}
  `;
}

/** Проверку подписки на канал прошёл. Гейт стоит на входе и только там. */
export async function markChannelChecked(readerId: number): Promise<void> {
  await sql`
    update dailynews.readers
       set channel_checked_at = now(), updated_at = now()
     where id = ${readerId} and channel_checked_at is null
  `;
}

/**
 * Карточка автора кладётся объектом, а не строкой: `JSON.stringify` в jsonb
 * сохраняет строку, и `voice_card->'voice'` становится null молча (урок 0005).
 * Драйвер сам сериализует объект правильно, если не трогать его руками.
 */
export async function saveVoiceCard(readerId: number, card: VoiceCardRow): Promise<void> {
  await sql`
    update dailynews.readers
       set voice_card = ${sql.json(card as unknown as Parameters<typeof sql.json>[0])},
           voice_built_at = now(),
           updated_at = now()
     where id = ${readerId}
  `;
}

export async function saveVoiceSample(readerId: number, sample: string): Promise<void> {
  await sql`
    update dailynews.readers
       set voice_sample = ${sample}, updated_at = now()
     where id = ${readerId}
  `;
}

/**
 * Источники этого читателя.
 *
 * Каталог общий, выбор личный. До reader_sources «источники тарифа»
 * означали первые N строк каталога по id — один и тот же набор у всех,
 * и у второго читателя выпуск собирался из чужих источников: вовремя,
 * без ошибок и не из того, что он выбирал.
 *
 * Порядок по id: при понижении тарифа остаются заведённые раньше,
 * и набор не пляшет от прогона к прогону.
 */
export async function readerSources(readerId: number): Promise<Source[]> {
  return sql<Source[]>`
    select s.* from dailynews.sources s
      join dailynews.reader_sources rs on rs.source_id = s.id
     where rs.reader_id = ${readerId} and s.deleted_at is null
     order by s.id
  `;
}

/** Сколько источников у читателя сейчас: предел тарифа считается по ним. */
export async function countReaderSources(readerId: number): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from dailynews.reader_sources rs
      join dailynews.sources s on s.id = rs.source_id
     where rs.reader_id = ${readerId} and s.deleted_at is null
  `;
  return row?.n ?? 0;
}

/** Взять источник в свою ленту. Повторное добавление — не ошибка. */
export async function addReaderSource(readerId: number, sourceId: number): Promise<void> {
  await sql`
    insert into dailynews.reader_sources (reader_id, source_id)
    values (${readerId}, ${sourceId})
    on conflict (reader_id, source_id) do nothing
  `;
}

/**
 * Убрать источник из своей ленты.
 *
 * Строка связки, а не sources.deleted_at: каталог общий, и удаление
 * источника у себя не должно уносить его у соседа вместе с его историей.
 */
export async function removeReaderSource(readerId: number, sourceId: number): Promise<void> {
  await sql`
    delete from dailynews.reader_sources
     where reader_id = ${readerId} and source_id = ${sourceId}
  `;
}
