import { PLAN_IDS, PLANS, type FeatureId, type Plan, type PlanId } from "./plans";

/**
 * Когда стоит сказать про тариф — и, главное, когда не стоит.
 *
 * Предложение живёт здесь чистой функцией, а не в разметке ленты и не
 * в письме бота, потому что мест показа два и они обязаны решать одинаково:
 * строка под выпуском и блок в сообщении, сказавшие разное про один и тот же
 * день, читаются как две разные ленты. Ту же роль играет `FEATURES[id].has`
 * у короны — одно правило на все экраны.
 *
 * **Называется предел, в который читатель уже упёрся, а не тариф.** «Возьми
 * Plus» — это про нас; «лента следит за пятью источниками, это весь
 * бесплатный тариф» — про то, что с ним происходит прямо сейчас. Второе
 * можно проверить глазами на том же экране, первое нет.
 */

/** В какой предел упёрся читатель. Порядок — приоритет показа, см. ниже. */
export const UPGRADE_REASONS = ["cadence", "sources", "topics", "minutes"] as const;
export type UpgradeReason = (typeof UPGRADE_REASONS)[number];

/** Какая возможность снимает этот предел: по ней же считается, кому предлагать. */
const FEATURE_OF: Record<UpgradeReason, FeatureId> = {
  cadence: "cadence",
  sources: "sources",
  topics: "topics",
  minutes: "digest",
};

export type UpgradeFacts = {
  /** Сколько источников выбрано. Предел — `plan.maxSources`. */
  sources: number;
  /** Сколько интересов заведено. Предел — `plan.maxTopics`. */
  topics: number;
  /** Сколько материалов собрали его источники за сутки. */
  collected: number;
  /** Сколько из них дошло до сегодняшнего выпуска. */
  kept: number;
  /**
   * Открывал ли он хоть одну карточку за последнюю неделю.
   *
   * Без этого предложение уходит тому, кто продукт ещё не попробовал,
   * — то есть просьба заплатить за то, чего человек не видел. У единственного
   * внешнего читателя на 22 сентября 2026 было восемь показов и ноль
   * открытий: ему надо чинить выпуск, а не продавать следующий тариф.
   */
  active: boolean;
  /** Приходит ли выпуск сегодня. На бесплатном — через день. */
  issuesToday: boolean;
};

export type Upgrade = { reason: UpgradeReason; to: Plan };

/**
 * Что предложить этому читателю сегодня, или null.
 *
 * Порядок причин — это порядок заметности предела, а не выгоды для нас.
 * Пропущенный день виден сразу и без объяснений; исчерпанный список
 * источников виден, когда за ним пришли; длина выпуска — только если
 * сравнить с потоком. Поэтому первое проверяется первым.
 *
 * Молчим, если предлагать нечего: у Pro пределов выше нет, и строка
 * «на Pro больше» на самом Pro — это реклама тому, кто уже купил.
 */
export function upgradeReason(plan: Plan, facts: UpgradeFacts): Upgrade | null {
  if (!facts.active) return null;

  for (const reason of UPGRADE_REASONS) {
    if (!hit(reason, plan, facts)) continue;
    const to = nextFor(reason, plan);
    if (to) return { reason, to };
  }
  return null;
}

/**
 * Куда звать: самый дешёвый тариф дороже текущего, у которого **этот самый**
 * предел выше.
 *
 * Не `cheapestFor(feature)`: тот отвечает на «где возможность вообще есть»,
 * а здесь вопрос другой — «где её больше, чем у меня сейчас». Разница видна
 * на Plus, упёршемся в свои сорок источников: возможность у него уже есть,
 * и `cheapestFor` назвал бы его собственный тариф, то есть предложил бы
 * перейти туда, где он и так стоит.
 */
function nextFor(reason: UpgradeReason, plan: Plan): Plan | null {
  const limit = LIMIT_OF[reason];
  return PLAN_IDS.map((id) => PLANS[id])
    .filter((candidate) => candidate.price > plan.price && limit(candidate) > limit(plan))
    .sort((a, b) => a.price - b.price)[0] ?? null;
}

/**
 * Чем меряется предел. Частота — наоборот: реже значит хуже, поэтому
 * сравнивается обратная величина, а не `everyDays`.
 */
const LIMIT_OF: Record<UpgradeReason, (plan: Plan) => number> = {
  cadence: (plan) => 1 / plan.everyDays,
  sources: (plan) => plan.maxSources,
  topics: (plan) => plan.maxTopics,
  minutes: (plan) => plan.maxMinutes,
};

function hit(reason: UpgradeReason, plan: Plan, facts: UpgradeFacts): boolean {
  switch (reason) {
    // Сегодня выпуска нет вовсе, и это самый заметный предел продукта:
    // человек открыл ленту и увидел вчерашнее.
    case "cadence":
      return plan.everyDays > 1 && !facts.issuesToday;
    // Мест больше нет — ровно та же проверка, по которой форма источников
    // открывает окно с предложением.
    case "sources":
      return facts.sources >= plan.maxSources;
    case "topics":
      return facts.topics >= plan.maxTopics;
    // Отброшено больше, чем дошло: поток вдвое шире выпуска, и разница —
    // это не «мы плохо отобрали», а «заказано мало времени». Порог именно
    // вдвое, а не «что-то отброшено»: отбрасывается всегда, и строка,
    // горящая каждый день, ничем не отличается от выключенной.
    case "minutes":
      return facts.kept > 0 && facts.collected - facts.kept >= facts.kept;
  }
}

/** Есть ли вообще куда расти: у самого дорогого тарифа предложения нет. */
export const canUpgrade = (plan: Plan): boolean =>
  UPGRADE_REASONS.some((reason) => nextFor(reason, plan) !== null);

/**
 * Возможность, которую открывает предложение: по ней рисуется окно пейвола
 * и считается корона. Правило одно — иначе строка звала бы на Plus,
 * а окно предлагало Pro.
 */
export const featureOf = (reason: UpgradeReason): FeatureId => FEATURE_OF[reason];

/**
 * Всё, что нужно строке: причина, куда звать и числа по обе стороны.
 *
 * Собирается здесь, а не в разметке: числа берутся из `PLANS`, и таблица,
 * живущая отдельно от кода, который её применяет, расходится с ним молча.
 * В браузер при этом уезжает готовый ответ, а не тарифы и поток целиком.
 */
export type UpgradeNote = {
  reason: UpgradeReason;
  /** Тариф, куда зовём. Идентификатор, а не объект: подпись берётся из словаря. */
  plan: PlanId;
  /** Предел сейчас и предел там. Для частоты — дни между выпусками. */
  from: number;
  to: number;
  /** Только для «minutes»: сколько собрали за сутки и сколько дошло. */
  collected: number;
  kept: number;
};

export function upgradeNote(plan: Plan, { reason, to }: Upgrade, facts: UpgradeFacts): UpgradeNote {
  const limits: Record<UpgradeReason, [number, number]> = {
    cadence: [plan.everyDays, to.everyDays],
    sources: [plan.maxSources, to.maxSources],
    topics: [plan.maxTopics, to.maxTopics],
    minutes: [plan.maxMinutes, to.maxMinutes],
  };
  const [from, upTo] = limits[reason];
  return { reason, plan: to.id, from, to: upTo, collected: facts.collected, kept: facts.kept };
}

/**
 * Сколько дней молчать после показа в боте.
 *
 * В ленте предложение живёт строкой и его видно ровно тогда, когда читатель
 * сам пришёл. В чат оно приходит само, и каждую ночь это спам, а не забота —
 * тот же довод, по которому спящих спрашивают один раз. Неделя, потому что
 * выпуск приходит ежедневно: реже — и про тариф не узнают вовсе, чаще —
 * и сообщение перестают читать целиком.
 */
export const UPSELL_QUIET_DAYS = 7;

/** Пора ли снова сказать про тариф в чате. */
export function botMayUpsell(lastAt: Date | string | null, now = new Date()): boolean {
  if (!lastAt) return true;
  const was = new Date(lastAt).getTime();
  if (!Number.isFinite(was)) return true;
  return now.getTime() - was >= UPSELL_QUIET_DAYS * 86_400_000;
}
