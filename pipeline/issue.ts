import { sql } from "../src/lib/db";
import type { Reader } from "../src/lib/types";
import { dueDay } from "../src/lib/issue-time";
import {
  allReaders, digestProgress, getReaderTopics, lastActivityAt, pauseReader,
  pendingKindleAsks, perCardOf, readerSources, recordCall, spentToday, wakeReader,
} from "../src/lib/readers";
import { resolve, writeDigest, type Survivor, type Usage } from "./digest";
import { buildPodcast } from "./tts";
import { selectSurvivors, targetsOf } from "./select";
import { askFinished, askResume, botUpsellLine, notify } from "../src/lib/telegram";
import { sendToKindle, kindleDigestVerdict } from "./kindle";
import { enrichImages } from "./og";
import { qualitySample, scoreSummaries } from "./summary-quality";
import { readability } from "./lexicon";
import { formOf } from "../src/lib/reading-evaluation";
import { jevCost, llmCost } from "./cost";
import { FEATURES, issuesToday, sourcesForPlan, targetMinutes } from "../src/lib/plans";
import {
  cardChars, formatMinutes, isShort, itemsForMinutes, minutesOf,
} from "../src/lib/reading-time";
// Лог прогона владельческий и русский: «набран», «материалов», «пропуск».
// Язык читателя сюда не подходит — строку читает тот, кто держит прогон.
import { feed as ruFeed } from "../src/lib/i18n/ru/feed";
import { effectivePlan, effectiveVoice } from "../src/lib/lemon";
import { botMayUpsell, upgradeNote, upgradeReason } from "../src/lib/upgrade";
import { getUpgradeFacts, weekIssues } from "../src/lib/queries";
import { SEARCH_CONFIG, tsConfigFor } from "../src/lib/search";
import { sleepVerdict } from "../src/lib/sleep";
import { rulesOf } from "../src/lib/rules";

const log = (msg: string) => console.log(msg);

/** Что собрал общий этап прогона — кладётся в статистику выпуска, если выпуск пишет прогон. */
export type SharedStats = { collected: number; duplicates: number; scored: number };

/**
 * Забрать выпуск читателя за местный день: true — пишем мы.
 *
 * Отметка до сборки и одним запросом: между проверкой и записью успевает
 * прийти второй сборщик (таймер веба и прогон в Actions приходят
 * независимо), и выпуск ушёл бы дважды.
 */
export async function claimIssue(readerId: number, day: string): Promise<boolean> {
  const claimed = await sql`
    update dailynews.readers set issue_day = ${day}::date
     where id = ${readerId} and (issue_day is null or issue_day < ${day}::date)
    returning id
  `;
  return claimed.length > 0;
}

/**
 * Собрать и отправить выпуск всем, у кого по их поясу наступило 02:00.
 *
 * Зовут двое: таймер в веб-контейнере (раз в десять минут, `instrumentation.ts`)
 * и прогон в Actions сразу после оценки. Прогон один не справился бы: GitHub
 * запускает задачи по расписанию с опозданием в четыре-пять часов, и выпуск
 * «в два ночи» приходил в семь утра. Таймер один — справился бы, но свежий
 * поток лучше всего сразу после сбора. Кто первым поставил `issue_day`,
 * тот и пишет; второй видит отметку и проходит мимо.
 */
export async function issueDue(now = new Date(), shared?: SharedStats): Promise<{ issued: number; cost: number }> {
  let issued = 0;
  let cost = 0;
  for (const reader of await allReaders()) {
    const day = dueDay(reader, now);
    if (!day) continue;
    if (!(await claimIssue(reader.id, day))) continue;
    issued++;
    try {
      cost += await runForReader(reader, day, shared);
      await askAboutYesterday(reader);
    } catch (error) {
      // Один упавший читатель не должен оставить без выпуска остальных.
      // Отметка остаётся: повтор каждые десять минут платил бы за тот же
      // отказ, а догрузить выпуск читатель может кнопкой в ленте.
      console.error(`  ! читатель ${reader.id}: ${(error as Error).message}`);
    }
  }
  return { issued, cost };
}

/**
 * Один выпуск одного читателя. Всё, что здесь происходит, персонально:
 * отбор его весами, текст его языком, уведомление в его чат.
 *
 * Возвращает потраченное, чтобы прогон мог сказать вслух, во что обошёлся
 * день. Молчаливый расход — это счёт в конце месяца вместо строки в логе.
 */
async function runForReader(
  reader: Reader,
  day: string,
  shared?: SharedStats,
): Promise<number> {
  const name = reader.username ? `@${reader.username}` : `читатель ${reader.id}`;

  // Спящий читатель — это выпуск каждую ночь в пустоту. Спрашиваем один раз
  // и замолкаем до ответа: молчание тоже ответ, и оно бесплатное.
  const sleep = sleepVerdict(reader, await lastActivityAt(reader.id));
  if (sleep.verdict === "wake") {
    // Отпуск кончился: возвращаем ленту сами, ничего не переспрашивая.
    await wakeReader(reader.id);
    log(`  ${name}: отпуск кончился — лента возвращается`);
  }
  if (sleep.verdict === "paused") {
    log(`  ${name}: на паузе с ${String(reader.paused_at).slice(0, 10)} — выпуск не пишем`);
    return 0;
  }
  if (sleep.verdict === "ask") {
    await pauseReader(reader.id);
    if (reader.telegram_id) {
      await askResume(Number(reader.telegram_id), sleep.silentDays);
      log(`  ${name}: молчит ${sleep.silentDays} дней — пауза, спросил в боте`);
    } else {
      log(`  ${name}: молчит ${sleep.silentDays} дней — пауза, спросить негде`);
    }
    return 0;
  }

  const plan = effectivePlan(reader);

  // Бесплатный получает ленту через день. Это честнее, чем урезать выпуск:
  // урезанный выглядит как плохой продукт, редкий — как бесплатный.
  if (!issuesToday(plan, reader.id, day)) {
    log(`  ${name}: тариф «${plan.label}» — выпуск через день, сегодня не его ночь`);
    return 0;
  }

  const topics = await getReaderTopics(reader.id);

  // Читатель без интересов пропускается, а не получает пустой выпуск:
  // пустой выпуск выглядит как «сегодня ничего не было».
  if (topics.length === 0) {
    log(`  ${name}: интересы не заданы — пропуск`);
    return 0;
  }

  // Потолок проверяется до вызовов, а не после: узнать о перерасходе
  // постфактум можно и из счёта.
  const spent = await spentToday(reader.id);
  if (spent >= reader.daily_cap_usd) {
    log(`  ${name}: потолок $${reader.daily_cap_usd} исчерпан ($${spent.toFixed(3)}) — пропуск`);
    return 0;
  }

  // Потолок тарифа поверх заказа: digest_minutes мог остаться от прежнего
  // тарифа, а платит за письмо описаний владелец ключа. Тот же потолок
  // стоит на догрузке из интерфейса — иначе он обходился бы кнопкой.
  const voice = effectiveVoice(reader);
  const perCard = await perCardOf(reader);
  const target = targetMinutes(reader.digest_minutes, plan, perCard);

  // Сколько уже лежит в сегодняшнем выпуске. Состав дописывается, а не
  // заменяется: прочитанное утром не должно исчезать из ленты. Но без этого
  // вычитания повторный прогон дописывал бы ещё целый заказ поверх, и выпуск
  // рос бы с каждым запуском — сорок, восемьдесят, сто двадцать. Выглядело бы
  // это как «сегодня много новостей».
  //
  // Набранное вычитается настоящим текстом, а не оценкой: описания уже
  // написаны, и мерить их приблизительно незачем.
  const today = await digestProgress(reader.id, day);
  const missing = itemsForMinutes(
    target - minutesOf(today.chars, voice),
    perCard,
    // Технический потолок тарифа: оценка «сколько карточек в минуту»
    // промахивается, и без него промах оплачивался бы карточками.
    plan.maxItems - today.items,
  );
  if (missing <= 0) {
    // «Набран» не значит «полон»: мест могло не остаться по потолку штук,
    // и тогда выпуск короче заказа. Читатель видит это строкой в ленте,
    // а лог говорил бы, что всё в порядке.
    const filled = minutesOf(today.chars, voice);
    log(
      `  ${name}: выпуск за ${day} ${isShort(filled, target) ? "добирать нечем" : "набран"} ` +
      `(${formatMinutes(filled, ruFeed.time)} из ${Math.round(target)}, ${today.items} материалов) — пропуск`,
    );
    return 0;
  }

  const mySources = sourcesForPlan(await readerSources(reader.id), plan).map((source) => source.id);
  // За чем следить и что исключать — тем же правилом, что у первого
  // выпуска и догрузки: правило, которое работает ночью и не работает
  // по кнопке, читается как настройка, которая иногда не сохраняется.
  const rules = rulesOf(reader);
  const survivors = await selectSurvivors(
    // Порог слабого материала отсчитывается от лучшего за сегодня, а не от
    // лучшего среди оставшихся: второй прогон за сутки иначе пустил бы в
    // выпуск ровно тех, кого отверг первый.
    sql, reader.id, reader.weights, targetsOf(topics), missing, mySources, today.best, rules,
  );
  if (survivors.length === 0) {
    // Исключения названы: пустой отбор при заданном списке — это, скорее
    // всего, список, а не поток, и лог не должен посылать искать поломку
    // в источниках.
    log(`  ${name}: свежих материалов нет${rules.exclude.empty ? "" : " (с учётом исключений)"} — пропуск`);
    return 0;
  }

  // Картинка — свойство материала, а не читателя: качаем только те,
  // которых ещё нет. Иначе один и тот же материал у двадцати читателей
  // означал бы двадцать запросов к изданию за одной и той же картинкой.
  // Каст обязателен: нетипизированный массив уходит в int, а id — bigint.
  const needImage = await sql<{ id: number; url: string }[]>`
    select id, url from dailynews.items
     where id = any(${survivors.map((s) => s.id)}::bigint[]) and image_url is null
  `;
  await enrichImages(needImage, async (id, image) => {
    await sql`update dailynews.items set image_url = ${image} where id = ${id}`;
  });

  const readingStartedAt = new Date();
  const digest = await writeDigest(survivors, reader.reader_context, voice, { readerId: reader.id });
  const writtenById = new Map(digest.items.map((item) => [String(item.id), item]));
  // В выпуск идёт то, что написано. Материал выпадает по двум причинам:
  // его снял личный запрет читателя или проверенной выжимки не вышло —
  // и в обоих случаях карточке в ленте взяться неоткуда.
  const published = survivors.filter(item => writtenById.has(String(item.id)));
  const digestCost = llmCost(digest.usage);
  const [readingAccounting] = await sql<{ cost: number; calls: number }[]>`
    select coalesce(sum(cost_usd), 0)::float as cost, count(*)::int as calls
      from dailynews.reading_calls
     where reader_id = ${reader.id}
       and at >= ${readingStartedAt}
       and status in ('settled', 'uncertain')
  `;
  const readingCost = readingAccounting?.cost ?? 0;
  if (!published.length) { log(`  ${name}: писать нечего — всё снято правилами или не прошло проверку; пустой выпуск не создаётся`); return digestCost + readingCost; }
  if (digest.unavailableIds?.length) log(`  ${name}: без проверенной выжимки — ${digest.unavailableIds.length}, в выпуск они не попали`);

  // Доли форм в выпуске. Это мерка, а не принуждение: переписать карточку
  // ради разнообразия значит заплатить за неё второй раз, а форма берётся
  // из материала, которого у прозаической новости просто нет. Ряд по дням
  // показывает, двигает ли правка промпта что-нибудь на самом деле —
  // до него доля форм была 7 карточек из 35.
  const forms = new Map<string, number>();
  for (const item of digest.items) {
    if (!item.reading) continue;
    const form = formOf(item.reading);
    forms.set(form, (forms.get(form) ?? 0) + 1);
  }
  const shaped = [...forms].filter(([form]) => form !== "brief" && form !== "story").reduce((sum, [, n]) => sum + n, 0);
  if (forms.size) log(`  ${name}: формы — ${[...forms].sort((a, b) => b[1] - a[1]).map(([form, n]) => `${form} ${n}`).join(", ")}`);
  if (!digest.accounted) await recordCall({
    readerId: reader.id, stage: "digest", model: digest.model,
    tokensIn: digest.usage.input, tokensOut: digest.usage.output, costUsd: digestCost,
  });

  // Вторая петля Jev: тот же инструмент оценивает не входящий поток,
  // а собственный выход. Правка промпта либо улучшает ряд чисел, либо нет —
  // на глаз двенадцать описаний в день всегда читаются нормально.
  //
  // Меряем у одного читателя и по выборке: промпт один на всех, и сотня
  // описаний у каждого — это один и тот же ответ, оплаченный столько раз,
  // сколько у нас читателей. Ряд по дням от этого не страдает, а вход
  // петли дороже входа самого дайджеста: 3170 токенов на описание против 527.
  const measuresQuality = reader.owner && !digest.accounted;
  const quality = measuresQuality
    ? await scoreSummaries(
        qualitySample(digest.items).map((item: (typeof digest.items)[number]) => ({
          id: Number(item.id), title: item.title_ru, summary: item.summary,
        })),
        reader.reader_context,
      )
    : null;
  const qualityCost = quality ? jevCost(quality.inputTokens) : 0;
  if (quality) {
    await recordCall({
      readerId: reader.id, stage: "summary", model: quality.model,
      tokensIn: quality.inputTokens, costUsd: qualityCost,
    });
  }

  // Ноль сюда писать нельзя: он неотличим от настоящего нуля и утянул бы
  // ряд вниз у всех, кому замер не делался.
  const meanQuality = quality?.scored.length
    ? quality.scored.reduce((sum, row) => sum + row.total, 0) / quality.scored.length
    : null;

  /**
   * Сколько времени займёт выпуск. Считается по написанному тексту, а не
   * по заказу: карточек столько, сколько уложилось, и разница между
   * заказанным и вышедшим — это и есть то, о чём читателю говорят вслух.
   */
  const minutes = minutesOf(
    today.chars +
      published.reduce((chars, survivor) => {
        const text = writtenById.get(String(survivor.id));
        return chars + cardChars(text?.title_ru ?? survivor.title, text?.summary ?? "");
      }, 0),
    voice,
  );

  // Ползунок сложности меняет промпт — а меняется ли текст, видно только
  // по ряду этих двух чисел рядом с положением ползунка.
  const measured = digest.items.map((item) => readability(item.summary));
  const mean = (pick: (r: { perSentence: number; longShare: number }) => number) =>
    measured.length ? measured.reduce((sum, r) => sum + pick(r), 0) / measured.length : 0;
  const perSentence = mean((r) => r.perSentence);
  const longShare = mean((r) => r.longShare);

  const [row] = await sql<{ id: number }[]>`
    insert into dailynews.digests (reader_id, day, intro, stats)
    values (
      ${reader.id}, ${day}, ${digest.intro},
      ${sql.json({
        ...shared,
        flagged: digest.flagged ?? 0,
        summary_quality: meanQuality === null ? null : Number(meanQuality.toFixed(1)),
        complexity: reader.complexity,
        plan: plan.id,
        words_per_sentence: Number(perSentence.toFixed(1)),
        long_word_share: Number(longShare.toFixed(3)),
        // Заказ и то, что вышло, — рядом: обещание, которого никто не мерит,
        // расходится с выпуском молча, и узнаётся это от читателя.
        reading_target: Number(target.toFixed(1)),
        reading_minutes: Number(minutes.toFixed(1)),
        // Что на самом деле ушло в провайдера: модель выводит writeDigest,
        // своя копия резолюции разошлась бы с ней на пустой строке.
        digest_model: digest.model,
        reading_version: reader.reading_v2_enabled ? 2 : null,
        reading_verified: digest.items.filter(item => item.reading?.status === "verified").length,
        reading_unavailable: digest.unavailableIds?.length ?? 0,
        reading_forms: Object.fromEntries(forms),
        reading_shaped: shaped,
        digest_input_tokens: digest.usage.input,
        digest_cached_tokens: digest.usage.cached,
        digest_output_tokens: digest.usage.output,
        digest_reasoning_tokens: digest.usage.reasoning,
        digest_reasoning_effort: digest.reasoningEffort,
        jev_input_tokens: quality?.inputTokens ?? 0,
        // reading-v2 пишет фактические вызовы отдельно; без этой суммы
        // статистика выпуска показывала только старый writeDigest.
        reading_cost_usd: Number(readingCost.toFixed(5)),
        reading_calls: readingAccounting?.calls ?? 0,
        cost_usd: Number((digestCost + readingCost + qualityCost).toFixed(5)),
        // Объект, а не JSON.stringify: лишний stringify кладёт в jsonb
        // строку, и stats->>'cost_usd' молча возвращает null.
      } as unknown as Parameters<typeof sql.json>[0])}
    )
    on conflict (reader_id, day) do update set intro = excluded.intro, stats = excluded.stats
    returning id::int as id
  `;

  const [{ taken }] = await sql<{ taken: number }[]>`
    select count(*)::int as taken from dailynews.digest_items where digest_id = ${row.id}
  `;

  const qualityById = new Map((quality?.scored ?? []).map((q) => [String(q.item_id), q]));

  for (const [index, survivor] of published.entries()) {
    const written = writtenById.get(String(survivor.id));
    const scored = qualityById.get(String(survivor.id));
    // Текст пишется сюда, а не в items: язык, сложность и манера персональны,
    // и общая колонка означала бы, что второй читатель переписывает ленту
    // первого своим языком. Словарь поиска — тоже свойство выпуска:
    // вектор описания считается им при записи (0050), и искать выпуск
    // будут им же, каким бы ни был язык читателя потом.
    await sql`
      insert into dailynews.digest_items
        (digest_id, item_id, total, position, title, summary, summary_document, summary_axes, summary_score,
         ts_config)
      values (
        ${row.id}, ${survivor.id}, ${survivor.total}, ${taken + index + 1},
        ${written?.title_ru ?? survivor.title}, ${written?.summary ?? ""},
        ${written?.reading ? sql.json(written.reading) : null},
        ${scored ? sql.json(scored.axes as unknown as Parameters<typeof sql.json>[0]) : null},
        ${scored?.total ?? null},
        -- Имя словаря сверяется с каталогом, а не приводится к regconfig
        -- напрямую: неизвестное имя роняло бы вставку уже оплаченного
        -- выпуска. Нет такого словаря — общий, как у строк по умолчанию.
        coalesce(
          (select oid from pg_ts_config where cfgname = ${tsConfigFor(voice.language)}),
          ${SEARCH_CONFIG}::regconfig::oid
        )::regconfig
      )
      on conflict (digest_id, item_id) do update
        set title=excluded.title, summary=excluded.summary, summary_document=excluded.summary_document,
            ts_config=excluded.ts_config
        where dailynews.digest_items.summary_document->>'status'='unavailable'
          and excluded.summary_document->>'status'='verified'
    `;
  }

  log(
    `  ${name}: ${formatMinutes(minutes, ruFeed.time)} из ${Math.round(target)} заказанных, ` +
    `${published.length} материалов, ` +
    (meanQuality === null
      ? (reader.reading_v2_enabled ? "выжимки сверены с доступным источником, " : "качество не меряли (промпт один на всех), ")
      : `качество ${meanQuality.toFixed(0)} из 85 по ${quality?.scored.length} описаниям, `) +
    `${perSentence.toFixed(1)} слов в предложении (ползунок ${reader.complexity} из 5), ` +
    `$${(digestCost + readingCost + qualityCost).toFixed(4)}`,
  );
  // Рассуждение тарифицируется как выход и в ответ не попадает: без этой
  // строки главная статья счёта выглядит как длинный текст.
  log(
    `    ${digest.usage.requests} запроса, ${digest.usage.input} вх ` +
    `(${digest.usage.cached} из кэша), ${digest.usage.output} вых ` +
    `(${digest.usage.reasoning} рассуждение)`,
  );

  // Недобор называется вслух и здесь: молча пришедший короткий выпуск
  // неотличим от поломки отбора. Причина не называется — их три (порог
  // слабого материала, потолок штук тарифа, бедный поток), и угаданная
  // отправит чинить не то: строка, объясняющая недобор, не должна сама
  // быть догадкой.
  if (isShort(minutes, target)) {
    log(`    недобор: подходящего меньше, чем заказано`);
  }

  await deliver(reader, day, digest.intro, published, writtenById, name, { minutes, target });
  return digestCost + readingCost + qualityCost;
}

/** Доставка: ссылка в Telegram и, если подключён, выпуск книгой в Kindle. */
async function deliver(
  reader: Reader,
  day: string,
  intro: string,
  survivors: Survivor[],
  writtenById: Map<string, { title_ru: string; summary: string; reading?: import("../src/lib/reading-document").StoredReading }>,
  name: string,
  reading: { minutes: number; target: number },
): Promise<void> {
  const titleOf = (s: Survivor) => writtenById.get(String(s.id))?.title_ru ?? s.title;

  // Без явного адреса уведомление не отправляется. Дефолтный домен —
  // худший вид ошибки: он выглядит правдоподобно, почти наверняка занят
  // чужим сайтом, и ссылка «Читать» молча уводит читателя туда.
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) {
    log("  APP_URL не задан — уведомления пропущены, выпуски сохранены");
  } else if (!reader.telegram_id) {
    // Молчаливый пропуск здесь неотличим от доставки: выпуск в базе есть,
    // ошибок нет, а читатель о нём не знает.
    log(`  ${name}: Telegram не привязан — уведомление пропущено`);
  } else {
    // Подкаст собирается до уведомления, потому что едет тем же сообщением
    // отдельным блоком аудио: списку и записи незачем приходить порознь.
    //
    // Тумблер и тариф спрашиваются оба. Тумблер — потому что час звука
    // каждую ночь включают сами; тариф — потому что он мог кончиться уже
    // после того, как тумблер включили, и тогда корона над кнопкой
    // в ленте означала бы одно, а прогон делал бы другое.
    //
    // В дневную квоту (`audioSecondsPerDay`) это не пишется намеренно:
    // квота защищает от того, что читатель нащёлкает сам, а выпуск голосом
    // приходит один раз в сутки и размером ровно с выпуск. Засчитанный,
    // он выбирал бы её целиком, и кнопка «озвучить» отказывала бы весь день
    // за то, чего читатель не просил.
    let podcast: Awaited<ReturnType<typeof buildPodcast>> | null = null;
    if (reader.podcast && FEATURES.audio.has(effectivePlan(reader))) {
      const usage: Usage = { requests: 0, input: 0, output: 0, cached: 0, reasoning: 0 };
      try {
        podcast = await buildPodcast(reader, survivors.map((s) => Number(s.id)), usage);
        log(`  ${name}: подкаст — ${podcast.titles.length} карточек, ${Math.round(podcast.seconds / 60)} мин`);
      } catch (error) {
        // Выпуск важнее записи: не собралась — уходит сообщение без неё
        // и без меток времени, а не молчание.
        log(`  ${name}: подкаст не собрался — ${(error as Error).message}`);
      }
      if (usage.requests > 0) {
        await recordCall({
          readerId: reader.id, stage: "spoken-terms", model: resolve().model,
          tokensIn: usage.input, tokensOut: usage.output, costUsd: llmCost(usage),
        });
      }
    }
    /**
     * Предел, в который читатель упёрся, — одной строкой в конце сообщения.
     *
     * Правило то же, что у строки под выпуском в ленте (`upgradeReason`):
     * два места показа, сказавшие разное про один день, читались бы как две
     * разные ленты. Частота своя и реже: сообщение приходит само.
     *
     * Отказ здесь не стоит выпуска — предложение это не доставка.
     */
    let upsell: string | null = null;
    try {
      if (botMayUpsell(reader.upsell_at)) {
        const plan = effectivePlan(reader);
        const mine = sourcesForPlan(await readerSources(reader.id), plan).map((one) => Number(one.id));
        // `issuesToday` здесь всегда истина: сообщение шлётся только в тот
        // день, когда выпуск собрался. Про частоту в чате говорить нечего —
        // читатель как раз получает выпуск.
        const facts = { ...(await getUpgradeFacts(reader.id, mine)), kept: survivors.length, issuesToday: true };
        const found = upgradeReason(plan, facts);
        if (found) upsell = botUpsellLine(plan, upgradeNote(plan, found, facts), appUrl);
      }
    } catch (error) {
      // Предложение — не доставка: не посчиталось, уходит выпуск без него.
      log(`  ${name}: предложение тарифа не посчиталось — ${(error as Error).message}`);
    }

    try {
      await notify(
        Number(reader.telegram_id), day,
        survivors.map((s) => ({
          id: Number(s.id),
          title: titleOf(s),
          topic: s.topic_label,
          at: podcast?.at.get(Number(s.id)) ?? null,
        })),
        appUrl,
        reading,
        podcast,
        upsell,
      );
      await sql`
        update dailynews.digests set sent_at = now()
         where reader_id = ${reader.id} and day = ${day}
      `;
      // Отметка ставится по факту отправки, а не по факту расчёта: упавшее
      // сообщение не должно запирать предложение на неделю.
      if (upsell) {
        await sql`update dailynews.readers set upsell_at = now() where id = ${reader.id}`;
      }
    } catch (error) {
      // Заблокировавший бота читатель не должен ронять прогон остальных.
      log(`  ${name}: Telegram — ${(error as Error).message}`);
    }
  }

  const kindle = kindleDigestVerdict(reader, day);
  if (!kindle.send) {
    // Пустой адрес — читатель не просил, говорить не о чем. Остальные
    // причины он должен увидеть: одни сбой, другие его собственный выбор.
    // «Не суббота» молчит: это шесть дней из семи, и строка о ней в логе
    // означала бы, что каждый прогон отчитывается о том, чего не делал.
    if (kindle.reason === "no-sender") {
      log(`  ${name}: Kindle — обратный адрес не выдан, отправка пропущена`);
    } else if (kindle.reason === "switched-off") {
      log(`  ${name}: Kindle — выпуск выключен в настройках`);
    } else if (kindle.reason === "weekly-sent") {
      log(`  ${name}: Kindle — недельная книга за ${day} уже уходила`);
    }
    return;
  }
  try {
    // Дневная книга собирается из того, что только что написано, недельная
    // — из базы: шесть предыдущих выпусков уже лежат там, и сегодняшний
    // тоже (digest_items записаны до доставки). Второй путь чтения
    // сегодняшнего выпуска разошёлся бы с первым ровно в тот день, когда
    // это никто не проверит.
    const issues =
      kindle.period === "weekly"
        ? await weekIssues(reader.id, day)
        : [{
            day,
            intro,
            articles: survivors.map((s) => ({
              title: titleOf(s),
              summary: writtenById.get(String(s.id))?.summary ?? s.excerpt,
              reading: writtenById.get(String(s.id))?.reading,
              url: s.url,
              source_label: s.source_label,
              topic_label: s.topic_label,
            })),
          }];

    if (issues.length === 0) {
      // Неделя без единого выпуска — это пауза, отпуск или сбой прогона,
      // и пустая книга в библиотеке читалки выглядела бы ответом «новостей
      // не было».
      log(`  ${name}: Kindle — за неделю до ${day} выпусков нет, книга не отправлена`);
      return;
    }

    const sent = await sendToKindle({ to: kindle.to, sender: kindle.sender, issues });
    if (sent && kindle.period === "weekly") {
      // Отметка по факту отправки, а не по факту сборки: упавшее письмо
      // не должно запирать книгу на неделю.
      await sql`
        update dailynews.readers set kindle_weekly_at = ${day}::date where id = ${reader.id}
      `;
    }
    const what =
      kindle.period === "weekly"
        ? `Kindle: книга за неделю, ${issues.length} выпуска(ов)`
        : "Kindle отправлен";
    log(sent ? `  ${name}: ${what}` : `  ${name}: RESEND_API_KEY не задан — Kindle пропущен`);
  } catch (error) {
    log(`  ${name}: Kindle — ${(error as Error).message}`);
  }
}


/**
 * Спросить про вчерашние отправки на читалку: дочитал или не пошло.
 *
 * Отправка — единственная часть продукта без петли измерения. Отбор
 * калибруется открытиями, описания — шестью осями Jev, а про книгу
 * на читалке никто не знает ничего: Amazon обратно не говорит и не может.
 *
 * Спрашиваем на следующий день, а не в тот же вечер: вечером он её
 * и читает. Один вопрос на статью — повторно уже спрошенное не трогаем,
 * иначе бот превращается в напоминалку, которую выключают.
 */
async function askAboutYesterday(reader: Reader): Promise<void> {
  if (!reader.telegram_id) return;
  const pending = await pendingKindleAsks(reader.id);

  for (const row of pending) {
    try {
      await askFinished(Number(reader.telegram_id), row.item_id, row.title);
    } catch (error) {
      // Заблокировавший бота читатель не должен ронять прогон остальных.
      log(`  читатель ${reader.id}: вопрос о дочитывании — ${(error as Error).message}`);
    }
  }
}

