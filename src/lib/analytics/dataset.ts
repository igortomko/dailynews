import "server-only";
import { sql } from "@/lib/db";
import profile from "./profile.json";
import { validateDataset } from "@launch-kit/lib/data";
import type { AnalyticsDataset, AnalyticsEvent } from "@launch-kit/lib/types";

/**
 * Снимок для Launch Kit собирается из того, что уже лежит в базе: вход —
 * строка `readers`, чтение — `reads`. Второго сборщика событий нет и
 * заводить его не за чем: `reads` и так пишется на каждый показ и нажатие.
 *
 * События чтения сводятся до одного на читателя в сутки по каждому виду.
 * Дашборд считает людей, а не нажатия: сорок показов за утро — это один
 * активный день, и в снимке им незачем быть сорока строками.
 *
 * Выпуск, который мы прислали, событием не становится: Launch Kit считает
 * `goal_completed` активностью, и ночной прогон делал бы активным каждого
 * читателя каждый день, включая тех, кто месяц не открывал ленту.
 */
type Row = { reader_id: number; event: string; day: string; first_at: Date };

const ACTIVITY: Record<string, (row: Row) => Partial<AnalyticsEvent>> = {
  seen: () => ({ name: "goal_completed", goal: "seen" }),
  outbound: () => ({ name: "outbound_clicked" }),
  up: () => ({ name: "goal_completed", goal: "rated" }),
};

export async function buildDataset(): Promise<AnalyticsDataset> {
  const generatedAt = new Date().toISOString();
  const [readers, rows] = await sql.begin("read only", async (tx) => {
    await tx`set local statement_timeout = '10s'`;
    return Promise.all([
      // Источник — канал размещения, кампания — само размещение: так кит
      // раскладывает каналы и их качество без своей таблицы соответствий.
      tx<{ id: number; username: string | null; ui_language: string | null; created_at: Date; onboarded_at: Date | null; channel: string | null; campaign: string | null }[]>`
        select r.id::int, r.username, r.ui_language, r.created_at, r.onboarded_at,
               p.channel, p.name as campaign
          from dailynews.readers r
          left join dailynews.placements p on p.code = r.source
         order by r.id`,
      // up и down сводятся в одну оценку: день, в котором читатель поставил
      // и то и другое, — один день с оценкой, а не два.
      tx<Row[]>`
        select reader_id::int,
               case when event in ('up', 'down') then 'up' else event end as event,
               (at at time zone 'UTC')::date::text as day,
               min(at) as first_at
          from dailynews.reads
         where event in ('seen', 'opened', 'outbound', 'up', 'down')
         group by 1, 2, 3`,
    ]);
  });

  const subject = (id: number) => `r${id}`;
  const events: AnalyticsEvent[] = [];
  for (const r of readers) {
    events.push({
      id: `entered-${r.id}`, subjectId: subject(r.id), occurredAt: r.created_at.toISOString(), name: "product_entered", surface: "telegram",
      ...(r.channel && r.campaign ? { source: r.channel, campaign: r.campaign.slice(0, 100) } : {}),
    });
    if (r.onboarded_at) events.push({ id: `onboarded-${r.id}`, subjectId: subject(r.id), occurredAt: r.onboarded_at.toISOString(), name: "goal_completed", surface: "web", goal: "onboarded" });
  }

  // Первое раскрытие карточки — первая польза, дальше каждый день с раскрытием
  // — повтор. Раньше по времени идёт первым, поэтому порядок строк важен.
  const opened = new Set<number>();
  for (const row of rows.sort((a, b) => a.first_at.getTime() - b.first_at.getTime())) {
    const base = { subjectId: subject(row.reader_id), occurredAt: row.first_at.toISOString(), surface: "web" as const };
    if (row.event === "opened") {
      const first = !opened.has(row.reader_id);
      opened.add(row.reader_id);
      events.push({ ...base, id: `opened-${row.reader_id}-${row.day}`, name: first ? "first_value" : "value_repeated" });
      continue;
    }
    events.push({ ...base, id: `${row.event}-${row.reader_id}-${row.day}`, ...ACTIVITY[row.event](row) } as AnalyticsEvent);
  }

  const lastEventAt = events.reduce<string | null>((last, e) => (last && last > e.occurredAt ? last : e.occurredAt), null);
  return validateDataset({
    schemaVersion: 1,
    mode: "local",
    generatedAt,
    ...profile,
    capabilities: { sessions: false, payments: false, lifecycle: false, crawlers: false, geography: false, identity: true },
    events,
    health: { lastEventAt, errors: 0 },
    profiles: readers.map((r) => ({
      subjectId: subject(r.id),
      // Кит принимает только telegram-форму имени; строка владельца,
      // перенесённая из profile, и тестовые читатели её не держат.
      ...(r.username && /^[A-Za-z0-9_]{1,32}$/.test(r.username)
        ? { displayName: `@${r.username}`, username: r.username }
        : { displayName: `Читатель ${r.id}` }),
      createdAt: r.created_at.toISOString(),
      onboardingCompletedAt: r.onboarded_at?.toISOString() ?? null,
      ...(r.ui_language ? { locale: r.ui_language } : {}),
    })),
  });
}
