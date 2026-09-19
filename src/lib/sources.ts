import "server-only";
import { sql } from "./db";
import { kindDenial } from "./plans";
import { effectivePlan } from "./lemon";
import { discover, planFor, probeOne, type Found } from "../../pipeline/discover";
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
 * Считается только то, что прогон и правда опрашивает: запрещённый вид
 * отсекается до предела по числу. Иначе после понижения тарифа оставшиеся
 * ленты X занимают места живых источников — добавить разрешённый нельзя,
 * пока не выключишь те, которые всё равно никто не опрашивает.
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
      from dailynews.sources
     where deleted_at is null and kind = any(${plan.kinds})
  `;
  return n >= plan.maxSources
    ? `Тариф «${plan.label}» опрашивает ${plan.maxSources} источников — убери лишний`
    : null;
}

/**
 * Запись источника.
 *
 * xmax = 0 у настоящей вставки и ненулевой у обновления по конфликту:
 * без этого «Источник добавлен» говорилось бы и тогда, когда он уже был
 * в списке, то есть ровно в том случае, когда важно знать правду.
 */
export async function saveSource(
  kind: Source["kind"],
  url: string,
  inputUrl: string,
  label: string,
): Promise<{ created: boolean }> {
  const [row] = await sql<{ created: boolean }[]>`
    insert into dailynews.sources (kind, label, url, input_url)
    values (${kind}, ${label}, ${url}, ${inputUrl})
    on conflict (kind, url) do update
      set active = true, label = excluded.label, input_url = excluded.input_url,
          -- Убранный источник, добавленный заново, возвращается вместе
          -- со своей историей, а не заводится пустым двойником.
          deleted_at = null
    returning (xmax = 0) as created
  `;
  return { created: row?.created ?? true };
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
  // Каталог общий на всех читателей, поэтому правит его владелец. Проверка
  // стоит первой: у постороннего не должно получаться даже заставить нас
  // сходить по его ссылке.
  if (!reader.owner) return { ok: false, error: "Источники заводит владелец ленты" };

  const raw = input.trim().slice(0, 500);
  if (!raw) return { ok: false, error: "Пустая строка" };

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
    found.found.kind,
    found.found.url,
    found.found.input_url,
    found.found.label,
  );
  return { ok: true, found: found.found, created };
}

/** Перепроверка одного кандидата — того, что уже показала форма. */
export { probeOne };
