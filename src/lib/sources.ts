import "server-only";
import { sql } from "./db";
import { kindDenial } from "./plans";
import { effectivePlan } from "./lemon";
import { dictOf, localeOf } from "./i18n";
import { discover, planFor, probeOne, type Found } from "../../pipeline/discover";
import { addReaderSource } from "./readers";
import type { Reader, Source } from "./types";

/**
 * Одна дорога к добавлению источника: для формы в вебе и для ссылки,
 * присланной боту.
 *
 * Разводить их нельзя. Проверка тарифа, предел по числу и запись — это
 * одни и те же правила, и разойдясь, они разойдутся молча: бот начнёт
 * заводить то, что форма отвергает, и заметить это можно будет только
 * по счёту от провайдера.
 */

const KNOWN_KINDS = new Set<Source["kind"]>([
  "rss", "hackernews", "reddit", "x", "telegram", "email",
]);

export const isKnownKind = (kind: string): kind is Source["kind"] =>
  KNOWN_KINDS.has(kind as Source["kind"]);

/**
 * Почему этот источник тарифу не положен, или null, если положен.
 *
 * Считается набор этого читателя, а не каталог: каталог общий, и чужие
 * источники не занимают его мест. До reader_sources считалось по каталогу —
 * и пятый по счёту источник, заведённый кем угодно, закрывал добавление
 * всем бесплатным читателям сразу.
 *
 * Запрещённый вид отсекается до предела по числу. Иначе после понижения
 * тарифа оставшиеся ленты X занимают места живых источников: добавить
 * разрешённый нельзя, пока не уберёшь те, которые всё равно не опрашиваются.
 */
export async function denyForKind(
  reader: Reader,
  kind: Source["kind"],
): Promise<string | null> {
  const plan = effectivePlan(reader);

  const byKind = kindDenial(plan, kind);
  if (byKind) return byKind;

  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from dailynews.reader_sources rs
      join dailynews.sources s on s.id = rs.source_id
     where rs.reader_id = ${reader.id} and s.deleted_at is null and s.kind = any(${plan.kinds})
  `;
  if (n < plan.maxSources) return null;
  const t = dictOf(localeOf(reader.ui_language)).sources;
  return t.tooManySources(plan.label, plan.maxSources);
}

/**
 * Запись источника.
 *
 * xmax = 0 у настоящей вставки и ненулевой у обновления по конфликту:
 * без этого «Источник добавлен» говорилось бы и тогда, когда он уже был
 * в списке, то есть ровно в том случае, когда важно знать правду.
 */
export async function saveSource(
  readerId: number,
  kind: Source["kind"],
  url: string,
  inputUrl: string,
  label: string,
): Promise<{ created: boolean; id: number }> {
  const [row] = await sql<{ created: boolean; id: number }[]>`
    insert into dailynews.sources (kind, label, url, input_url)
    values (${kind}, ${label}, ${url}, ${inputUrl})
    on conflict (kind, url) do update
      set active = true, input_url = excluded.input_url,
          -- Убранный источник, добавленный заново, возвращается вместе
          -- со своей историей, а не заводится пустым двойником.
          deleted_at = null
    returning (xmax = 0) as created, id::int as id
  `;
  // Название чужого источника не переписываем: каталог общий, и вставивший
  // ту же ссылку второй читатель менял бы подпись в ленте первого.
  await addReaderSource(readerId, row.id);
  return { created: row?.created ?? true, id: row.id };
}

export type AddOutcome =
  | { ok: true; found: Found; created: boolean }
  | { ok: false; error: string };

/**
 * Ссылка → источник, одним ходом.
 *
 * Так приходит ссылка в бот: показывать промежуточный разбор и ждать
 * подтверждения в переписке негде, поэтому решение принимается сразу,
 * а что получилось — сообщается после.
 */
export async function addByLink(reader: Reader, input: string): Promise<AddOutcome> {
  const raw = input.trim().slice(0, 500);
  if (!raw) return { ok: false, error: dictOf(localeOf(reader.ui_language)).sources.emptyLink };

  // Тариф спрашивается до сети: какой это будет вид, planFor знает без
  // единого запроса, а разбор ссылки X — уже платный запрос.
  const planned = planFor(raw);
  if (!("refuse" in planned)) {
    const denials = await Promise.all(
      planned.candidates.map((candidate) => denyForKind(reader, candidate.kind)),
    );
    if (denials.every(Boolean)) return { ok: false, error: denials[0]! };
  }

  const found = await discover(raw);
  if (!found.ok) return { ok: false, error: found.error };

  // Предел по числу мог измениться, пока ходили: спрашиваем ещё раз,
  // уже зная настоящий вид.
  const denied = await denyForKind(reader, found.found.kind);
  if (denied) return { ok: false, error: denied };

  const { created } = await saveSource(
    reader.id,
    found.found.kind,
    found.found.url,
    found.found.input_url,
    found.found.label,
  );
  return { ok: true, found: found.found, created };
}

/** Перепроверка одного кандидата — того, что уже показала форма. */
export { probeOne };
