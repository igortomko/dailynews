"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "./db";
import { checkPassword, issueSession, SESSION_COOKIE } from "./auth";
import { currentReader, currentReaderId } from "./session";
import { discover, planFor, probeOne, type Found } from "../../pipeline/discover";
import { selectSurvivors, targetsOf } from "../../pipeline/select";
import { writeDigest } from "../../pipeline/digest";
import { scoreSummaries } from "../../pipeline/summary-quality";
import { enrichImages } from "../../pipeline/og";
import { freezeKindleSender, getReader, getReaderTopics, recordCall, spentToday } from "./readers";
import { llmCost, jevCost } from "../../pipeline/cost";
import type { Source } from "./types";
import { MIN_PER_TOPIC, normalize } from "./topic-budget";
import {
  allows, cheapestWith, kindDenial, maxDigestOf, sourcesForPlan, topicsWord,
  PLAN_IDS, PLANS, digestCap, type Gated,
} from "./plans";
import { effectivePlan } from "./lemon";
import { getSources } from "./queries";
import { toSlug } from "./slug";

/**
 * Запасной вход владельца. Читатели входят ссылкой из бота; пароль остаётся
 * на случай, когда Telegram недоступен, и пускает ровно в ту строку, которая
 * была перенесена из profile.
 */
export async function login(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!(await checkPassword(password))) {
    return { error: "Пароль не подходит" };
  }
  const [owner] = await sql<{ id: number }[]>`
    select id::int as id from dailynews.readers where owner
  `;
  if (!owner) return { error: "Такого входа сейчас нет — войди через бота" };

  const session = await issueSession(owner.id);
  (await cookies()).set(session.name, session.value, session.options);
  redirect(String(formData.get("next") || "/"));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

/** `count` — цель по числу новостей в день; в базе это `reader_topics.weight`. */
export type ChipInput = { slug: string; label: string; hint: string; count: number };

/**
 * Персонализация и интересы — две формы, поэтому два действия. Одна функция
 * с ветками «пришло ли поле» молча очищала бы то, чего в форме нет.
 */
/**
 * Закрытый раздел проверяется и в действии, а не только на странице:
 * действие вызывается по своему адресу, мимо страницы с заглушкой.
 */
async function denyBySection(section: Gated): Promise<{ error: string } | null> {
  const plan = effectivePlan(await currentReader());
  if (allows(plan, section)) return null;
  return { error: `Раздел доступен на тарифе «${cheapestWith(section).label}»` };
}

export async function savePersonalization(formData: FormData) {
  const readerId = await currentReaderId();

  // Язык — свободный текст: список из трёх выбирал автор формы, а не читатель.
  const language = String(formData.get("language") ?? "").trim().slice(0, 60) || "русском";
  const readerContext = String(formData.get("reader_context") ?? "").slice(0, 4000);
  // Ползунок шлёт строку, а нечисло превратилось бы в NaN и уронило запрос
  // ограничением, а не подсказкой. Держим в границах колонки здесь же.
  const asked = Number(formData.get("complexity"));
  const complexity = Math.min(5, Math.max(1, Math.round(Number.isFinite(asked) ? asked : 3)));
  const style = String(formData.get("style") ?? "").trim().slice(0, 40) || "нейтральный";

  await sql`
    update dailynews.readers
       set reader_context = ${readerContext},
           language = ${language},
           complexity = ${complexity},
           style = ${style},
           onboarded_at = coalesce(onboarded_at, now()),
           updated_at = now()
     where id = ${readerId}
  `;
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Интересы и бюджет внимания — одна форма: сколько новостей в день и как они
 * делятся между темами, задаётся одним движением. Поэтому размер дайджеста
 * сохраняется здесь, и только здесь: у поля должен быть один владелец, иначе
 * вторая форма, где этого поля нет, молча вернёт его к минимуму.
 */
export async function saveInterests(formData: FormData) {
  const readerId = await currentReaderId();
  const chips = JSON.parse(String(formData.get("chips") ?? "[]")) as ChipInput[];
  if (chips.length === 0) return { error: "Добавь хотя бы один интерес" };

  // Предел проверяется на сервере, а не только в форме: форму рисует
  // браузер, а платит за лишние темы владелец ключа.
  const plan = effectivePlan(await currentReader());
  if (chips.length > plan.maxTopics) {
    return {
      error:
        `На тарифе «${plan.label}» можно ${plan.maxTopics} ${topicsWord(plan.maxTopics)}, ` +
        `а выбрано ${chips.length}`,
    };
  }

  const slugs = chips.map((chip) => chip.slug || toSlug(chip.label));
  // Разные названия дают один slug: «ИИ-инфра» и «ИИ инфра» после
  // транслитерации совпадают, on conflict схлопывает их в одну строку,
  // и цель первой темы теряется. Сумма целей молча перестаёт равняться
  // размеру дайджеста — полоса показывает одно, приходит другое.
  if (new Set(slugs).size !== slugs.length) {
    return { error: "Такой интерес уже есть — назови иначе" };
  }
  const digestSize = Math.min(
    maxDigestOf(plan),
    Math.max(3, Math.round(Number(formData.get("digest_size"))) || plan.digestSizes[0]),
  );
  // Приводим ещё раз на сервере: из формы приходит то, что нарисовал
  // браузер, а сумма целей — это и есть обещание размера дайджеста.
  const counts = normalize(
    chips.map((chip) => Math.max(MIN_PER_TOPIC, Math.round(Number(chip.count)) || MIN_PER_TOPIC)),
    digestSize,
  );

  await sql.begin(async (tx) => {
    await tx`
      update dailynews.readers
         set digest_size = ${digestSize},
             onboarded_at = coalesce(onboarded_at, now()),
             updated_at = now()
       where id = ${readerId}
    `;

    const ids: number[] = [];
    for (const [index, chip] of chips.entries()) {
      // Справочник общий: по нему Jev классифицирует поток один раз на всех.
      // Название и подсказку существующей темы вторым читателем не
      // переписываем — этим он менял бы критерий классификации всем, и
      // заметить это можно было бы только по съехавшим темам чужих лент.
      const [topic] = await tx<{ id: number }[]>`
        insert into dailynews.topics (slug, label, hint, position)
        values (${slugs[index]}, ${chip.label}, ${chip.hint ?? ""}, ${index + 1})
        on conflict (slug) do update set slug = excluded.slug
        returning id::int as id
      `;
      ids.push(topic.id);
    }

    // Убранная тема — удалённая строка связки, а не флаг: отбор сразу
    // перестаёт считать её бюджет. Сама тема остаётся в справочнике,
    // на неё ссылаются уже сделанные оценки.
    await tx`
      delete from dailynews.reader_topics
       where reader_id = ${readerId} and topic_id <> all(${ids}::bigint[])
    `;

    for (const [index, topicId] of ids.entries()) {
      // Цель по числу новостей и есть вес темы: отбор делит номер материала
      // внутри темы на неё, и при сумме, равной размеру дайджеста, каждая
      // тема получает примерно столько, сколько здесь написано.
      await tx`
        insert into dailynews.reader_topics (reader_id, topic_id, weight, position)
        values (${readerId}, ${topicId}, ${counts[index]}, ${index + 1})
        on conflict (reader_id, topic_id) do update
          set weight = excluded.weight, position = excluded.position
      `;
    }
  });

  revalidatePath("/", "layout");
  return { ok: true as const };
}



/**
 * Адрес Kindle. Обратный адрес не трогаем: он выдан один раз при заведении
 * и заморожен — каждая его смена означает, что читатель заново проходит
 * одобрение отправителя в настройках Amazon, а до тех пор выпуски молча
 * не доходят.
 */
/**
 * Переключатель выпуска на экране «настроено». Только он, без адреса.
 *
 * Общее действие «сохранить всё, что на форме» здесь было бы ловушкой:
 * адрес на этом экране — строка, а не поле, в FormData он не приходит,
 * и прочитанный как пустой обнулил бы доставку при нажатии «Сохранить».
 */
export async function saveKindleDigest(formData: FormData) {
  const denied = await denyBySection("delivery");
  if (denied) return denied;

  const readerId = await currentReaderId();
  // Флажок приходит только когда включён: выключенный checkbox формы
  // не отправляется вовсе, и `null` здесь значит «выключен», а не «не трогали».
  const digest = formData.get("kindle_digest") !== null;

  await sql`
    update dailynews.readers
       set kindle_digest = ${digest}, updated_at = now()
     where id = ${readerId}
  `;
  revalidatePath("/settings/delivery");
  return { ok: true as const };
}

/**
 * Первый шаг настройки Kindle: куда слать. Отдельно от переключателя, потому
 * что на этом шаге его на экране ещё нет: общее действие прочитало бы
 * отсутствие флажка как «выключен» и погасило бы отправку тому,
 * кто проходит настройку заново.
 */
export async function saveKindleAddress(formData: FormData) {
  const denied = await denyBySection("delivery");
  if (denied) return denied;

  const readerId = await currentReaderId();
  const address = String(formData.get("kindle_address") ?? "").trim().toLowerCase().slice(0, 120);
  if (!address) return { error: "Впиши адрес читалки" };
  if (!/^[^@\s]+@kindle\.com$/.test(address)) {
    return { error: "Адрес должен заканчиваться на @kindle.com" };
  }

  await sql`
    update dailynews.readers
       set kindle_address = ${address}, updated_at = now()
     where id = ${readerId}
  `;
  const reader = await getReader(readerId);
  if (reader) await freezeKindleSender(readerId, reader.telegram_id);
  revalidatePath("/settings/delivery");
  return { ok: true as const };
}

/**
 * Второй шаг: читатель подтверждает, что добавил наш адрес в одобренные.
 * Проверить это снаружи нечем — Amazon молчит и про успех, и про отказ,
 * а неодобренное письмо просто исчезает. Поэтому шаг закрывает человек.
 *
 * С этого момента обратный адрес заморожен: в Amazon записан именно он.
 */
export async function approveKindleSender() {
  const denied = await denyBySection("delivery");
  if (denied) return denied;

  const readerId = await currentReaderId();
  await sql`
    update dailynews.readers
       set kindle_approved = true, updated_at = now()
     where id = ${readerId} and kindle_address is not null
  `;
  revalidatePath("/settings/delivery");
  return { ok: true as const };
}

/**
 * Пройти настройку заново — с первого шага.
 *
 * Снимается и подтверждение, и адрес читалки. Оставить адрес значило бы,
 * что шаг настройки считается по-разному на экране и в базе: клиент показал
 * бы первый шаг, а перезагрузка страницы вернула бы на второй, потому что
 * адрес на месте. Разъехавшиеся состояния здесь — это ровно та тихая ошибка,
 * которую потом ищут глазами.
 *
 * Вместе с подтверждением размораживается обратный адрес: смысл сброса
 * в том, чтобы одобрить в Amazon заново, а значит и отправителя можно менять.
 */
export async function resetKindleSetup() {
  const denied = await denyBySection("delivery");
  if (denied) return denied;

  const readerId = await currentReaderId();
  await sql`
    update dailynews.readers
       set kindle_approved = false, kindle_address = null, updated_at = now()
     where id = ${readerId}
  `;
  revalidatePath("/settings/delivery");
  return { ok: true as const };
}

/**
 * Каталог источников общий, поэтому правит его владелец. Это не роли:
 * удаление источника уносит каскадом собранные материалы, и у такой кнопки
 * не должно быть ста рук.
 */
async function requireOwner() {
  const reader = await currentReader();
  if (!reader.owner) redirect("/settings/sources");
  return reader;
}

/**
 * Разобрать вставленную ссылку: что это за источник, где у него фид и как он
 * называется. Ничего не сохраняет — показывает, что нашлось, чтобы читатель
 * подтвердил. Тип источника знать не нужно, название уже лежит в фиде.
 *
 * Тоже под владельцем: каталог общий, а разбор ходит в сеть — у такой кнопки
 * не должно быть ста рук.
 */
export async function discoverSource(input: string): Promise<
  { ok: true; found: Found } | { ok: false; error: string }
> {
  await requireOwner();
  const raw = input.trim().slice(0, 500);
  if (!raw) return { ok: false, error: "Вставь ссылку" };

  // Тариф спрашивается до сети. Какой это будет вид, planFor знает без
  // единого запроса, а разбор ссылки X — уже платный запрос к twitterapi.io:
  // потратить деньги и отказать после сохранения значит взять плату
  // за отказ. Вид определяется правилами по хосту, поэтому отказ здесь —
  // это отказ по тарифу, а не догадка.
  const planned = planFor(raw);
  if (!("refuse" in planned)) {
    const plan = effectivePlan(await currentReader());
    const denials = planned.candidates.map((candidate) => kindDenial(plan, candidate.kind));
    if (denials.every(Boolean)) return { ok: false, error: denials[0]! };
  }

  try {
    return await discover(raw);
  } catch (error) {
    return { ok: false, error: (error as Error).message.slice(0, 300) };
  }
}

const KNOWN_KINDS = new Set<Source["kind"]>(["rss", "hackernews", "reddit", "x", "telegram", "email"]);

/**
 * Сохраняется только то, что действительно ответило, и перепроверяется ровно
 * тот кандидат, который показала форма: если разбор гнать заново, сохранится
 * одно, а подтверждал читатель другое. Источник, сохранённый без единой
 * записи, через неделю неотличим от заброшенного — а он таким и родился.
 */
export async function addSource(formData: FormData) {
  await requireOwner();
  // Вид сужается один раз: дальше он уходит и в предел тарифа, и в пробу.
  const kind = String(formData.get("kind") ?? "").trim() as Source["kind"];
  const url = String(formData.get("url") ?? "").trim();
  const inputUrl = String(formData.get("input_url") ?? "").trim() || url;
  if (!KNOWN_KINDS.has(kind)) return { error: "Сначала проверь ссылку" };
  if (!url) return { error: "Вставь ссылку" };

  // Предел тарифа проверяется до сети: отказать бесплатно дешевле,
  // чем сходить за фидом и отказать после.
  const denied = await denyBySource(kind);
  if (denied) return denied;

  const probe = await probeOne(kind, url, inputUrl);
  if (!probe.ok) return { error: `Источник перестал отвечать: ${probe.error}` };

  const label = String(formData.get("label") ?? "").trim().slice(0, 200) || probe.found.label;

  await sql`
    insert into dailynews.sources (kind, label, url, input_url)
    values (${kind}, ${label}, ${url}, ${inputUrl})
    on conflict (kind, url) do update
      set active = true, label = excluded.label, input_url = excluded.input_url
  `;
  revalidatePath("/settings/sources");
  return { ok: true as const, label };
}


/**
 * Общая проверка для добавления и включения: одна и та же пара пределов,
 * и разойтись им нельзя — включение в обход добавления открывало бы X
 * на бесплатном тарифе одним переключателем.
 */
async function denyBySource(kind: Source["kind"]): Promise<{ error: string } | null> {
  const plan = effectivePlan(await currentReader());

  const byKind = kindDenial(plan, kind);
  if (byKind) return { error: byKind };

  // Считаем только то, что прогон и правда опрашивает: sourcesForPlan
  // отсекает запрещённый вид до предела по числу. Иначе после понижения
  // тарифа оставшиеся включёнными ленты X занимают места живых источников —
  // добавить разрешённый нельзя, пока не выключишь те, которые всё равно
  // никто не опрашивает.
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from dailynews.sources
     where active and kind = any(${plan.kinds})
  `;
  if (n >= plan.maxSources) {
    return {
      error:
        `На тарифе «${plan.label}» лента следит за ${plan.maxSources} источниками — ` +
        `убери один, чтобы добавить новый`,
    };
  }
  return null;
}

export async function deleteSource(id: number) {
  await requireOwner();
  await sql`delete from dailynews.sources where id = ${id}`;
  revalidatePath("/settings/sources");
}

/**
 * Догрузить сегодняшний выпуск до заданного размера.
 *
 * Смена числа новостей иначе ничего не меняет до полуночи: отбор уже прошёл,
 * и выпуск на двадцать материалов останется на двадцати, сколько ни ставь.
 * Это ровно тот отказ, что выглядит как успех — настройка принята, а лента
 * прежняя.
 *
 * Поток уже собран и оценён: Jev проходит по всему потоку, а не по выжившим,
 * поэтому догрузка не трогает ни сбор, ни скоринг. Работы здесь только
 * на письмо описаний — те же куски по двадцать, что и в ночном прогоне.
 * Поэтому же она занимает минуты, а не секунды.
 */
export async function topUpDigest() {
  const reader = await currentReader();
  // Только сколько уже набрано: сам выпуск перечитывается в транзакции ниже,
  // после письма описаний, — за это время последним может стать другой.
  const [existing] = await sql<{ taken: number }[]>`
    select (select count(*)::int from dailynews.digest_items di where di.digest_id = d.id) as taken
      from dailynews.digests d
     where d.reader_id = ${reader.id}
     order by d.day desc limit 1
  `;

  // Через догрузку предел тарифа обходится так же, как через ползунок:
  // digest_size мог остаться от прежнего тарифа, а платит за письмо
  // описаний владелец ключа. Потолок один и тот же, что и в прогоне.
  const target = digestCap(reader.digest_size, effectivePlan(reader));
  const missing = target - (existing?.taken ?? 0);
  if (missing <= 0) return { ok: true as const, added: 0 };

  // Тот же потолок, что и в ночном прогоне: кнопка «догрузить» тратит
  // те же деньги, и обходить его ей незачем.
  const spent = await spentToday(reader.id);
  if (spent >= reader.daily_cap_usd) {
    return { error: "Сегодня больше добавить нельзя — завтра лимит обнулится" };
  }

  // selectSurvivors сам исключает всё, что уже попало в выпуски этого
  // читателя, поэтому повторная догрузка не выдаст те же материалы второй раз.
  const topics = await getReaderTopics(reader.id);
  // Источники тарифа те же, что в ночном прогоне: кнопка не должна
  // приносить то, чего прогон не принёс бы.
  const mySources = sourcesForPlan(await getSources(), effectivePlan(reader)).map((s) => s.id);
  const survivors = await selectSurvivors(
    sql, reader.id, reader.weights, targetsOf(topics), missing, mySources,
  );
  if (survivors.length === 0) {
    // Первому выпуску и догрузке нужны разные слова: «больше нет» в ответ
    // на «собрать сейчас» звучит так, будто что-то уже приходило.
    return {
      ok: true as const,
      added: 0,
      note: existing
        ? "Больше свежих новостей нет"
        : "Свежих новостей пока нет — первые придут ночью",
    };
  }

  const needImage = await sql<{ id: number; url: string }[]>`
    select id, url from dailynews.items
     where id = any(${survivors.map((item) => item.id)}::bigint[]) and image_url is null
  `;
  await enrichImages(needImage, async (id, image) => {
    await sql`update dailynews.items set image_url = ${image} where id = ${id}`;
  });

  const written = await writeDigest(survivors, reader.reader_context, {
    language: reader.language,
    complexity: reader.complexity,
    style: reader.style,
  });
  await recordCall({
    readerId: reader.id, stage: "digest", model: written.model,
    tokensIn: written.usage.input, tokensOut: written.usage.output,
    costUsd: llmCost(written.usage),
  });

  // Вторая петля измерения не пропускается: иначе догруженные описания
  // не попадут в ряд по дням, и ряд начнёт врать о том, что читатель видел.
  const quality = await scoreSummaries(
    written.items.map((item) => ({
      id: Number(item.id), title: item.title_ru, summary: item.summary,
    })),
    reader.reader_context,
  );
  await recordCall({
    readerId: reader.id, stage: "summary", model: quality.model,
    tokensIn: quality.inputTokens, costUsd: jevCost(quality.inputTokens),
  });

  const writtenById = new Map(written.items.map((item) => [String(item.id), item]));
  const qualityById = new Map(quality.scored.map((row) => [String(row.item_id), row]));

  /*
    Строка выпуска заводится здесь, а не в начале: раньше она пережила бы
    любой отказ выше — исчерпанный дневной предел, пустой отбор, оборванный
    ответ модели, — и в базе остался бы пустой выпуск за сегодня. Лента
    перестала бы предлагать «Собрать сейчас» (день-то уже есть), а калибровка
    посчитала бы выпуск, которого читатель не получал. Ночной прогон делает
    так же: вставляет выпуск после письма описаний.

    `taken` перечитывается из базы, а не берётся из первого select: между
    ним и этим местом ночной прогон мог успеть собрать сегодняшний выпуск,
    и позиции пошли бы с единицы поверх уже занятых.
  */
  /*
    Догружается последний выпуск, а не сегодняшний по календарю, и это
    намеренно: догрузку зовут двумя кнопками, и обе смотрят на тот выпуск,
    который читатель видит на экране. Полоса интересов прямо считает
    «сейчас в выпуске N» по `days[0]`, и собери мы вместо этого новый день,
    обещание в вопросе разошлось бы с тем, что придёт. Новый день заводится
    только тогда, когда выпусков нет вовсе.
  */
  /*
    Всё письмо в базу — одной транзакцией. Врозь оно коммитится по шагу,
    и падение на любом из них (материал удалён между отбором и вставкой —
    и внешний ключ не пускает) оставляет заведённый выпуск и часть строк:
    лента и разбор попаданий посчитают его наравне с настоящим. Ровно тот
    недобор, от которого вынесена вставка выпуска вниз.

    Строка выпуска берётся `for update`: между счётом занятых мест
    и вставками может вклиниться ночной прогон, и тогда `position`
    у разных материалов совпадает (уникальности на нём нет), а сумма
    переваливает за потолок тарифа. Замок держится до конца транзакции.
  */
  const added = await sql.begin(async (tx) => {
    /*
      Последний выпуск перечитывается здесь, а не берётся из `existing`:
      тот прочитан до письма описаний, и за минуты письма ночной прогон
      успевает собрать новый день. Перечитанный — уже сегодняшний.

      `for update` при этом держит только саму строку, от чужой записи
      в неё. Вставку ночным прогоном нового дня он не задерживает: у новой
      строки другой ключ, и конфликтующего замка на ней нет. Остаётся окно
      в несколько минут: прогон коммитит новый выпуск ровно между этим
      select и вставками — тогда материалы лягут во вчерашний, а лента
      покажет сегодняшний, и найти их можно будет стрелкой по датам.
      Закрыть это по-настоящему можно только общим замком с прогоном,
      а он пишет выпуск вне транзакции; половинчатый замок здесь хуже
      названного вслух окна.
    */
    const [current] = await tx<{ id: number }[]>`
      select id::int as id from dailynews.digests
       where reader_id = ${reader.id}
       order by day desc limit 1
       for update
    `;
    let digestId = current?.id;
    if (digestId === undefined) {
      const day = new Date().toISOString().slice(0, 10);
      // `on conflict` — про гонку с ночным прогоном: он мог завести
      // сегодняшний выпуск между этим select и вставкой.
      const [row] = await tx<{ id: number }[]>`
        insert into dailynews.digests (reader_id, day, intro, stats)
        values (${reader.id}, ${day}, ${written.intro}, ${sql.json({ source: "manual" })})
        on conflict (reader_id, day) do update set day = excluded.day
        returning id::int as id
      `;
      digestId = row.id;
    }

    const [{ taken }] = await tx<{ taken: number }[]>`
      select count(*)::int as taken from dailynews.digest_items where digest_id = ${digestId}
    `;

    // Обрезаем по настоящему остатку: выпуск, набитый поверх чужой работы,
    // пробил бы потолок тарифа — и это были бы уже настоящие деньги.
    const fitting = survivors.slice(0, Math.max(0, target - taken));

    // Дописываем только то, чего в выпуске ещё нет: два одновременных нажатия
    // иначе положили бы один материал дважды.
    let rows = 0;
    for (const [index, survivor] of fitting.entries()) {
      const text = writtenById.get(String(survivor.id));
      const scored = qualityById.get(String(survivor.id));
      const inserted = await tx<{ id: number }[]>`
        insert into dailynews.digest_items
          (digest_id, item_id, total, position, title, summary, summary_axes, summary_score)
        values (
          ${digestId}, ${survivor.id}, ${survivor.total}, ${taken + index + 1},
          ${text?.title_ru ?? survivor.title}, ${text?.summary ?? ""},
          ${scored ? sql.json(scored.axes as unknown as Parameters<typeof sql.json>[0]) : null},
          ${scored?.total ?? null}
        )
        on conflict (digest_id, item_id) do nothing
        returning id::int as id
      `;
      rows += inserted.length;
    }
    return rows;
  });

  revalidatePath("/", "layout");
  // Считаем вставленное, а не отобранное: при двух наложившихся нажатиях
  // `do nothing` отбрасывает часть строк молча, и «Добавлено: 5» на трёх
  // добавленных — отказ, выглядящий как успех.
  return { ok: true as const, added };
}
