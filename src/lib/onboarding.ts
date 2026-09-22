import type { Dict } from "@/lib/i18n";
import { ru } from "@/lib/i18n/ru/index";
import "server-only";
import { sql } from "./db";
import { catalogFor } from "./queries";
import { STARTER_TOPICS, starterBySlug } from "./starter-topics";
import type { Plan } from "./plans";
import type { Source } from "./types";

/**
 * Первый заход: интересы, источники, первый выпуск.
 *
 * Шаг не хранится колонкой, а считается по данным. Колонка «на каком шаге
 * читатель» расходится с правдой при первом же отказе на середине: в базе
 * стоит «выбирает источники», интересов нет, и экран показывает пустой
 * список того, что подобрано под них.
 */
export type Step = "interests" | "sources" | "ready";

export async function onboardingStep(readerId: number): Promise<Step> {
  const [row] = await sql<{ topics: number; sources: number }[]>`
    select
      (select count(*)::int from dailynews.reader_topics where reader_id = ${readerId}) as topics,
      (select count(*)::int from dailynews.reader_sources rs
         join dailynews.sources s on s.id = rs.source_id
        where rs.reader_id = ${readerId} and s.deleted_at is null) as sources
  `;
  if (!row || row.topics === 0) return "interests";
  if (row.sources === 0) return "sources";
  return "ready";
}

/** Интерес, каким его видит первый экран. */
export type TopicOption = { slug: string; label: string; hint: string };

/**
 * Что показать на первом экране и в каком порядке.
 *
 * Порядок решают две вещи: соседи уже выбранного и — во вторую очередь —
 * описание из Telegram, разобранное при заведении. Обе подсказки только
 * поднимают варианты вверх; убрать из списка они не могут ничего.
 */
export function topicOptions(): TopicOption[] {
  return STARTER_TOPICS.map(({ slug, label, hint }) => ({ slug, label, hint }));
}

export type Suggestion = {
  /** `kind|url` — по нему действие находит источник заново, не веря форме. */
  key: string;
  kind: Source["kind"];
  url: string;
  label: string;
  /** Под какой интерес предложен. Строка под названием, а не догадка. */
  why: string;
};

const keyOf = (kind: string, url: string) => `${kind}|${url}`;

/**
 * Источники под выбранные интересы.
 *
 * Два слоя, и оба нужны. Стартовый список из файла отвечает за темы, по
 * которым в базе ещё ничего нет: у нового интереса не может быть истории,
 * а пустой второй шаг — это предложение, на которое нечего нажать. Каталог
 * отвечает за то, чтобы предложения взрослели: источник, который полгода
 * кормит «Энергетику», попадёт в подборку сам, без правки файла.
 *
 * Уже взятые не показываются: предлагать взять взятое — это кнопка,
 * которая ничего не делает.
 */
export async function suggestSources(
  readerId: number,
  topicSlugs: string[],
  plan: Plan,
  /** Язык подписи «за что предложено». По умолчанию русский, как у соседей. */
  t: Dict["onboarding"] = ru.onboarding,
): Promise<Suggestion[]> {
  const taken = await sql<{ kind: string; url: string }[]>`
    select s.kind, s.url from dailynews.reader_sources rs
      join dailynews.sources s on s.id = rs.source_id
     where rs.reader_id = ${readerId}
  `;
  const seen = new Set(taken.map((row) => keyOf(row.kind, row.url)));
  const out: Suggestion[] = [];

  const push = (feed: { kind: Source["kind"]; url: string; label: string }, why: string) => {
    const key = keyOf(feed.kind, feed.url);
    // Вид, которого тариф не даёт, не предлагается вовсе: показать его
    // значит показать кнопку, которая откажет после нажатия. Проверка стоит
    // здесь, на общем пути, а не в каждом из двух слоёв подборки.
    if (!plan.kinds.includes(feed.kind)) return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, kind: feed.kind, url: feed.url, label: feed.label, why });
  };

  // По кругу, а не темами подряд: у первого интереса шесть фидов, и списком
  // подряд весь экран занял бы он один, а третий интерес читатель увидел бы,
  // только долистав.
  const lists = topicSlugs
    .map((slug) => starterBySlug.get(slug))
    .filter((topic) => topic !== undefined);
  const depth = Math.max(0, ...lists.map((topic) => topic.feeds.length));
  for (let rank = 0; rank < depth; rank++) {
    for (const topic of lists) {
      const feed = topic.feeds[rank];
      if (feed) push(feed, topic.label);
    }
  }

  for (const row of await catalogFor(readerId, topicSlugs, plan.kinds)) {
    push(
      { kind: row.kind as Source["kind"], url: row.url, label: row.label },
      t.wizard.sourceWhyItems(row.items),
    );
  }

  return out;
}

/**
 * Проверить выбор формы по тому же списку, по которому он был показан.
 *
 * Форма присылает ключи, а не адреса: иначе в каталог можно было бы
 * вставить что угодно, подписав это чужим названием, — и следующий
 * читатель увидел бы это среди предложений как наше.
 */
export async function resolveSuggestions(
  readerId: number,
  topicSlugs: string[],
  plan: Plan,
  keys: string[],
): Promise<Suggestion[]> {
  const offered = new Map((await suggestSources(readerId, topicSlugs, plan)).map((s) => [s.key, s]));
  return keys.map((key) => offered.get(key)).filter((found) => found !== undefined);
}
