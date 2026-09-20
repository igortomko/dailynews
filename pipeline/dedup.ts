import type { Sql } from "postgres";
import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import { normalizeTitle } from "./normalize";

/** Насколько похожими должны быть нормализованные заголовки, чтобы счесть их дублем. */
const SIMILARITY = 0.55;
/**
 * Нижняя граница серой зоны. Ниже неё лексическое сходство не значит ничего:
 * «Dark Age» набирает половину общих слов с любым заголовком про dark.
 * Выше — отправляем пару в Jev, ниже — не трогаем вовсе.
 */
const SHORTLIST = 0.15;
/** Сколько кандидатов уходит в один вопрос. Больше — длиннее вопрос, а не точнее. */
const SHORTLIST_SIZE = 5;
/**
 * Ниже этой вероятности выбор Jev не считается ответом. Дубль помечается
 * навсегда и для всех читателей, поэтому цена ошибки несимметрична:
 * пропущенный дубль — это лишняя карточка, ложный — новость, которой
 * никто больше не увидит.
 */
const CERTAINTY = 0.6;
/** Окно, в котором ищется оригинал. Дальше в прошлое новость уже не дубль, а возврат к теме. */
const WINDOW_DAYS = 4;
/** Вариант «ни один». Без него choice обязан выбрать хоть что-то из шортлиста. */
const NONE = "none";

/**
 * Второй слой дедупа, поверх уникального url_canon: одна и та же новость,
 * переписанная тремя изданиями под разными заголовками и адресами.
 * Сравнение делает Postgres через pg_trgm — своего кода тут быть не должно.
 *
 * Проставляет items.dup_of. Дубли остаются в базе (они нужны, чтобы видеть
 * охват источников), но в отбор и в дайджест не попадают.
 */
export async function markDuplicates(sql: Sql, itemIds: number[]): Promise<number> {
  if (itemIds.length === 0) return 0;

  const marked = await sql<{ id: number }[]>`
    with fresh as (
      select id, title_norm, collected_at
      from dailynews.items
      where id = any(${itemIds}) and dup_of is null
    ),
    matches as (
      select distinct on (f.id) f.id, o.id as original_id
      from fresh f
      join dailynews.items o
        on o.id < f.id
       and o.dup_of is null
       and o.collected_at > f.collected_at - ${`${WINDOW_DAYS} days`}::interval
       and extensions.similarity(o.title_norm, f.title_norm) >= ${SIMILARITY}
      order by f.id, extensions.similarity(o.title_norm, f.title_norm) desc, o.id asc
    )
    update dailynews.items i
       set dup_of = m.original_id
      from matches m
     where i.id = m.id
    returning i.id
  `;
  return marked.length;
}

export type Shortlisted = { id: number; title: string; excerpt: string };

/**
 * Вопрос про один материал: шортлист похожих плюс вариант «ни один».
 *
 * Описание варианта — заголовок вместе с началом текста, а не один заголовок.
 * Заголовки этой пары уже прошли лексическую проверку и не сошлись: спрашивать
 * модель по тому же признаку, который только что ничего не решил, значит
 * получить такой же беспомощный ответ, только за деньги. Разводит пары
 * как раз текст: «Human brain is two separate organs» и «Two parallel neural
 * ectoderm progenitors contribute to the developing brain» — это один сюжет,
 * и видно это только из описаний.
 *
 * Формулировка узкая нарочно. Соседний выпуск того же сюжета, следующая цифра
 * в той же истории и вторая новость про тех же людей — разные новости:
 * dup_of прячет материал у всех и навсегда.
 */
export function sameStoryQuestion(item: Shortlisted, candidates: Shortlisted[]) {
  // Объектом, а не склеенной строкой: SDK принимает в описание варианта
  // JSON (`Description = string | object | array | null`), и заголовок,
  // отделённый от текста, читается моделью как два разных признака,
  // а не как одно длинное предложение. Остальные вызовы в прогоне
  // передают строки только потому, что у них описание и есть строка.
  const criteria: Record<string, { title: string; excerpt: string } | string> = {};
  for (const candidate of candidates) {
    criteria[`o${candidate.id}`] = {
      title: candidate.title,
      excerpt: candidate.excerpt.slice(0, 300),
    };
  }
  criteria[NONE] = "ни одна: это разные новости, пусть и об одном и том же предмете";

  return {
    state: { title: item.title, excerpt: item.excerpt.slice(0, 300) },
    questions: {
      same: choice(
        "Какая из перечисленных новостей рассказывает то же самое, что и оцениваемая? " +
        "То же самое — это одно событие, один факт, одни участники, пересказанные " +
        "другим изданием и другими словами. " +
        "Не то же самое: продолжение сюжета, следующая цифра в той же истории, " +
        "другая новость про тех же людей и два релиза одного проекта с разными " +
        "номерами версий — даже если во втором сказано, что исправлено то же самое.",
        criteria,
      ),
    },
  };
}

/** Ответ Jev — в id оригинала либо в «не дубль». Неуверенный выбор считается за «не дубль». */
export function dupVerdict(answer: {
  choice: string;
  probabilities: Record<string, number>;
}): number | null {
  if (answer.choice === NONE) return null;
  if ((answer.probabilities[answer.choice] ?? 0) < CERTAINTY) return null;
  const id = Number(answer.choice.slice(1));
  return Number.isFinite(id) && id > 0 ? id : null;
}

type GreyRow = {
  id: number;
  title: string;
  excerpt: string;
  other_id: number;
  other_title: string;
  other_excerpt: string;
};

export type Asked = {
  marked: number;
  /** Сколько вопросов задано. Отдаётся наружу, чтобы отличить «серой зоны нет» от «ни один вопрос не ответил». */
  questions: number;
  asked: number;
  usage: { input: number; output: number };
  model: string;
};

export type DedupJob = { item: Shortlisted; candidates: Shortlisted[] };

/**
 * Шортлист серой зоны: до пяти более ранних материалов на каждый свежий.
 *
 * Отдельной функцией, потому что Jev здесь ни при чём, а сломаться может
 * именно запрос: нетипизированный массив уходит в int мимо bigint, а верхняя
 * граница, случайно ставшая нестрогой, погнала бы в вопрос всё, что первый
 * слой уже пометил. `npm run verify:db` проверяет его на живом Postgres.
 */
export async function shortlist(sql: Sql, itemIds: number[]): Promise<DedupJob[]> {
  if (itemIds.length === 0) return [];

  const rows = await sql<GreyRow[]>`
    with fresh as (
      select id, title, coalesce(excerpt, '') as excerpt, title_norm, collected_at
        from dailynews.items
       where id = any(${itemIds}::bigint[])
         and dup_of is null
         -- Спрашиваем один раз на материал. Окно свежести живёт двое суток,
         -- и без этого условия каждый вопрос задавался бы дважды.
         and dup_asked_at is null
    )
    -- Каст обязателен: items.id — bigint, а драйвер отдаёт его строкой.
    -- Тип говорит number, сравнение id с id молча становится лексическим,
    -- и «#68 < #700» оказывается ложью.
    select f.id::int as id, f.title, f.excerpt,
           c.other_id::int as other_id, c.other_title, c.other_excerpt
      from fresh f
      cross join lateral (
        select o.id as other_id, o.title as other_title,
               coalesce(o.excerpt, '') as other_excerpt
          from dailynews.items o
         where o.id < f.id
           and o.dup_of is null
           and o.collected_at > f.collected_at - ${`${WINDOW_DAYS} days`}::interval
           and extensions.similarity(o.title_norm, f.title_norm) >= ${SHORTLIST}
           and extensions.similarity(o.title_norm, f.title_norm) < ${SIMILARITY}
         order by extensions.similarity(o.title_norm, f.title_norm) desc, o.id asc
         limit ${SHORTLIST_SIZE}
      ) c
     order by f.id
  `;

  const jobs = new Map<number, DedupJob>();
  for (const row of rows) {
    const job = jobs.get(row.id) ?? {
      item: { id: row.id, title: row.title, excerpt: row.excerpt },
      candidates: [],
    };
    job.candidates.push({
      id: row.other_id,
      title: row.other_title,
      excerpt: row.other_excerpt,
    });
    jobs.set(row.id, job);
  }
  return [...jobs.values()];
}

/**
 * Третий слой: серая зона, до которой триграммы не дотягиваются.
 *
 * Замер на живом потоке: у заведомо одинаковых сюжетов сходство заголовков
 * 0,15–0,34 — «AI hallucination nearly triggers US Military operation» и
 * «US Military had close call after using AI for hallucinated intelligence
 * report» дают 0,27. Порог 0,55 их не видит, а опустить его нельзя:
 * «datasette 1.0a40» и «datasette 0.65.5» дают 0,48 и остаются разными
 * релизами. Разделяет эти случаи не число, а смысл, поэтому серую зону
 * разбирает Jev.
 *
 * Дёшево это потому, что лексика отвечает за полноту, а Jev — за точность:
 * шортлист снимает с 331 материала 126 вопросов за трое суток, то есть
 * около сорока в день против трёх сотен в скоринге. Вопрос один на материал,
 * а не на пару: choice возвращает вероятности по всем вариантам разом.
 *
 * Зовётся после markDuplicates и до скоринга: помеченный здесь дубль
 * не уедет в Jev восемью вопросами второй раз.
 */
export async function askDuplicates(sql: Sql, itemIds: number[]): Promise<Asked> {
  const empty: Asked = {
    marked: 0, questions: 0, asked: 0, usage: { input: 0, output: 0 }, model: "",
  };
  if (itemIds.length === 0) return empty;

  const queue = await shortlist(sql, itemIds);
  if (queue.length === 0) return empty;

  const client = new TypeSafeClient();
  const result: Asked = { ...empty, questions: queue.length, usage: { input: 0, output: 0 } };
  let cursor = 0;

  // Тот же пул на восемь, что и в скоринге: больше упирается в лимит ключа.
  const worker = async () => {
    while (cursor < queue.length) {
      const { item, candidates } = queue[cursor++];
      try {
        const answered = await client.systemOne(sameStoryQuestion(item, candidates));
        result.asked++;
        result.usage.input += answered.usage.input_tokens;
        result.usage.output += answered.usage.output_tokens;
        result.model = answered.model;

        const originalId = dupVerdict({
          choice: answered.answers.same.choice,
          probabilities: answered.answers.same.probabilities as Record<string, number>,
        });

        // Отметка ставится и на «не дубль»: вопрос задан и оплачен,
        // а окно свежести переживёт ещё один прогон. Ставится только после
        // ответа — упавший вопрос должен повториться завтра. Гонки здесь нет:
        // шортлист даёт по одной работе на материал, и второй работник
        // до этой строки не доходит.
        await sql`
          update dailynews.items
             set dup_asked_at = now(), dup_of = ${originalId}
           where id = ${item.id}
        `;
        if (originalId !== null) result.marked++;
      } catch (error) {
        // Один неотвеченный вопрос не должен ронять прогон: материал
        // просто останется недублем и пойдёт в скоринг как обычно.
        console.error(`  ! дедуп «${item.title.slice(0, 50)}»: ${(error as Error).message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
  return result;
}

export { normalizeTitle };
