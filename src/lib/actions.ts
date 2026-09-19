"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "./db";
import { checkPassword, issueSession, SESSION_COOKIE } from "./auth";
import { currentReader, currentReaderId } from "./session";
import { checkFeed } from "../../pipeline/check-sources";
import { selectSurvivors, targetsOf } from "../../pipeline/select";
import { writeDigest } from "../../pipeline/digest";
import { scoreSummaries } from "../../pipeline/summary-quality";
import { enrichImages } from "../../pipeline/og";
import { freezeKindleSender, getReaderTopics, recordCall, spentToday } from "./readers";
import { llmCost, jevCost } from "../../pipeline/cost";
import type { Reader, Source } from "./types";
import { MIN_PER_TOPIC, normalize } from "./topic-budget";
import { allows, cheapestWith, maxDigestOf, planOf, sourcesForPlan, PLAN_IDS, PLANS, type Gated } from "./plans";
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
  const plan = planOf((await currentReader()).plan);
  if (allows(plan, section)) return null;
  return { error: `Раздел доступен на тарифе «${cheapestWith(section).label}»` };
}

export async function savePersonalization(formData: FormData) {
  const readerId = await currentReaderId();
  const denied = await denyBySection("personalization");
  if (denied) return denied;

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
  const plan = planOf((await currentReader()).plan);
  if (chips.length > plan.maxTopics) {
    return {
      error: `Тариф «${plan.label}» держит ${plan.maxTopics} ${
        plan.maxTopics === 1 ? "интерес" : plan.maxTopics < 5 ? "интереса" : "интересов"
      }, а выбрано ${chips.length}`,
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

export async function saveLlm(formData: FormData) {
  const readerId = await currentReaderId();
  const denied = await denyBySection("subscription");
  if (denied) return denied;

  const provider = String(formData.get("base_url") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const apiKey = String(formData.get("api_key") ?? "").trim();

  if (provider && !/^https:\/\//.test(provider)) {
    return { error: "Адрес должен начинаться с https://" };
  }

  // Пустой ключ означает «не менять»: иначе форма стирала бы сохранённый
  // ключ каждый раз, когда её открывают посмотреть остальные поля.
  await sql`
    update dailynews.readers
       set llm = jsonb_strip_nulls(
             llm
             || jsonb_build_object('base_url', nullif(${provider}, ''))
             || jsonb_build_object('model', nullif(${model}, ''))
             || case when ${apiKey} = '' then '{}'::jsonb
                     else jsonb_build_object('api_key', ${apiKey}) end
           ),
           updated_at = now()
     where id = ${readerId}
  `;
  revalidatePath("/settings/subscription");
  return { ok: true as const };
}

export async function clearLlmKey() {
  const readerId = await currentReaderId();
  const denied = await denyBySection("subscription");
  if (denied) return denied;

  await sql`update dailynews.readers set llm = llm - 'api_key' where id = ${readerId}`;
  revalidatePath("/settings/subscription");
}

/**
 * Адрес Kindle. Обратный адрес не трогаем: он выдан один раз при заведении
 * и заморожен — каждая его смена означает, что читатель заново проходит
 * одобрение отправителя в настройках Amazon, а до тех пор выпуски молча
 * не доходят.
 */
export async function saveKindle(formData: FormData) {
  const readerId = await currentReaderId();
  const address = String(formData.get("kindle_address") ?? "").trim().toLowerCase().slice(0, 120);
  if (address && !/^[^@\s]+@kindle\.com$/.test(address)) {
    return { error: "Адрес должен заканчиваться на @kindle.com" };
  }

  await sql`
    update dailynews.readers
       set kindle_address = ${address || null}, updated_at = now()
     where id = ${readerId}
  `;

  // Обратный адрес выдаётся здесь же, если его ещё нет: иначе читатель,
  // вписавший адрес читалки до первого /start, остался бы без отправителя,
  // и выпуск не уходил бы — при сохранённом адресе и без единой ошибки.
  if (address) {
    const reader = await currentReader();
    if (!reader.kindle_sender) await freezeKindleSender(reader.id, reader.username);
  }

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

export async function addSource(formData: FormData) {
  await requireOwner();
  const kind = String(formData.get("kind") ?? "rss") as "rss" | "reddit" | "hackernews" | "x";
  const url = String(formData.get("url") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || url;
  if (!url) return { error: "Пустой адрес" };

  const denied = await denyBySource(kind);
  if (denied) return denied;

  // Источник проверяется живым запросом до сохранения: каталог из
  // непроверенных адресов превращается в пустую вкладку через неделю.
  if (kind === "rss") {
    const probe = await checkFeed(url);
    if (!probe.ok) return { error: `Фид не отвечает: ${probe.error ?? "пусто"}` };
  }

  await sql`
    insert into dailynews.sources (kind, label, url)
    values (${kind}, ${label}, ${url})
    on conflict (kind, url) do update set active = true, label = excluded.label
  `;
  revalidatePath("/settings/sources");
  return { ok: true as const };
}

export async function setSourceActive(id: number, active: boolean) {
  await requireOwner();
  if (active) {
    const [source] = await sql<{ kind: Source["kind"] }[]>`
      select kind from dailynews.sources where id = ${id}
    `;
    const denied = source ? await denyBySource(source.kind) : null;
    if (denied) return denied;
  }
  await sql`update dailynews.sources set active = ${active} where id = ${id}`;
  revalidatePath("/settings/sources");
  return { ok: true as const };
}

/**
 * Общая проверка для добавления и включения: одна и та же пара пределов,
 * и разойтись им нельзя — включение в обход добавления открывало бы X
 * на бесплатном тарифе одним переключателем.
 */
async function denyBySource(kind: Source["kind"]): Promise<{ error: string } | null> {
  const plan = planOf((await currentReader()).plan);

  if (!plan.kinds.includes(kind)) {
    const where = PLAN_IDS.filter((id) => PLANS[id].kinds.includes(kind)).map((id) => PLANS[id].label);
    return {
      error: where.length
        ? `Источники ${kind} есть только на тарифе «${where.join("», «")}»`
        : `Источники ${kind} недоступны`,
    };
  }

  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from dailynews.sources where active
  `;
  if (n >= plan.maxSources) {
    return { error: `Тариф «${plan.label}» опрашивает ${plan.maxSources} источников — выключи лишний` };
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
  const [digest] = await sql<{ id: number; day: string; taken: number }[]>`
    select d.id::int as id, d.day::text as day,
           (select count(*)::int from dailynews.digest_items di where di.digest_id = d.id) as taken
      from dailynews.digests d
     where d.reader_id = ${reader.id}
     order by d.day desc limit 1
  `;
  if (!digest) return { error: "Ни одного выпуска ещё нет — дождись прогона" };

  // Через догрузку предел тарифа обходится так же, как через ползунок:
  // digest_size мог остаться от прежнего тарифа, а платит за письмо
  // описаний владелец ключа. Потолок один и тот же, что и в прогоне.
  const target = Math.min(reader.digest_size, maxDigestOf(planOf(reader.plan)));
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
  const mySources = sourcesForPlan(await getSources(), planOf(reader.plan)).map((s) => s.id);
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

  const written = await writeDigest(survivors, reader.reader_context, reader.llm ?? {}, {
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

  revalidatePath("/", "layout");
  return { ok: true as const, added: survivors.length };
}
