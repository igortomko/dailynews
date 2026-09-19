"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "./db";
import { checkPassword, issueSession, SESSION_COOKIE } from "./auth";
import { currentReader, currentReaderId } from "./session";
import { discover, planFor, type Found } from "../../pipeline/discover";
import { denyForKind, isKnownKind, probeOne, saveSource } from "./sources";
import { selectSurvivors, targetsOf } from "../../pipeline/select";
import { writeDigest } from "../../pipeline/digest";
import { scoreSummaries } from "../../pipeline/summary-quality";
import { enrichImages } from "../../pipeline/og";
import {
  addReaderSource, deleteChannel, freezeKindleSender, getChannels, getReader, getReaderTopics,
  readerSources, recordCall, saveChannel, saveVoiceCard, saveVoiceSample, spentToday,
} from "./readers";
import { postSourceFor, saveDrafts, takeDraft, type SavedDraft } from "./posts";
import { buildVoiceCard, cardFromVoice, readOwnPosts, type VoiceCard } from "../../pipeline/voice-card";
import { writePost } from "../../pipeline/post";
import { NETWORK_IDS, tabsOf, type NetworkId } from "./networks";
import { llmCost, jevCost } from "../../pipeline/cost";
import type { Reader, Source } from "./types";
import { MIN_PER_TOPIC, normalize } from "./topic-budget";
import {
  allows, cheapestWith, FEATURES, kindDenial, maxDigestOf, sourcesForPlan, topicsWord,
  type Gated,
} from "./plans";
import { effectivePlan } from "./lemon";
import { SOURCE_LANGUAGE } from "./voice";
import { toSlug } from "./slug";
import { starterBySlug } from "./starter-topics";
import { resolveSuggestions } from "./onboarding";

/**
 * Запасной вход владельца. Читатели входят ссылкой из бота; пароль остаётся
 * на случай, когда Telegram недоступен, и пускает ровно в ту строку, которая
 * была перенесена из profile.
 */
export async function login(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!(await checkPassword(password))) {
    return { error: "Не подходит" };
  }
  const [owner] = await sql<{ id: number }[]>`
    select id::int as id from dailynews.readers where owner
  `;
  if (!owner) return { error: "Владелец не заведён" };

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
  const asked_language = String(formData.get("language") ?? "").trim().slice(0, 60) || "русском";
  // Перевод — платная возможность, и проверяется она здесь, а не только
  // в форме: поле отправляется по своему адресу мимо погашенного селекта.
  const plan = effectivePlan(await currentReader());
  const language = FEATURES.language.has(plan) ? asked_language : SOURCE_LANGUAGE;
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
        `Тариф «${plan.label}» держит ${plan.maxTopics} ${topicsWord(plan.maxTopics)}, ` +
        `а выбрано ${chips.length}`,
    };
  }

  const slugs = chips.map((chip) => chip.slug || toSlug(chip.label));
  // Разные названия дают один slug: «ИИ-инфра» и «ИИ инфра» после
  // транслитерации совпадают, on conflict схлопывает их в одну строку,
  // и цель первой темы теряется. Сумма целей молча перестаёт равняться
  // размеру дайджеста — полоса показывает одно, приходит другое.
  if (new Set(slugs).size !== slugs.length) {
    return { error: "Два интереса совпадают после упрощения названия — переименуй один" };
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

  await writeTopics(readerId, chips, slugs, counts, digestSize, true);

  revalidatePath("/", "layout");
  return { ok: true as const };
}



/**
 * Запись интересов и бюджета внимания.
 *
 * Общая для настроек и для первого экрана: правила одни и те же, а разойдясь,
 * они разойдутся молча — онбординг начнёт заводить то, что форма настроек
 * отвергает, и увидеть это можно будет только по съехавшим темам.
 *
 * `finish` — ставить ли отметку о пройденном онбординге. На первом экране
 * нельзя: интересы выбраны, источников ещё нет, и лента, решив, что
 * настройка закончена, повела бы читателя в пустой выпуск.
 */
async function writeTopics(
  readerId: number,
  chips: ChipInput[],
  slugs: string[],
  counts: number[],
  digestSize: number,
  finish: boolean,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      update dailynews.readers
         set digest_size = ${digestSize},
             onboarded_at = ${finish ? sql`coalesce(onboarded_at, now())` : sql`onboarded_at`},
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
 * Разобрать вставленную ссылку: что это за источник, где у него фид и как он
 * называется. Ничего не сохраняет — показывает, что нашлось, чтобы читатель
 * подтвердил. Тип источника знать не нужно, название уже лежит в фиде.
 */
export async function discoverSource(input: string): Promise<
  { ok: true; found: Found } | { ok: false; error: string }
> {
  const raw = input.trim().slice(0, 500);
  if (!raw) return { ok: false, error: "Пустая строка" };

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


/**
 * Сохраняется только то, что действительно ответило, и перепроверяется ровно
 * тот кандидат, который показала форма: если разбор гнать заново, сохранится
 * одно, а подтверждал читатель другое. Источник, сохранённый без единой
 * записи, через неделю неотличим от заброшенного — а он таким и родился.
 */
export async function addSource(formData: FormData) {
  const reader = await currentReader();
  // Вид сужается один раз: дальше он уходит и в предел тарифа, и в пробу.
  const kind = String(formData.get("kind") ?? "").trim() as Source["kind"];
  const url = String(formData.get("url") ?? "").trim();
  const inputUrl = String(formData.get("input_url") ?? "").trim() || url;
  if (!isKnownKind(kind)) return { error: "Сначала разбери ссылку" };
  if (!url) return { error: "Пустой адрес" };

  // Предел тарифа проверяется до сети: отказать бесплатно дешевле,
  // чем сходить за фидом и отказать после.
  const denied = await denyForKind(reader, kind);
  if (denied) return { error: denied };

  const probe = await probeOne(kind, url, inputUrl);
  if (!probe.ok) return { error: `Источник больше не отвечает: ${probe.error}` };

  const label = String(formData.get("label") ?? "").trim().slice(0, 200) || probe.found.label;

  const { created } = await saveSource(reader.id, kind, url, inputUrl, label);
  revalidatePath("/settings/sources");
  return { ok: true as const, label, created };
}



/**
 * Убрать источник из своей ленты.
 *
 * Удаляется строка связки, а не сам источник. У настоящего delete
 * на items.source_id стоит on delete cascade: оно уносило бы собранные
 * материалы, их оценки, их чтения и записи в уже отправленных выпусках —
 * и не только свои. Отменить такое нечем: строку источника вернуть легко,
 * сто семьдесят шесть чтений уже нет.
 *
 * Каталог при этом не редеет, и это правильно: он общий, а источник,
 * которого не выбрал никто, прогон и так не опрашивает — он собирает
 * объединение личных наборов.
 */
export async function deleteSource(id: number) {
  const readerId = await currentReaderId();
  const [row] = await sql<{ label: string }[]>`
    delete from dailynews.reader_sources rs
     using dailynews.sources s
     where rs.source_id = s.id and rs.reader_id = ${readerId} and rs.source_id = ${id}
     returning s.label
  `;
  revalidatePath("/settings/sources");
  return row ? { ok: true as const, label: row.label } : { error: "Источник уже убран" };
}

/** Отмена: возвращает источник в ленту. Каталог его и не терял. */
export async function restoreSource(id: number) {
  await addReaderSource(await currentReaderId(), id);
  revalidatePath("/settings/sources");
  return { ok: true as const };
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
  const result = await fillDigest(await currentReader());
  revalidatePath("/", "layout");
  return result;
}

/**
 * Собственно сборка. Отдельно от topUpDigest, потому что последний шаг
 * онбординга зовёт её, не перерисовывая страницу: revalidatePath перерисовал
 * бы сам мастер, а тот, увидев пройденный онбординг, увёл бы читателя
 * на ленту — мимо экрана, ради которого всё и собиралось.
 */
async function fillDigest(reader: Reader) {
  const [existing] = await sql<{ id: number; day: string; taken: number }[]>`
    select d.id::int as id, d.day::text as day,
           (select count(*)::int from dailynews.digest_items di where di.digest_id = d.id) as taken
      from dailynews.digests d
     where d.reader_id = ${reader.id}
     order by d.day desc limit 1
  `;
  // Первого выпуска ещё нет — заводим сегодняшний. Раньше здесь стоял отказ
  // «дождись прогона», и новый читатель заканчивал настройку обещанием:
  // поток-то уже собран и оценён, ему нужен только отбор и описания.
  const digest = existing ?? (await sql<{ id: number; day: string; taken: number }[]>`
    insert into dailynews.digests (reader_id, day)
    values (${reader.id}, current_date)
    on conflict (reader_id, day) do update set reader_id = excluded.reader_id
    returning id::int as id, day::text as day, 0 as taken
  `)[0];

  // Через догрузку предел тарифа обходится так же, как через ползунок:
  // digest_size мог остаться от прежнего тарифа, а платит за письмо
  // описаний владелец ключа. Потолок один и тот же, что и в прогоне.
  const target = Math.min(reader.digest_size, maxDigestOf(effectivePlan(reader)));
  const missing = target - digest.taken;
  if (missing <= 0) return { ok: true as const, added: 0 };

  // Тот же потолок, что и в ночном прогоне: кнопка «догрузить» тратит
  // те же деньги, и обходить его ей незачем.
  const spent = await spentToday(reader.id);
  if (spent >= reader.daily_cap_usd) {
    return { error: `Дневной потолок $${reader.daily_cap_usd} исчерпан — завтра` };
  }

  // selectSurvivors сам исключает всё, что уже попало в выпуски этого
  // читателя, поэтому повторная догрузка не выдаст те же материалы второй раз.
  const topics = await getReaderTopics(reader.id);
  // Источники тарифа те же, что в ночном прогоне: кнопка не должна
  // приносить то, чего прогон не принёс бы.
  const mySources = sourcesForPlan(await readerSources(reader.id), effectivePlan(reader)).map((s) => s.id);
  const survivors = await selectSurvivors(
    sql, reader.id, reader.weights, targetsOf(topics), missing, mySources,
  );
  if (survivors.length === 0) {
    return { ok: true as const, added: 0, note: "Свежих материалов больше нет" };
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

  // Дописываем только то, чего в выпуске ещё нет: два одновременных нажатия
  // иначе положили бы один материал дважды.
  for (const [index, survivor] of survivors.entries()) {
    const text = writtenById.get(String(survivor.id));
    const scored = qualityById.get(String(survivor.id));
    await sql`
      insert into dailynews.digest_items
        (digest_id, item_id, total, position, title, summary, summary_axes, summary_score)
      values (
        ${digest.id}, ${survivor.id}, ${survivor.total}, ${digest.taken + index + 1},
        ${text?.title_ru ?? survivor.title}, ${text?.summary ?? ""},
        ${scored ? sql.json(scored.axes as unknown as Parameters<typeof sql.json>[0]) : null},
        ${scored?.total ?? null}
      )
      on conflict (digest_id, item_id) do nothing
    `;
  }

  return { ok: true as const, added: survivors.length };
}

// ---------------------------------------------------------------------------
// Блогерский Pro: площадки, голос, посты.
//
// Предел проверяется в каждом действии, а не только на странице: действие
// зовётся по своему адресу мимо страницы с заглушкой, и без этой проверки
// бесплатный читатель получал бы посты за наш счёт через fetch из консоли.
// ---------------------------------------------------------------------------

/** Что вставил читатель → какая это сеть. Разбор тот же, что у источников. */
const NETWORK_BY_KIND: Partial<Record<Source["kind"], NetworkId>> = {
  telegram: "telegram",
  x: "x",
  rss: "blog",
};

/**
 * Добавить площадку ссылкой.
 *
 * Адрес разбирает тот же `discover`, что и источники: он же проверяет, что
 * канал публичный и хоть что-то отдаёт. Сохраняется только ответившее —
 * площадка, принятая пустой, выглядит настроенной, а голос по ней собрать
 * не из чего, и понять это можно будет только по пустой карточке.
 */
export async function addChannel(input: string): Promise<{ ok: true; network: NetworkId; label: string } | { error: string }> {
  const denied = await denyBySection("posts");
  if (denied) return denied;
  const readerId = await currentReaderId();

  const found = await discover(input);
  if (!found.ok) return { error: found.error };

  const network = NETWORK_BY_KIND[found.found.kind];
  if (!network) {
    return { error: "Это похоже на рассылку, а не на твой канал: нужен канал Telegram, аккаунт X или блог" };
  }

  await saveChannel(readerId, network, {
    handle: found.found.url,
    input_url: found.found.input_url,
    label: found.found.label,
  });
  revalidatePath("/settings/channels");
  return { ok: true as const, network, label: found.found.label };
}

/** Отметить сеть, куда он публикует. Адрес при этом не трогается. */
export async function toggleChannel(network: string, on: boolean) {
  const denied = await denyBySection("posts");
  if (denied) return denied;
  const readerId = await currentReaderId();
  if (!NETWORK_IDS.includes(network as NetworkId)) return { error: "Неизвестная сеть" };

  if (on) await saveChannel(readerId, network);
  else await deleteChannel(readerId, network);
  revalidatePath("/settings/channels");
  return { ok: true as const };
}

/**
 * Вставленные руками посты.
 *
 * Не обходной путь, а единственный для LinkedIn и Threads: ленту они наружу
 * не отдают вовсе. Поэтому поле живёт рядом со списком площадок, а не
 * в «если ничего не получилось».
 */
export async function saveSample(formData: FormData) {
  const denied = await denyBySection("posts");
  if (denied) return denied;
  const readerId = await currentReaderId();
  await saveVoiceSample(readerId, String(formData.get("sample") ?? "").slice(0, 20_000));
  revalidatePath("/settings/channels");
  return { ok: true as const };
}

/**
 * Собрать карточку автора заново.
 *
 * Руками, а не по расписанию: голос меняется годами, и ночной пересчёт
 * платил бы за один и тот же ответ каждую ночь. Кнопка стоит рядом с числом
 * прочитанных постов — видно, на чём карточка собрана.
 */
export async function rebuildVoice(): Promise<{ ok: true; built_from: number; ranked: boolean; failed: string[] } | { error: string }> {
  const denied = await denyBySection("posts");
  if (denied) return denied;
  const reader = await currentReader();

  const spent = await spentToday(reader.id);
  if (spent >= reader.daily_cap_usd) {
    return { error: `Дневной потолок $${reader.daily_cap_usd} исчерпан — завтра` };
  }

  const channels = await getChannels(reader.id);
  const { posts, failed } = await readOwnPosts(
    channels.map((channel) => ({ network: channel.network as NetworkId, handle: channel.handle })),
    reader.voice_sample,
  );
  if (posts.length === 0) {
    return {
      error: failed.length
        ? `Ни одна площадка не ответила: ${failed.map((entry) => `${entry.network} — ${entry.why}`).join("; ")}`
        : "Читать нечего: добавь канал ссылкой или вставь три своих поста",
    };
  }

  try {
    const built = await buildVoiceCard(posts);
    await saveVoiceCard(reader.id, built.card);
    await recordCall({
      readerId: reader.id, stage: "voice", model: built.model,
      tokensIn: built.usage.input, tokensOut: built.usage.output,
      costUsd: llmCost(built.usage),
    });
    revalidatePath("/settings/channels");
    return {
      ok: true as const,
      built_from: built.card.built_from,
      ranked: built.card.ranked,
      failed: failed.map((entry) => `${entry.network}: ${entry.why}`),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не собралось" };
  }
}

/**
 * Черновики поста по материалу выпуска.
 *
 * Материал берётся из выпуска этого читателя, а не из общей `items`:
 * запрос без `reader_id` отдал бы соседний выпуск — вовремя и без ошибок.
 * Заодно это и есть проверка, что материал ему вообще показывали.
 */
export async function writeOpinion(itemId: number): Promise<
  | { ok: true; drafts: SavedDraft[]; added: string[]; fallback: boolean; built_from: number }
  | { error: string }
> {
  const denied = await denyBySection("posts");
  if (denied) return denied;
  const reader = await currentReader();

  const spent = await spentToday(reader.id);
  if (spent >= reader.daily_cap_usd) {
    return { error: `Дневной потолок $${reader.daily_cap_usd} исчерпан — завтра` };
  }

  const item = await postSourceFor(reader.id, itemId);
  if (!item) return { error: "Этого материала в твоих выпусках нет" };

  const channels = await getChannels(reader.id);
  const networks = tabsOf(channels.map((channel) => channel.network));
  if (networks.length === 0) {
    return { error: "Сначала отметь в настройках, где ты публикуешь" };
  }

  // Карточка есть — пишем его голосом. Нет — настройками подачи, и мотатка
  // обязана сказать это вслух: иначе он прочтёт общий черновик и решит,
  // что возможность не работает.
  const card = reader.voice_card?.voice?.length
    ? (reader.voice_card as VoiceCard)
    : cardFromVoice({
        language: reader.language,
        complexity: reader.complexity,
        style: reader.style,
      });

  try {
    const written = await writePost(item, card, networks.map((network) => network.id));
    await recordCall({
      readerId: reader.id, stage: "post", model: written.model,
      tokensIn: written.usage.input, tokensOut: written.usage.output,
      costUsd: llmCost(written.usage),
    });
    const saved = await saveDrafts(reader.id, item.id, written.drafts);
    return {
      ok: true as const,
      drafts: saved,
      added: written.added,
      fallback: card.built_from === 0,
      built_from: card.built_from,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не написалось" };
  }
}

/** Он скопировал пост: отметка и его правка — вход для следующей карточки. */
export async function takeOpinion(postId: number, text: string) {
  const readerId = await currentReaderId();
  const ok = await takeDraft(readerId, postId, text.slice(0, 10_000));
  return ok ? { ok: true as const } : { error: "Черновик не найден" };
}

/**
 * Первый экран: выбранные интересы.
 *
 * Слаги из готового набора и то, что читатель вписал руками, приходят
 * отдельно — у первых уже есть подсказка для Jev, выверенная под общий
 * справочник, и брать её из формы значило бы позволить переписать критерий
 * классификации всем сразу.
 *
 * Размер выпуска здесь не спрашивается: на первом экране это третье решение
 * подряд, а тариф и так знает свой. Поменять его можно в «Интересах».
 */
export async function saveOnboardingInterests(slugs: string[], custom: string[]) {
  const reader = await currentReader();
  const plan = effectivePlan(reader);

  const picked = slugs
    .map((slug) => starterBySlug.get(slug))
    .filter((topic) => topic !== undefined)
    .map((topic) => ({ slug: topic.slug, label: topic.label, hint: topic.hint, count: MIN_PER_TOPIC }));

  // Вписанное руками: подсказки у него нет, и это нормально — Jev получит
  // само название. Пустая тема в справочник не уезжает.
  const mine = custom
    .map((label) => label.trim().slice(0, 60))
    .filter(Boolean)
    .map((label) => ({ slug: toSlug(label), label, hint: "", count: MIN_PER_TOPIC }));

  const chips = [...picked, ...mine].filter(
    (chip, index, all) => chip.slug && all.findIndex((other) => other.slug === chip.slug) === index,
  );

  if (chips.length === 0) return { error: "Выбери хотя бы один интерес" };
  if (chips.length > plan.maxTopics) {
    return {
      error:
        `Тариф «${plan.label}» держит ${plan.maxTopics} ${topicsWord(plan.maxTopics)}, ` +
        `а выбрано ${chips.length}`,
    };
  }

  const digestSize = plan.digestSizes[0];
  await writeTopics(
    reader.id,
    chips,
    chips.map((chip) => chip.slug),
    normalize(chips.map(() => MIN_PER_TOPIC), digestSize),
    digestSize,
    false,
  );
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Первый экран: выбранные источники.
 *
 * Форма присылает ключи, а не адреса. Подобранный список пересобирается
 * на сервере из тех же интересов, и всё, чего в нём нет, отбрасывается:
 * иначе в общий каталог можно было бы вставить что угодно под нашим
 * названием, и следующий читатель увидел бы это среди предложений.
 *
 * Пробы здесь нет намеренно: эти фиды проверены живым запросом, когда
 * попадали в набор, а пять проб подряд — это пять секунд ожидания на шаге,
 * где читатель всего лишь нажимает на названия. Вставленная руками ссылка
 * проверяется по-прежнему (addSource).
 */
export async function saveOnboardingSources(keys: string[]) {
  const reader = await currentReader();
  const plan = effectivePlan(reader);
  const topics = await getReaderTopics(reader.id);

  const chosen = await resolveSuggestions(
    reader.id,
    topics.map((topic) => topic.slug),
    plan,
    keys.slice(0, 100),
  );
  if (chosen.length === 0) return { error: "Выбери хотя бы один источник" };

  let added = 0;
  for (const feed of chosen) {
    // Предел тарифа спрашивается на каждом, а не один раз на список:
    // считать «сколько было плюс сколько выбрано» значит повторить
    // формулу предела второй раз и разойтись с ней на первом же отказе.
    const denied = await denyForKind(reader, feed.kind);
    if (denied) {
      // Причину берём у того, кто отказал. Своя формулировка здесь врала бы
      // про предел числа там, где отказ был по виду источника, — и читатель
      // убирал бы лишнее, не понимая, почему это не помогает.
      if (added === 0) return { error: denied };
      break;
    }
    await saveSource(reader.id, feed.kind, feed.url, feed.url, feed.label);
    added++;
  }

  revalidatePath("/", "layout");
  return { ok: true as const, added };
}

/**
 * Последний шаг: собрать первый выпуск и открыть ленту.
 *
 * Поток уже собран и оценён — он общий, — поэтому новому читателю нужен
 * только отбор его весами и описания его языком. Без этого шага онбординг
 * заканчивался бы обещанием: настроил, нажал «готово» и увидел пустую
 * ленту до следующей ночи.
 *
 * Отметка о пройденном онбординге ставится до сборки, а не после: выпуска
 * может не получиться (поток пуст, потолок исчерпан), и ронять читателя
 * обратно на первый экран из-за этого нельзя — настройку он закончил.
 */
export async function finishOnboarding() {
  const readerId = await currentReaderId();
  await sql`
    update dailynews.readers
       set onboarded_at = coalesce(onboarded_at, now()), updated_at = now()
     where id = ${readerId}
  `;
  // Перерисовки здесь нет намеренно: мастер должен дорисовать свой
  // последний экран, а не быть уведённым с него собственным успехом.
  try {
    return await fillDigest(await currentReader());
  } catch (error) {
    // Отказ обязан вернуться значением, а не броском: мастер ждёт ответа,
    // и на упавшем обещании он остался бы крутить спиннер до закрытия
    // вкладки. Настройка при этом уже сохранена — терять её не за что.
    console.error(`первый выпуск: ${(error as Error).message}`);
    return { error: "Не получилось собрать первый выпуск — соберу ночью" };
  }
}
