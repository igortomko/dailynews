import { after, NextResponse, type NextRequest } from "next/server";
import { dictOf } from "@/lib/i18n";
import { sql } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getReader } from "@/lib/readers";
import { effectivePlan } from "@/lib/lemon";
import { cheapestFor } from "@/lib/plans";
import { queueAudioSend, runPodcast } from "../../../../../pipeline/tts";

/**
 * Подкаст из отмеченных карточек.
 *
 * Очередь заводится по карточке, а не одной строкой на подкаст: квота
 * считается суммой секунд, и неделимая строка на весь подкаст сделала бы
 * частичный отказ невидимым. Порядок берётся из выпуска, а не из порядка
 * отметок: подкаст слушают как выпуск.
 *
 * Если места хватило не на всё, собирается то, что влезло, а отказ
 * называется вслух: отменить целиком из-за последней карточки значит
 * отказать в том, на что квота была.
 */
export async function POST(request: NextRequest) {
  const readerId = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const reader = readerId ? await getReader(readerId) : undefined;
  const t = dictOf(reader?.ui_language).errors;
  if (!readerId || !reader) return NextResponse.json({ error: t.noSession }, { status: 401 });

  let payload: { item_ids?: unknown };
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: t.badRequest }, { status: 400 });
  }
  const asked = Array.isArray(payload.item_ids) ? payload.item_ids.map(Number) : [];
  if (asked.length === 0 || asked.some((id) => !Number.isInteger(id) || id <= 0)) {
    return NextResponse.json({ error: t.badRequest }, { status: 400 });
  }

  // Порядок выпуска и заодно проверка «это мои карточки»: чужой номер
  // просто не вернётся, и подкаст соберётся без него.
  const mine = await sql<{ item_id: number }[]>`
    select di.item_id
      from dailynews.digest_items di
      join dailynews.digests d on d.id = di.digest_id
     where d.reader_id = ${readerId} and di.item_id = any(${asked})
     order by d.day desc, di.position
  `;
  const ordered = [...new Set(mine.map((row) => Number(row.item_id)))];
  if (ordered.length === 0) {
    return NextResponse.json({ error: t.itemNotYours }, { status: 404 });
  }

  const plan = effectivePlan(reader);
  const planLabel = cheapestFor("audio").label;
  const sendIds: number[] = [];
  const included: number[] = [];
  let refusal = "";
  for (const itemId of ordered) {
    const queued = await queueAudioSend(reader, plan, itemId, t, planLabel);
    if ("error" in queued) {
      refusal ||= queued.error;
      continue;
    }
    sendIds.push(queued.id);
    included.push(itemId);
  }
  if (sendIds.length === 0) {
    return NextResponse.json({ error: refusal || t.audioNoText }, { status: 409 });
  }

  after(async () => {
    await runPodcast(sendIds, reader, included);
  });

  return NextResponse.json({
    ok: true,
    send_ids: sendIds,
    included: included.length,
    asked: ordered.length,
    // Отказ по части карточек — не ошибка запроса, но и не молчание:
    // читатель отметил пять, а услышит три, и узнать об этом он должен
    // сейчас, а не по длине файла.
    partial: included.length < ordered.length ? refusal : null,
  });
}
