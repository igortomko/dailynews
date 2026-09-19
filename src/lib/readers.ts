import { sql } from "./db";
import type { Reader, ReaderTopic, Topic } from "./types";

/**
 * Всё, что знает о читателях. Живёт отдельно от queries.ts, потому что нужно
 * и конвейеру, и вебу: queries.ts помечен server-only и в конвейер не ходит.
 *
 * Ни одна выборка здесь не обходится без reader_id. Запрос без него в общей
 * ленте — это чужие данные, показанные вовремя и без единой ошибки в логе.
 */
const COLUMNS = sql`
  id::int as id, telegram_id::text as telegram_id, username, owner,
  reader_context, digest_size, weights, language, complexity, style, llm,
  kindle_address, kindle_sender, kindle_digest, plan, daily_cap_usd, onboarded_at
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
 * Обратный адрес для Kindle. Выдаётся один раз и дальше не меняется:
 * каждая смена означает, что читатель заново одобряет отправителя
 * в настройках Amazon, а до тех пор выпуски молча не доходят.
 *
 * Зовётся из двух мест: при заведении через /start и при сохранении адреса
 * читалки. Только первого не хватало — читатель, вписавший адрес до того,
 * как написал боту, оставался без отправителя, и доставка тихо пропускалась.
 */
export async function freezeKindleSender(id: number, username: string | null): Promise<void> {
  const base = (username ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
  // Второй кандидат содержит id читателя, поэтому занятым быть не может.
  for (const candidate of [base || `reader${id}`, `${base || "reader"}-${id}`]) {
    try {
      await sql`
        update dailynews.readers set kindle_sender = ${candidate}
         where id = ${id} and kindle_sender is null
      `;
      return;
    } catch {
      // unique_violation: имя занято соседом — берём вариант с номером.
    }
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
    await freezeKindleSender(reader.id, username);
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
  stage: "score" | "digest" | "summary";
  model: string;
  tokensIn: number;
  tokensOut?: number;
  costUsd: number;
};

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
