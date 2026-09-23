import { sql } from "./db";
import type { Reader, ReaderChannel, ReaderTopic, Source, Topic, VoiceCardRow } from "./types";
import { kindleSenderName } from "./kindle-setup";
import { normalizeEmail } from "./email";
import { DEFAULT_LOCALE, type Locale } from "./i18n/locale";
import { effectiveVoice } from "./lemon";
import { cardMinutes } from "./reading-time";
import type { Rules } from "./rules";
import { catalogTopic } from "./starter-topics";
import type { Sql, TransactionSql } from "postgres";

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
  reader_context, reading_v2_enabled, digest_minutes, weights, language, ui_language, complexity, style,
  kindle_address, kindle_sender, kindle_digest, kindle_approved, podcast,
  kindle_period, kindle_weekly_at::text as kindle_weekly_at,
  timezone, issue_day::text as issue_day,
  plan, daily_cap_usd, onboarded_at, created_at::text as created_at,
  subscription_id, subscription_status, plan_renews_at, plan_ends_at, portal_url,
  paused_at, sleep_asked_at, resume_at, upsell_at,
  bio, suggested_topics, channel_checked_at::text as channel_checked_at,
  voice_card, voice_built_at, voice_sample, voice_skill, voice_enabled,
  follow_rules, exclude_rules, source, email, email_digest, telegram_digest, entered_via
`;

export async function getReader(id: number): Promise<Reader | undefined> {
  const [reader] = await sql<Reader[]>`
    select ${COLUMNS} from dailynews.readers where id = ${id} and deleted_at is null
  `;
  return reader;
}

/** Все читатели прогона. Порядок по id: у выпуска должен быть один и тот же
 *  хозяин от прогона к прогону, даже когда кто-то переименовался. */
export async function allReaders(): Promise<Reader[]> {
  return sql<Reader[]>`select ${COLUMNS} from dailynews.readers where deleted_at is null order by id`;
}

export async function getReaderTopics(readerId: number): Promise<ReaderTopic[]> {
  // «Взял ли ещё кто-то» — exists по индексу reader_topics(topic_id) (0051):
  // одна проба на тему, выход на первом соседе. Соединение с bool_or собирало
  // бы строку на каждого держателя каждой моей темы — тем дольше, чем тема
  // популярнее, — а эта функция зовётся на каждого читателя каждым прогоном.
  return sql<ReaderTopic[]>`
    select t.id::int as id, t.slug, t.label, t.hint, rt.weight, rt.position,
           exists (
             select 1 from dailynews.reader_topics o
              where o.topic_id = rt.topic_id and o.reader_id <> rt.reader_id
           ) as shared
      from dailynews.reader_topics rt
      join dailynews.topics t on t.id = rt.topic_id
     where rt.reader_id = ${readerId}
     order by rt.position, t.id
  `;
}

/**
 * Тема в общем справочнике: своя правится, каталожная и общая — нет.
 *
 * Справочник один на всех: по нему Jev классифицирует поток один раз,
 * и название с подсказкой — критерий этой классификации. Переписав их
 * у темы из каталога или у темы, которую взял ещё кто-то, читатель менял бы
 * ленту соседям, и заметить это можно было бы только по съехавшим темам
 * чужих выпусков. До сих пор такая правка молча терялась: форма показывала
 * новую подсказку до перезагрузки, база хранила прежнюю — отказ, похожий
 * на успех. Теперь своя тема (заведена руками и никем больше не взята)
 * правится, у остальных форма поля не показывает, а сервер решает сам,
 * не веря форме.
 *
 * Каталожная тема берёт имя и подсказку из стартового набора, а не
 * от вызвавшего: в сиде лежат шесть тем из двадцати семи, остальные заводит
 * первый, кто их взял, — и без этого первый же читатель, набравший «Music»
 * руками, определял бы критерий классификации для всех своим именем
 * и пустой подсказкой, а поправить это потом было бы нечем.
 *
 * Правка от присоединения отличается связкой в базе. Тему, которую читатель
 * уже держит, он видел в форме вместе с подсказкой, и пустая подсказка —
 * стёртая им самим. К ничьей теме он присоединяется вслепую: новый чип
 * приходит без подсказки, и пустая сохранённую не стирает, а набранная
 * применяется. Убрал и добавил снова в одном заходе — связка ещё стоит,
 * и тема начинает с того, что в форме: чистого листа.
 *
 * Отдаёт id темы в любом случае: связка читателя с темой заводится по нему.
 */
export async function upsertTopic(
  db: Sql | TransactionSql,
  readerId: number,
  topic: { slug: string; label: string; hint: string; position: number },
): Promise<number> {
  const starter = catalogTopic(topic.slug);
  // Каталожная тема — из стартового набора, и уже заведённая тоже: строка,
  // набранная руками до каталога, держала бы чужой критерий вечно, а править
  // её нечем — у каталожной форма поля не показывает. У своей темы конфликт
  // ничего не меняет: её правит условие ниже.
  const catalog = starter !== undefined;
  const [row] = await db<{ id: number }[]>`
    insert into dailynews.topics as t (slug, label, hint, position)
    values (
      ${topic.slug}, ${starter?.label ?? topic.label}, ${starter?.hint ?? topic.hint},
      ${topic.position}
    )
    on conflict (slug) do update
       set label = case when ${catalog} then excluded.label else t.label end,
           hint = case when ${catalog} then excluded.hint else t.hint end
    returning id::int as id
  `;
  if (starter) return row.id;

  // Пустая подсказка — стёртая, если тему держу я, и не присланная, если
  // присоединяюсь к ничьей: новый чип приходит без неё. Решается в самом
  // запросе: отдельная проба «держу ли» стоила третий круг до базы на каждую
  // свою тему при записи формы.
  await db`
    update dailynews.topics t
       set label = ${topic.label},
           hint = case
             when ${topic.hint} = '' and not exists (
               select 1 from dailynews.reader_topics mine
                where mine.topic_id = t.id and mine.reader_id = ${readerId}
             ) then t.hint
             else ${topic.hint}
           end
     where t.id = ${row.id}
       and not exists (
         select 1 from dailynews.reader_topics o
          where o.topic_id = t.id and o.reader_id <> ${readerId}
       )
  `;
  return row.id;
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
  /**
   * Язык интерфейса из Telegram. Ставится только при заведении: читатель
   * мог выбрать другой в настройках, и перезаписывать его выбор тем,
   * что стоит у него в телефоне, — значит отменять решение без спроса.
   *
   * Тип, а не строка: в базе на колонке check по списку словарей, и
   * ненормализованный «en-US» уронил бы вставку вместо ошибки компиляции —
   * то есть не пустил бы читателя вовсе.
   */
  locale?: Locale,
  /**
   * Код размещения из `/start c_<код>`. Пишется только при заведении:
   * первое касание и есть источник, а вернувшийся по новой ссылке —
   * визит, не привлечение. Кода нет в реестре — источник остаётся
   * пустым: мусорная нагрузка не должна заводить в отчётах новый канал.
   */
  source?: string | null,
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
    insert into dailynews.readers (telegram_id, username, ui_language, source)
    values (${telegramId}, ${username}, ${locale ?? DEFAULT_LOCALE},
            (select code from dailynews.placements where code = ${source ?? null}::text))
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

/**
 * Читатель по почте: вход по ссылке из письма и через Google.
 *
 * Зовётся только с адресом, который уже подтверждён — кликом по ссылке или
 * ответом Google. Строка до подтверждения завела бы читателя на любой
 * чужой адрес, набранный в форму.
 *
 * Со строкой из Telegram не склеивается: у той почты нет, и один человек,
 * вошедший обоими путями, пока становится двумя читателями.
 */
export async function ensureEmailReader(
  email: string,
  locale?: Locale,
  /** Каким путём пришёл: пишется только при заведении, как и источник. */
  via: "email" | "google" = "email",
): Promise<Reader> {
  // Письмо включено сразу: у пришедшего по почте это единственное
  // направление, и без него выпуск не пришёл бы никуда.
  const [reader] = await sql<Reader[]>`
    insert into dailynews.readers (email, email_digest, ui_language, entered_via)
    values (${normalizeEmail(email)}, true, ${locale ?? DEFAULT_LOCALE}, ${via})
    on conflict (email) do update set updated_at = now()
    returning ${COLUMNS}
  `;
  if (!reader.kindle_sender) {
    await freezeKindleSender(reader.id, null);
    return (await getReader(reader.id)) ?? reader;
  }
  return reader;
}

/**
 * Привязать Telegram к читателю, пришедшему по почте.
 *
 * Номер читателя приходит из подписанной ссылки, которую выдала ему же
 * страница «Доставки», а telegram_id — из апдейта бота. Занятый Telegram
 * не переносится: у той строки своя лента, и молча отобрать её у одного
 * профиля ради другого значит потерять чью-то настройку.
 */
export async function attachTelegram(
  readerId: number,
  telegramId: number,
  username: string | null,
): Promise<"ok" | "same" | "taken" | "changed"> {
  const [owner] = await sql<{ id: number }[]>`
    select id::int as id from dailynews.readers where telegram_id = ${telegramId}
  `;
  if (owner) return owner.id === readerId ? "same" : "taken";
  // Поверх прежнего Telegram пишем: ссылку привязки выдаёт только сессия
  // этого читателя и живёт она десять минут, так что замена — его же
  // «Сменить аккаунт». Прежний аккаунт освобождается, а не зависает
  // между «отвязал» и «привязал».
  const [row] = await sql<{ had: boolean }[]>`
    update dailynews.readers r
       set telegram_id = ${telegramId}, username = ${username}, updated_at = now()
      from (select telegram_id is not null as had from dailynews.readers where id = ${readerId}) prev
     where r.id = ${readerId} and r.deleted_at is null
    returning prev.had
  `;
  if (!row) return "taken";
  return row.had ? "changed" : "ok";
}

/**
 * Отвязать Telegram — только при почте: иначе у профиля не остаётся входа.
 * Сменить аккаунт — это отвязать и привязать заново той же ссылкой бота:
 * `attachTelegram` поверх занятого не пишет.
 */
export async function detachTelegram(readerId: number): Promise<boolean> {
  const updated = await sql`
    update dailynews.readers set telegram_id = null, username = null, updated_at = now()
     where id = ${readerId} and email is not null
  `;
  return updated.count === 1;
}

/**
 * Почта, подтверждённая кликом по письму. Включает доставку письмом:
 * адрес добавляют, чтобы на него что-то приходило.
 */
export async function confirmEmail(readerId: number, email: string): Promise<"ok" | "taken"> {
  try {
    await sql`
      update dailynews.readers
         set email = ${normalizeEmail(email)}, email_digest = true, updated_at = now()
       where id = ${readerId} and deleted_at is null
    `;
    return "ok";
  } catch (error) {
    // unique на email: ящик уже вход другого профиля.
    if ((error as { code?: string }).code === "23505") return "taken";
    throw error;
  }
}

export async function setTelegramDigest(readerId: number, on: boolean): Promise<void> {
  await sql`update dailynews.readers set telegram_digest = ${on}, updated_at = now() where id = ${readerId}`;
}

export async function setEmailDigest(readerId: number, on: boolean): Promise<void> {
  await sql`update dailynews.readers set email_digest = ${on}, updated_at = now() where id = ${readerId}`;
}

/**
 * Убрать почту можно, только если есть Telegram: у вошедшего по почте
 * адрес — это вход, и без него в профиль больше не попасть.
 */
export async function removeEmail(readerId: number): Promise<boolean> {
  const updated = await sql`
    update dailynews.readers set email = null, email_digest = false, updated_at = now()
     where id = ${readerId} and telegram_id is not null
  `;
  return updated.count === 1;
}

/**
 * Мерка этого читателя в минутах: сколько времени занимает его карточка.
 *
 * Ею и прогон, и догрузка, и форма интересов переводят заказанные минуты
 * в число мест. Одной функцией, потому что зовётся она из трёх мест,
 * а собрана из двух личных вещей — его описаний и его голоса: три копии
 * этой сборки разъехались бы молча, и заказ считался бы по-разному
 * в форме и в прогоне.
 */
export async function perCardOf(reader: Reader): Promise<number> {
  return cardMinutes(await cardCharsOf(reader.id), effectiveVoice(reader));
}

/**
 * Что уже лежит в выпуске за день: сколько карточек, сколько в них знаков
 * и какой скор у лучшей.
 *
 * Одним запросом и одной функцией на обоих, кто дописывает выпуск, — ночной
 * прогон и кнопка догрузки. Считать «сколько осталось» двумя копиями значит
 * разойтись на первой же правке: одна копия дописывала бы поверх потолка,
 * и увидеть это можно было бы только в счёте.
 *
 * Знаки — чтобы вычесть из заказа уже прочитанное настоящим текстом,
 * а не оценкой. Лучший скор — чтобы порог «слабого» на догрузке отсчитывался
 * от того же места, что и ночью: пул кандидатов к вечеру беднеет, и порог,
 * привязанный к нему, пустил бы в выпуск ровно тех, кого ночью отверг.
 */
export type DigestProgress = {
  day: string | null;
  items: number;
  chars: number;
  best: number;
  /**
   * Сколько минут заказывали на этот день, или null у выпусков, которые
   * заказа не сохранили. Заказ лежит при выпуске, а не берётся из настроек:
   * настройки — это «сколько хочу сейчас», и мерить ими выпуск недельной
   * давности значит обещать задним числом. Неизвестен — молчим о недоборе.
   */
  target: number | null;
};

export async function digestProgress(
  readerId: number,
  day: string | null,
): Promise<DigestProgress> {
  const [row] = await sql<DigestProgress[]>`
    select d.day::text as day,
           (d.stats->>'reading_target')::float as target,
           count(di.*)::int as items,
           coalesce(sum(
             char_length(coalesce(di.title, '')) + char_length(coalesce(di.summary, ''))
           ), 0)::int as chars,
           coalesce(max(di.total), 0)::float as best
      from dailynews.digests d
 left join dailynews.digest_items di on di.digest_id = d.id
       and coalesce(di.summary_document->>'status','verified') <> 'unavailable'
     -- Каст обязателен: у нетипизированного параметра Postgres выбирает
     -- тип по колонке и падает на null там, где null означает «любой день».
     where d.reader_id = ${readerId}
       and (${day}::text is null or d.day = ${day}::date)
     group by d.day, d.stats
     order by d.day desc
     limit 1
  `;
  return row ?? { day: null, items: 0, chars: 0, best: 0, target: null };
}

/**
 * Мерка этого читателя: сколько знаков в его карточке.
 *
 * Нужна, чтобы перевести заказанные минуты в число мест до того, как
 * карточки написаны. Своя, а не общая: у англоязычного выпуска длина другая,
 * у «как специалисту» — тоже, и общее число промахивалось бы у всех, кроме
 * среднего читателя, которого не существует. Тридцать дней — чтобы одна
 * ночь с короткими описаниями не сдвинула мерку.
 *
 * Ноль означает «мерить нечего»: у нового читателя выпусков ещё нет,
 * и за него отвечает CARD_CHARS.
 */
export async function cardCharsOf(readerId: number): Promise<number> {
  const [row] = await sql<{ chars: number }[]>`
    select coalesce(avg(
             char_length(coalesce(di.title, '')) + char_length(coalesce(di.summary, ''))
           ), 0)::float as chars
      from dailynews.digest_items di
      join dailynews.digests d on d.id = di.digest_id
     where d.reader_id = ${readerId}
       and d.day > current_date - 30
       and coalesce(di.summary, '') <> ''
  `;
  return row?.chars ?? 0;
}

/** Потрачено на модель за сегодня. Потолок считается по читателю: вход
 *  бесплатный и мгновенный, и сто аккаунтов заводятся за вечер. */
export async function spentToday(readerId: number): Promise<number> {
  const [row] = await sql<{ spent: number }[]>`
    select (coalesce((select sum(cost_usd) from dailynews.model_calls
      where reader_id=${readerId} and at>=date_trunc('day',now())),0)
      + coalesce((select sum(reserved_usd) from dailynews.reading_calls
      where reader_id=${readerId} and status='reserved' and at>=date_trunc('day',now())),0))::float as spent
  `;
  return row?.spent ?? 0;
}

export type CallRecord = {
  readerId: number | null;
  stage:
    | "score" | "digest" | "summary" | "translate" | "translation-quality"
    | "video" | "interests"
    // Дедуп спрашивает Jev про серую зону, и это такой же оплаченный вызов.
    | "dedup"
    // Карточка автора и пост — такие же оплаченные вызовы, и потолок
    // читателя считается по той же таблице.
    | "voice" | "post" | "post-quality" | "spoken-terms"
    // Привратник разбора: дешёвый вопрос к Jev, решающий, звать ли дорогую
    // сверку документа с источником.
    | "reading-gate";
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
           coalesce(${readerTitle(sql`ks.reader_id`, sql`ks.item_id`)}, i.title) as title
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
    select network, handle, input_url, label, publishes, account, language, created_at
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

/**
 * Отметить или снять «публикую здесь». Адрес при этом не трогается —
 * ради этого и заведена колонка: снятая галочка уносила канал с собой.
 */
export async function setChannelPublishes(
  readerId: number,
  network: string,
  publishes: boolean,
): Promise<void> {
  await sql`
    insert into dailynews.reader_channels (reader_id, network, publishes)
    values (${readerId}, ${network}, ${publishes})
    on conflict (reader_id, network) do update
      set publishes = excluded.publishes,
          -- Отключение забывает и аккаунт: «Подключено · @ник» после
          -- «Отключить» говорило бы о связи, которой больше нет.
          account = case when excluded.publishes then reader_channels.account end,
          account_id = case when excluded.publishes then reader_channels.account_id end
  `;
}

/** Площадка подключена входом в сеть: таб включён, аккаунт назван. */
export async function connectChannel(
  readerId: number,
  network: string,
  account: string | null,
  accountId: string,
): Promise<void> {
  await sql`
    insert into dailynews.reader_channels (reader_id, network, publishes, account, account_id)
    values (${readerId}, ${network}, true, ${account}, ${accountId})
    on conflict (reader_id, network) do update
      set publishes = true, account = excluded.account, account_id = excluded.account_id
  `;
}

/**
 * Сеть сообщила, что аккаунт отозвал доступ или просит удалить данные.
 * Хранили мы о нём только номер и имя — их и стираем, вместе с табом:
 * подключения больше нет. Сколько строк задето — для лога.
 */
export async function disconnectAccount(network: string, accountId: string): Promise<number> {
  const rows = await sql`
    update dailynews.reader_channels
       set publishes = false, account = null, account_id = null
     where network = ${network} and account_id = ${accountId}
    returning reader_id
  `;
  return rows.length;
}

/**
 * Удалить профиль: личное стирается, безымянная строка остаётся.
 *
 * Строку не удаляем: на ней каскадом висят расход на модели и события
 * чтения, а из них строятся расходы и воронка дашборда — удалённая строка
 * переписала бы их задним числом (0063). Всё, что говорит о человеке или
 * написано для него, уходит: связки, черновики, выпуски, поля профиля.
 * Номер Telegram стирается тоже, поэтому следующий /start заводит новый
 * пустой профиль, а `getReader` и прогон отметку видят и строку не берут.
 * Тариф и статус подписки остаются — это счёт, а не личность; номер
 * подписки уходит, он ведёт в кабинет Lemon к самому человеку.
 */
export async function deleteReader(readerId: number): Promise<void> {
  await sql.begin(async (tx) => {
    const [reader] = await tx`
      select id from dailynews.readers
       where id = ${readerId} and not owner and deleted_at is null
       for update
    `;
    if (!reader) return;
    await tx`delete from dailynews.reader_channels where reader_id = ${readerId}`;
    await tx`delete from dailynews.reader_posts where reader_id = ${readerId}`;
    await tx`delete from dailynews.reader_summaries where reader_id = ${readerId}`;
    await tx`delete from dailynews.reader_topics where reader_id = ${readerId}`;
    await tx`delete from dailynews.reader_sources where reader_id = ${readerId}`;
    await tx`delete from dailynews.digests where reader_id = ${readerId}`;
    await tx`
      update dailynews.readers
         set deleted_at = now(), telegram_id = null, username = null, email = null, email_digest = false,
             reader_context = '', bio = null, suggested_topics = '{}',
             kindle_address = null, kindle_sender = null, kindle_digest = false,
             kindle_approved = false, podcast = false, llm = '{}'::jsonb,
             voice_card = null, voice_built_at = null, voice_sample = '',
             voice_skill = '', voice_enabled = false,
             follow_rules = '[]'::jsonb, exclude_rules = '[]'::jsonb,
             subscription_id = null, portal_url = null,
             paused_at = coalesce(paused_at, now()), updated_at = now()
       where id = ${readerId}
    `;
  });
}

/**
 * Забыть адрес, оставив саму площадку.
 *
 * `coalesce` в `saveChannel` бережёт прежний адрес от галочки, поэтому
 * стереть его тем же запросом нельзя — нужен свой.
 */
export async function clearChannelAddress(readerId: number, network: string): Promise<void> {
  await sql`
    update dailynews.reader_channels
       set handle = null, input_url = null, label = null
     where reader_id = ${readerId} and network = ${network}
  `;
}

/** Язык постов для сети. null — не называть, писать как в стиле. */
export async function setChannelLanguage(
  readerId: number,
  network: string,
  language: string | null,
): Promise<void> {
  await sql`
    update dailynews.reader_channels
       set language = ${language}
     where reader_id = ${readerId} and network = ${network}
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

/**
 * Личные правила отбора. Объектом через `sql.json`, как и карточка автора:
 * строка в jsonb молча превратила бы список в текст, который отбор читает
 * как «правил нет», — теперь такую запись отвергает и сама база
 * (`readers_follow_rules_array`).
 *
 * Пишется в переданное соединение: форма интересов сохраняет темы и правила
 * одной транзакцией, а онбординг — той же функцией, что и форма.
 */
export async function saveRules(
  db: Sql | TransactionSql,
  readerId: number,
  rules: Rules,
): Promise<void> {
  await db`
    update dailynews.readers
       set follow_rules = ${sql.json(rules.follow)},
           exclude_rules = ${sql.json(rules.exclude)},
           updated_at = now()
     where id = ${readerId}
  `;
}

/** Свитчер и текст стиля — одной записью: включённый стиль без текста не бывает. */
export async function saveVoiceStyle(readerId: number, enabled: boolean, text: string): Promise<void> {
  await sql`
    update dailynews.readers
       set voice_enabled = ${enabled}, voice_skill = ${text}, updated_at = now()
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

/**
 * Подзапрос «заголовок из выпуска этого читателя».
 *
 * Один на два места: он же нужен вопросу «дочитал?» и озвучке, а две
 * копии правила «свежий перевод этого читателя, иначе исходный» молча
 * разъезжаются — у одной появляется условие по читателю, у другой нет,
 * и заметно это только чужим заголовком в чужом ухе.
 *
 * Аргументы — куски запроса, а не значения: в одном месте номера
 * приходят колонками соседней таблицы, в другом — числами.
 */
const readerTitle = (readerId: unknown, itemId: unknown) => sql`
  (select di.title
     from dailynews.digest_items di
     join dailynews.digests d on d.id = di.digest_id
    where d.reader_id = ${readerId as never} and di.item_id = ${itemId as never}
    order by d.day desc
    limit 1)
`;

/**
 * Карточка этого читателя: что он видит в ленте и что слышит в озвучке.
 *
 * Описание персонально и живёт в `digest_items`, поэтому и озвучка
 * ключуется парой «выпуск + материал», а не «материал + язык»: два
 * читателя на русском получают разные описания одной новости, и общий
 * ключ отдал бы второму текст первого.
 */
export async function cardForReader(
  readerId: number,
  itemId: number,
): Promise<
  { digestId: number; day: string; title: string; summary: string; url: string } | null
> {
  const [row] = await sql<
    { digest_id: number; day: string; title: string; summary: string; url: string }[]
  >`
    select d.id as digest_id,
           -- Днём, а не датой: вступление подкаста называет число, и день
           -- выпуска не должен зависеть от пояса, в котором его разбирают.
           to_char(d.day, 'YYYY-MM-DD') as day,
           di.title, coalesce(di.summary, '') as summary, i.url
      from dailynews.digest_items di
      join dailynews.digests d on d.id = di.digest_id
      join dailynews.items i on i.id = di.item_id
     where di.item_id = ${itemId} and d.reader_id = ${readerId}
     order by d.day desc
     limit 1
  `;
  return row
    ? {
        digestId: Number(row.digest_id),
        day: row.day,
        title: row.title,
        summary: row.summary,
        url: row.url,
      }
    : null;
}

/**
 * Заголовок материала так, как его видит этот читатель.
 *
 * Перевод заголовка живёт в `digest_items.title` и персонален: в `items`
 * колонки `title_ru` нет с 0020, и запрос к ней падает целиком — так
 * отправка на читалку и не работала вовсе.
 *
 * Условие по читателю стоит на самой подзапросной выборке, а не только
 * на `digests`: с внешним соединением строки `digest_items` приходят
 * от всех читателей сразу, и порядок по дате лишь делает чужой перевод
 * маловероятным. Материал, попавший в чужой выпуск и не попавший в свой,
 * озвучивался бы чужим заголовком — вовремя и не тем.
 */
export async function itemForReader(
  readerId: number,
  itemId: number,
): Promise<{ url: string; title: string; body: string | null } | null> {
  const [row] = await sql<{ url: string; title: string; body: string | null }[]>`
    select i.url, i.body,
           coalesce(${readerTitle(readerId, sql`i.id`)}, i.title) as title
      from dailynews.items i
     where i.id = ${itemId}
  `;
  return row ?? null;
}
