import type { Dict } from "@/lib/i18n";
import { feed as ruFeed } from "@/lib/i18n/ru/feed";
import { count } from "./plural";
import type { Source } from "./types";

/**
 * Сюжет — это материал вместе с его повторами: одно событие, о котором
 * написало несколько источников читателя.
 *
 * Дедуп прячет повторы из выпуска, и до сих пор это была работа, которой
 * не видно: читатель не получал одну новость пять раз, но и не знал, что
 * её отсеяли. Здесь она называется вслух — не как «сигнал важности»
 * и не как подтверждение факта. Пять изданий, пересказавших один
 * пресс-релиз, ничего не подтверждают; они лишь показывают, что Reporta
 * выбрала из них одно и не спрятала остальные.
 */
export type Publication = {
  item_id: number;
  url: string;
  source_id: number;
  source_label: string;
  kind: Source["kind"];
  /** Время публикации. У всех источников в базе оно есть; пусто — только у брошенного вручную. */
  published_at: string | Date | null;
  points: number | null;
};

/**
 * Площадки, где материал не пишут, а обсуждают.
 *
 * Их время — это время поста на площадке, а не публикации статьи. Simon
 * Willison опубликовал за 103 минуты до того, как его пост попал
 * на Hacker News, и «103 минуты позже» было бы неправдой про обоих.
 * Поэтому у обсуждения не бывает «позже», а бывают очки — единственное,
 * что площадка добавляет к самой новости.
 */
const DISCUSSION: Record<Source["kind"], boolean> = {
  rss: false,
  telegram: false,
  email: false,
  hackernews: true,
  reddit: true,
  x: true,
};

/**
 * Картой по всему объединению, а не списком обсуждений: новая площадка
 * заставит компилятор дописать сюда строку. Списком она молча уехала бы
 * в ветку издания и получила бы «первоисточник» вместо «обсуждение» —
 * а став самой ранней, сдвинула бы «позже» у всех остальных.
 *
 * Вид `manual` («Свои входы», 0038) в типе Source пока не перечислен,
 * и брошенная ссылка читается здесь как издание. Это верно по смыслу:
 * её прислал человек, а не площадка с очками.
 */
const isDiscussion = (kind: Source["kind"]) => DISCUSSION[kind] === true;

const timeOf = (value: string | Date | null): number =>
  value === null ? Number.POSITIVE_INFINITY : new Date(value).getTime();

/**
 * Разрыв между публикациями словами.
 *
 * Минуты только пока они минуты: «341 минуту позже» — это число, которое
 * читатель пересчитывает в уме, а ответ ему нужен не точный, а по порядку.
 */
export type StoryLabels = Dict["feed"]["story"];

export function laterBy(minutes: number, t: StoryLabels = ruFeed.story): string {
  if (minutes < 1) return t.sameTime;
  if (minutes < 60) return t.laterMinutes(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t.laterHours(hours);
  return t.laterDays(Math.round(hours / 24));
}

export type StoryLine = Publication & { note: string };

/**
 * Публикации сюжета по порядку, каждая со своей пометкой.
 *
 * Порядок — по времени публикации, а не по тому, кого дедуп назначил
 * оригиналом: оригинал там выбирается по меньшему id, то есть по порядку
 * опроса источников. На живых данных это расходится с правдой в трёх
 * случаях из четырёх — Simon Willison написал раньше, а «оригиналом»
 * стал Hacker News, потому что его опросили первым.
 *
 * «Первоисточник» достаётся самому раннему изданию, а не самой ранней
 * строке: обсуждение на Hacker News может опередить статью, но
 * первоисточником от этого не станет. Нет ни одного издания — нет
 * и первоисточника, и отсчитывать «позже» не от чего.
 */
export function storyLines(
  publications: Publication[],
  t: StoryLabels = ruFeed.story,
): StoryLine[] {
  const ordered = [...publications].sort(
    (a, b) => timeOf(a.published_at) - timeOf(b.published_at) || a.item_id - b.item_id,
  );

  // Первоисточник — самое раннее издание с известным временем. Без этого
  // условия им становился бы первый попавшийся: timeOf отдаёт бесконечность
  // на пустую дату, сортировка сваливает такие строки в конец в порядке id,
  // и у сюжета, где даты нет ни у кого (не разобранная дата в RSS, письмо),
  // кто-то произвольный объявлялся бы написавшим раньше всех.
  const origin = ordered.find(
    (row) => !isDiscussion(row.kind) && Number.isFinite(timeOf(row.published_at)),
  );
  const base = origin ? timeOf(origin.published_at) : null;

  return ordered.map((row) => {
    if (isDiscussion(row.kind)) {
      return {
        ...row,
        note: row.points === null ? t.discussion : t.discussionPoints(row.points),
      };
    }
    if (row === origin) return { ...row, note: t.original };
    // База — самое раннее издание, поэтому разрыв не бывает отрицательным.
    // Времени нет вовсе — пометки нет: выдуманное «тогда же» врало бы ровно
    // там, где мы ничего не знаем.
    const at = timeOf(row.published_at);
    if (base === null || !Number.isFinite(at)) return { ...row, note: "" };
    return { ...row, note: laterBy(Math.round((at - base) / 60_000), t) };
  });
}

/**
 * Сколько ДРУГИХ источников читателя написали о том же.
 *
 * Считаются источники, а не публикации. На живом потоке двенадцать
 * кластеров из шестнадцати — это источник, повторивший сам себя (Hacker
 * News дважды, Cointelegraph в своём же обзоре), и «ещё 1 твой источник»
 * на них было бы враньём: источник тот же самый. Такой сюжет строки
 * не получает вовсе — дедуп убрал повтор, и этого достаточно.
 */
export function otherSources(publications: Publication[], shownSourceId: number): number {
  const ids = new Set(publications.map((row) => row.source_id));
  ids.delete(shownSourceId);
  return ids.size;
}

/**
 * «Ещё 3 источника».
 *
 * Коротко, потому что это подпись под карточкой, а не предложение: «о том же
 * написали ещё 3 твоих источника» занимало половину строки, чтобы сказать
 * то же самое. «О том же» и так следует из места — строка стоит под этим
 * материалом; «твоих» следует из состава — в список идут только источники,
 * которые читатель выбрал сам, и чужих там не бывает.
 */
export const alsoLine = (n: number, t: StoryLabels = ruFeed.story) => t.alsoLine(n);

/** Заголовок раскрытия: публикации считаются все, вместе с показанной. */
export const storyTitle = (n: number, t: StoryLabels = ruFeed.story) => t.storyTitle(n);
