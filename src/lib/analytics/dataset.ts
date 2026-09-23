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
type BillingRow = {
  id: string; reader_id: number; name: string; occurred_at: Date; plan: string | null;
  amount_minor: number | null; currency: string | null; payment_id: string | null; refund_id: string | null;
};

// Имена этапов — как их знает владелец, а не как они записаны в check.
const STAGE_LABELS: Record<string, string> = {
  score: "Оценка потока (Jev)", dedup: "Дедуп (Jev)", digest: "Дайджест", summary: "Замер описаний",
  translate: "Перевод", "translation-quality": "Качество перевода", video: "Конспект ролика",
  voice: "Карточка голоса", post: "Посты", "post-quality": "Проверка поста", interests: "Подбор интересов",
  "spoken-terms": "Произношение терминов", "reading-gate": "Привратник разбора", "reading-repeat": "Повтор разбора",
};

const ACTIVITY: Record<string, (row: Row) => Partial<AnalyticsEvent>> = {
  seen: () => ({ name: "goal_completed", goal: "seen" }),
  outbound: () => ({ name: "outbound_clicked" }),
  up: () => ({ name: "goal_completed", goal: "rated" }),
};

export async function buildDataset(): Promise<AnalyticsDataset> {
  const generatedAt = new Date().toISOString();
  const [readers, rows, costs, pending, placements, billing] = await sql.begin("read only", async (tx) => {
    await tx`set local statement_timeout = '10s'`;
    return Promise.all([
      // Источник — канал размещения, кампания — само размещение: так кит
      // раскладывает каналы и их качество без своей таблицы соответствий.
      tx<{ id: number; username: string | null; ui_language: string | null; created_at: Date; onboarded_at: Date | null; channel: string | null; campaign: string | null; entered_via: string }[]>`
        select r.id::int, r.username, r.ui_language, r.created_at, r.onboarded_at, r.entered_via,
               p.channel, p.code as campaign
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
      // Расход — из model_calls, той же таблицы, по которой прогон сверяет
      // дневной потолок: второй счётчик денег разошёлся бы с первым.
      // Девяносто дней — самый длинный период кита.
      tx<{ date: string; stage: string; model: string; reader_id: number | null; calls: number; tokens_in: number; tokens_out: number; usd: number }[]>`
        select (at at time zone 'UTC')::date::text as date, stage, coalesce(nullif(model, ''), '—') as model,
               reader_id::int, count(*)::int as calls, sum(tokens_in)::float as tokens_in,
               sum(tokens_out)::float as tokens_out, sum(cost_usd)::float as usd
          from dailynews.model_calls
         where at >= date_trunc('day', now()) - interval '90 days'
         group by 1, 2, 3, 4`,
      // Незакрытые резервы разбора ещё не в model_calls: это обещание
      // расхода, а не расход, и в суммы они не входят.
      tx<{ usd: number }[]>`
        select coalesce(sum(reserved_usd), 0)::float as usd
          from dailynews.reading_calls where status in ('reserved', 'uncertain')`,
      tx<{ code: string; name: string; channel: string; cost_usd: number; created_at: Date; retired_at: Date | null }[]>`
        select code, name, channel, cost_usd::float as cost_usd, created_at, retired_at
          from dailynews.placements order by created_at`,
      // Воронка оплаты: пишут её «Подписка», страница оплаты и вебхук Paddle.
      // Без читателя строка не событие — воронка считает людей.
      tx<BillingRow[]>`
        select id, reader_id::int, name, occurred_at, plan, amount_minor::int, currency, payment_id, refund_id
          from dailynews.billing_events
         where reader_id is not null
         order by occurred_at`,
    ]);
  });

  const subject = (id: number) => `r${id}`;
  const bot = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || null;
  const events: AnalyticsEvent[] = [];
  for (const r of readers) {
    events.push({
      id: `entered-${r.id}`, subjectId: subject(r.id), occurredAt: r.created_at.toISOString(), name: "product_entered",
      // Путь входа, а не нынешние направления: привязанный потом Telegram
      // не делает пришедшего со страницы входа пришедшим из бота.
      surface: r.entered_via === "telegram" ? "telegram" : "web",
      // Кампания — код размещения: по нему кит сводит людей с реестром ссылок.
      ...(r.channel && r.campaign ? { source: r.channel, campaign: r.campaign } : {}),
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

  for (const b of billing) {
    const base = { id: `billing-${b.id}`, subjectId: subject(b.reader_id), occurredAt: b.occurred_at.toISOString(), surface: "web" as const };
    const plan = b.plan ? { plan: b.plan } : {};
    if (b.name === "payment_succeeded" || b.name === "payment_refunded") {
      events.push({
        ...base, ...plan, name: b.name, provider: "paddle", paymentId: b.payment_id!, amountMinor: b.amount_minor!,
        currency: b.currency!, ...(b.refund_id ? { refundId: b.refund_id } : {}),
      });
    } else if (b.name === "checkout_started") {
      events.push({ ...base, ...plan, name: "checkout_started" });
    } else {
      // Просмотр тарифов, триал и отмена — цели: своего имени события у кита
      // для них нет, а шаг воронки по цели он строит.
      events.push({ ...base, ...plan, name: "goal_completed", goal: b.name });
    }
  }

  const lastEventAt = events.reduce<string | null>((last, e) => (last && last > e.occurredAt ? last : e.occurredAt), null);
  return validateDataset({
    schemaVersion: 1,
    mode: "local",
    generatedAt,
    ...profile,
    capabilities: { sessions: false, payments: true, lifecycle: false, crawlers: false, geography: false, identity: true },
    events,
    modelCosts: {
      capturedAt: generatedAt,
      granularity: "day",
      rows: costs.map((c) => ({
        date: c.date, stage: c.stage, model: c.model.slice(0, 120), subjectId: c.reader_id === null ? null : subject(c.reader_id),
        calls: c.calls, tokensIn: Math.round(c.tokens_in), tokensOut: Math.round(c.tokens_out), usd: c.usd,
      })),
      pendingUsd: pending[0]?.usd ?? 0,
      stageLabels: STAGE_LABELS,
    },
    placements: {
      entry: bot ? { kind: "telegram_start", bot } : null,
      items: placements.map((p) => ({
        code: p.code, name: p.name, channel: p.channel, costMinor: Math.round(p.cost_usd * 100), currency: "USD",
        createdAt: p.created_at.toISOString(), retiredAt: p.retired_at?.toISOString() ?? null,
      })),
    },
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
