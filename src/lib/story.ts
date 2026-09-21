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
 * пресс-релиз, ничего не подтверждают; они лишь показывают, что Retorta
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
const DISCUSSION: ReadonlySet<Source["kind"]> = new Set(["hackernews", "x", "reddit"]);

const timeOf = (value: string | Date | null): number =>
  value === null ? Number.POSITIVE_INFINITY : new Date(value).getTime();

/**
 * Разрыв между публикациями словами.
 *
 * Минуты только пока они минуты: «341 минуту позже» — это число, которое
 * читатель пересчитывает в уме, а ответ ему нужен не точный, а по порядку.
 */
export function laterBy(minutes: number): string {
  if (minutes < 1) return "тогда же";
  if (minutes < 60) return `${count(minutes, "минуту", "минуты", "минут")} позже`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${count(hours, "час", "часа", "часов")} позже`;
  return `${count(Math.round(hours / 24), "день", "дня", "дней")} позже`;
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
export function storyLines(publications: Publication[]): StoryLine[] {
  const ordered = [...publications].sort(
    (a, b) => timeOf(a.published_at) - timeOf(b.published_at) || a.item_id - b.item_id,
  );

  const origin = ordered.find((row) => !DISCUSSION.has(row.kind));
  const base = origin ? timeOf(origin.published_at) : null;

  return ordered.map((row) => {
    if (DISCUSSION.has(row.kind)) {
      return {
        ...row,
        note: row.points === null ? "обсуждение" : `обсуждение: ${row.points} points`,
      };
    }
    if (row === origin) return { ...row, note: "первоисточник" };
    // База — самое раннее издание, поэтому разрыв не бывает отрицательным.
    // Времени нет вовсе (брошенное вручную) — пометки нет: выдуманное
    // «тогда же» врало бы ровно там, где мы ничего не знаем.
    const at = timeOf(row.published_at);
    if (base === null || !Number.isFinite(at)) return { ...row, note: "" };
    return { ...row, note: laterBy(Math.round((at - base) / 60_000)) };
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
 * «О том же написали ещё 3 твоих источника».
 *
 * «Твоих» — не украшение: в список идут только те источники, которые
 * читатель выбрал сам. Чужие издания в общем каталоге к его выбору
 * отношения не имеют, и показывать их значило бы обещать охват,
 * которого он не просил.
 */
export const alsoLine = (n: number) =>
  `О том же написали ещё ${count(n, "твой источник", "твоих источника", "твоих источников")}`;

/** Заголовок раскрытия: публикации считаются все, вместе с показанной. */
export const storyTitle = (n: number) =>
  `Один сюжет, ${count(n, "публикация", "публикации", "публикаций")}`;
