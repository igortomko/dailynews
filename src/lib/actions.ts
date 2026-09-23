"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "./db";
import { appOrigin, checkPassword, issueEmailToken, issueSession, SESSION_COOKIE } from "./auth";
import { loginEmail, looksLikeEmail, normalizeEmail, sendEmail } from "./email";
import { currentReader, currentReaderId } from "./session";
import { dictOf, localeOf, type Dict } from "./i18n";
import { getDict } from "./i18n/server";
import { discover, planFor, type Found } from "../../pipeline/discover";
import { denyForKind, isKnownKind, probeOne, saveSource } from "./sources";
import { selectSurvivors, targetsOf } from "../../pipeline/select";
import { writeDigest, type Survivor } from "../../pipeline/digest";
import { scoreSummaries } from "../../pipeline/summary-quality";
import { enrichImages } from "../../pipeline/og";
import {
  addReaderSource, deleteReader, digestProgress, freezeKindleSender, getChannels,
  getReader, getReaderTopics, perCardOf, readerSources, recordCall, saveChannel, saveRules, setChannelLanguage, setChannelPublishes,
  saveVoiceCard, saveVoiceStyle, spentToday, upsertTopic,
} from "./readers";
import { cleanRules, rulesOf, type Rules } from "./rules";
import { postSourceFor, recentTakes, saveDrafts, takeDraft, type SavedDraft } from "./posts";
import { buildVoiceCard, cardText, cleanStyle, draftStyle, readOwnPosts } from "../../pipeline/voice-card";
import { hasStyle, LANGUAGES, SOURCE_LANGUAGE, STYLE_LIMIT } from "./voice";
import { takesBlock, writePost } from "../../pipeline/post";
import { languagesOf, NETWORK_IDS, publishedIn, tabsOf, type NetworkId } from "./networks";
import { llmCost, jevCost } from "../../pipeline/cost";
import { KINDLE_PERIODS, type KindlePeriod, type Reader, type Source } from "./types";
import { MIN_PER_TOPIC, normalize } from "./topic-budget";
import {
  allows, cheapestFor, cheapestWith, FEATURES, kindDenial, MIN_READING_MINUTES, minutesCap,
  READING_MINUTES, sourcesForPlan, targetMinutes, type FeatureId, type Gated,
} from "./plans";
import { cardChars, itemsForMinutes, minutesOf } from "./reading-time";
import { effectivePlan, effectiveVoice } from "./lemon";
import { SEARCH_CONFIG, tsConfigFor } from "./search";
import { toSlug } from "./slug";
import { isTimezone } from "./issue-time";
import { clampTopicText, formChipOf, starterBySlug, TOPIC_LIMITS } from "./starter-topics";
import { addByLink } from "./sources";
import { resolveSuggestions } from "./onboarding";

/**
 * Запасной вход владельца. Читатели входят ссылкой из бота; пароль остаётся
 * на случай, когда Telegram недоступен, и пускает ровно в ту строку, которая
 * была перенесена из profile.
 */
export async function login(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  // Словарь по умолчанию: на этом экране читатель ещё не опознан,
  // и спросить, на каком языке с ним говорить, некого.
  const t = dictOf(undefined);
  if (!(await checkPassword(password))) {
    return { error: t.errors.wrongPassword };
  }
  const [owner] = await sql<{ id: number }[]>`
    select id::int as id from dailynews.readers where owner
  `;
  if (!owner) return { error: t.errors.noSuchEntrance };

  const session = await issueSession(owner.id);
  (await cookies()).set(session.name, session.value, session.options);
  redirect(String(formData.get("next") || "/"));
}

/**
 * Ссылка входа на почту. Строка читателя здесь не заводится — только
 * после клика (`/auth/email`), иначе форма заводила бы читателя на любой
 * набранный чужой адрес.
 *
 * Ответ одинаковый для нового и знакомого адреса: заводиться может любой,
 * и прятать тут нечего, а вторая формулировка была бы лишним состоянием.
 */
// ponytail: память одного процесса — веб здесь один контейнер. Появится
// второй — отметка переезжает в базу.
const lastLinkAt = new Map<string, number>();
const LINK_COOLDOWN_MS = 60_000;

export async function requestEmailLink(
  _prev: unknown,
  formData: FormData,
): Promise<{ sent?: string; error?: string } | null> {
  const t = dictOf(undefined).onboarding.login;
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!looksLikeEmail(email)) return { error: t.emailInvalid };

  // Одна минута на адрес: форма открыта всему интернету, и без паузы
  // её можно превратить в рассылку писем на чужой ящик от нашего имени.
  const now = Date.now();
  if (now - (lastLinkAt.get(email) ?? 0) < LINK_COOLDOWN_MS) return { sent: email };
  lastLinkAt.set(email, now);
  for (const [key, at] of lastLinkAt) if (now - at > LINK_COOLDOWN_MS) lastLinkAt.delete(key);

  const h = await headers();
  const origin = appOrigin(`${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`);
  const link = `${origin.replace(/\/$/, "")}/auth/email?token=${encodeURIComponent(await issueEmailToken(email))}`;
  try {
    await sendEmail({ to: email, ...loginEmail(link, t.mail) });
  } catch (error) {
    lastLinkAt.delete(email);
    console.error(`email login: ${(error as Error).message}`);
    return { error: t.emailFailed };
  }
  return { sent: email };
}

/**
 * Подписка, которая ещё будет списывать деньги. Удалить профиль под ней —
 * значит потерять к ней ссылку на кабинет, а списания продолжатся.
 */
const renews = (reader: { subscription_id: string | null; subscription_status: string | null }) =>
  Boolean(reader.subscription_id) && !["cancelled", "expired"].includes(reader.subscription_status ?? "");

/** Причина, по которой профиль сейчас не удалить, или null. */
export async function deleteBlocker(): Promise<"owner" | "subscription" | null> {
  const reader = await currentReader();
  if (reader.owner) return "owner";
  return renews(reader) ? "subscription" : null;
}

/**
 * Удалить профиль целиком. Те же проверки, что рисуют кнопку, стоят
 * и здесь: действие зовётся по своему адресу мимо страницы.
 */
export async function deleteProfile(): Promise<{ error: string }> {
  const reader = await currentReader();
  const t = (await getDict()).plans.about;
  const blocker = await deleteBlocker();
  if (blocker === "owner") return { error: t.deleteBlockedOwner };
  if (blocker === "subscription") return { error: t.deleteBlockedSubscription };

  await deleteReader(reader.id);
  console.log(`профиль ${reader.id} удалён по просьбе читателя`);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

/**
 * `count` — цель по числу новостей в день; в базе это `reader_topics.weight`.
 * `own` — только для формы: можно ли править название и подсказку. Сервер
 * ей не верит и решает сам (`upsertTopic`).
 */
export type ChipInput = { slug: string; label: string; hint: string; count: number; own?: boolean };

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
  const t = await getDict();
  return { error: t.errors.sectionLocked(cheapestWith(section).label) };
}

/**
 * Закрыта ли возможность тарифом.
 *
 * Отдельно от `denyBySection`, потому что раздел и возможность — разные
 * пределы: «Доставка» открыта с Plus, а озвучка только на Pro, и тумблер
 * подкаста живёт в разделе, который читателю виден. Проверка — та же
 * `FEATURES[id].has`, по которой рисуется корона: правило одно, иначе
 * корона над работающим тумблером и работающий тумблер без короны
 * одинаково незаметны на глаз и одинаково врут.
 */
async function denyByFeature(id: FeatureId): Promise<{ error: string } | null> {
  const plan = effectivePlan(await currentReader());
  if (FEATURES[id].has(plan)) return null;
  const t = await getDict();
  return { error: t.errors.sectionLocked(cheapestFor(id).label) };
}

/**
 * Язык интерфейса. Отдельным действием, а не полем формы настроек:
 * переключатель стоит в шапке и работает на любой странице, в том числе
 * там, где формы нет вовсе.
 *
 * Значение прижимается к известным: колонка свободная, а в базе стоит check,
 * и незнакомая строка уронила бы запись вместо того, чтобы ничего не менять.
 */
export async function setUiLanguage(value: string) {
  const readerId = await currentReaderId();
  const locale = localeOf(value);
  await sql`
    update dailynews.readers
       set ui_language = ${locale}, updated_at = now()
     where id = ${readerId}
  `;
  // Раскладка перерисовывается целиком: язык читают и шапка, и разделы,
  // и страница — обновить что-то одно значило бы оставить половину экрана
  // на прежнем языке.
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function savePersonalization(formData: FormData) {
  const readerId = await currentReaderId();

  // Язык — свободный текст: список из трёх выбирал автор формы, а не читатель.
  // Выбор читателя хранится как есть. Перевод — платная возможность, но
  // гасится он при письме выпуска (effectiveVoice), а не записью в колонку:
  // подмена здесь необратима — тариф потом откроется, а в колонке останется
  // «язык источника», и выпуск придёт непереведённым при русском в настройках.
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

/** Ответ формы интересов: отказ словами или то, что легло в базу. */
export type SavedInterests = {
  ok: true;
  minutes: number;
  chips: ReturnType<typeof formChipOf>[];
};

/**
 * Интересы и бюджет внимания — одна форма: сколько новостей в день и как они
 * делятся между темами, задаётся одним движением. Поэтому размер дайджеста
 * сохраняется здесь, и только здесь: у поля должен быть один владелец, иначе
 * вторая форма, где этого поля нет, молча вернёт его к минимуму.
 */
export async function saveInterests(
  formData: FormData,
): Promise<{ error: string } | SavedInterests> {
  const readerId = await currentReaderId();
  // Не разобралось или разобралось не списком объектов — отказ словами,
  // как у правил: иначе `[null]` или `{}` роняли бы действие исключением.
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("chips") ?? "[]"));
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw) || raw.some((chip) => typeof chip !== "object" || chip === null)) {
    return { error: (await getDict()).errors.badRequest };
  }
  const chips = (raw as ChipInput[]).map((chip) => ({
    ...chip,
    // Имя и подсказка уходят в общий справочник и в промпт всем читателям:
    // режется тем же пределом, что и поле, — форму рисует браузер.
    label: clampTopicText(chip.label, TOPIC_LIMITS.label),
    hint: clampTopicText(chip.hint, TOPIC_LIMITS.hint),
  }));
  if (chips.length === 0) return { error: (await getDict()).errors.pickOneTopic };
  // Имя уходит в общий справочник и в вопрос Jev как вариант ответа:
  // пустое там бесполезно всем. Поле добавления пустое отвергает, а имя
  // прямо в чипе можно стереть — отказ здесь, до записи.
  if (chips.some((chip) => chip.label === "")) {
    return { error: (await getDict()).errors.emptyTopicName };
  }

  // Предел проверяется на сервере, а не только в форме: форму рисует
  // браузер, а платит за лишние темы владелец ключа.
  const reader = await currentReader();
  const plan = effectivePlan(reader);
  if (chips.length > plan.maxTopics) {
    return {
      error: (await getDict()).errors.tooManyTopics(plan.label, plan.maxTopics, chips.length),
    };
  }

  const slugs = chips.map((chip) => chip.slug || toSlug(chip.label));
  // Разные названия дают один slug: «ИИ-инфра» и «ИИ инфра» после
  // транслитерации совпадают, on conflict схлопывает их в одну строку,
  // и цель первой темы теряется. Сумма целей молча перестаёт равняться
  // размеру дайджеста — полоса показывает одно, приходит другое.
  if (new Set(slugs).size !== slugs.length) {
    return { error: (await getDict()).errors.duplicateTopic };
  }
  // Предел минут — тоже серверная проверка, а не только корона в форме:
  // форму рисует браузер, а платит за лишние описания владелец ключа.
  const minutes = minutesCap(
    Math.max(
      MIN_READING_MINUTES,
      Math.round(Number(formData.get("digest_minutes"))) || READING_MINUTES[0],
    ),
    plan,
  );
  // Цели тем считаются в материалах, а заказ — в минутах. Перевод один
  // и тот же, что в прогоне: мерка берётся из уже написанных описаний
  // этого читателя, и полоса делит ровно то число мест, которое придёт.
  const places = itemsForMinutes(minutes, await perCardOf(reader), plan.maxItems);
  // Приводим ещё раз на сервере: из формы приходит то, что нарисовал
  // браузер, а сумма целей — это и есть деление выпуска между темами.
  const counts = normalize(
    chips.map((chip) => Math.max(MIN_PER_TOPIC, Math.round(Number(chip.count)) || MIN_PER_TOPIC)),
    places,
  );

  // За чем следить и что исключать живут в той же форме: это одно решение
  // об отборе, и сохраняется оно одной кнопкой. Пределы проверяет сервер —
  // форму рисует браузер.
  const rules = readRules(formData, (await getDict()).rules);
  if ("error" in rules) return { error: rules.error };

  await writeTopics(readerId, chips, slugs, counts, minutes, true, rules);

  revalidatePath("/", "layout");
  // Форме возвращается то, что записано на самом деле, а не то, что она
  // прислала: каталожная тема и тема, взятая соседом, остаются прежними,
  // и без пересева форма показывала бы «сохранённое», которого нет.
  return {
    ok: true as const,
    minutes,
    chips: (await getReaderTopics(readerId)).map(formChipOf),
  };
}

/**
 * Личные правила из формы. Поля обязаны присутствовать: их рисует та же
 * форма, что и темы, и пустой список означает «правил нет», а не «поле
 * забыли» — иначе форма, где поля нет, молча стирала бы список.
 */
function readRules(formData: FormData, words: Dict["rules"]): Rules | { error: string } {
  const parse = (field: string): unknown => {
    const raw = formData.get(field);
    // Поля нет — это не «правил нет»: вкладка со старой сборкой после
    // развёртывания не рисует скрытых полей, и пустой список стёр бы
    // сохранённое молча. Не разобралось — тоже отказ, а не пустота:
    // не-массив доходит до cleanRules, и тот называет причину.
    if (raw === null) return {};
    try {
      // Разобранный null — тот же отказ, а не «правил нет»: cleanRules
      // читает null как пустой список, и он стёр бы сохранённое молча.
      const parsed: unknown = JSON.parse(String(raw));
      return parsed === null ? {} : parsed;
    } catch {
      return {};
    }
  };
  const follow = cleanRules("follow", parse("follow"), words);
  if ("error" in follow) return follow;
  const exclude = cleanRules("exclude", parse("exclude"), words);
  if ("error" in exclude) return exclude;
  return { follow: follow.rules, exclude: exclude.rules };
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
  minutes: number,
  finish: boolean,
  /** За чем следить и что исключать — в той же транзакции, что и темы. */
  rules: Rules,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      update dailynews.readers
         set digest_minutes = ${minutes},
             onboarded_at = ${finish ? sql`coalesce(onboarded_at, now())` : sql`onboarded_at`},
             updated_at = now()
       where id = ${readerId}
    `;
    await saveRules(tx, readerId, rules);

    const ids: number[] = [];
    for (const [index, chip] of chips.entries()) {
      // Справочник общий, и что в нём можно править, решает `upsertTopic`,
      // а не флаг из формы: каталожная тема и тема, взятая соседом, остаются
      // как были, своя — переписывается.
      ids.push(await upsertTopic(
        tx,
        readerId,
        { slug: slugs[index], label: chip.label, hint: chip.hint ?? "", position: index + 1 },
      ));
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
export async function saveKindleDigest(digest: boolean) {
  const denied = await denyBySection("delivery");
  if (denied) return denied;

  const readerId = await currentReaderId();

  await sql`
    update dailynews.readers
       set kindle_digest = ${digest}, updated_at = now()
     where id = ${readerId}
  `;
  // Без `revalidatePath`, как и у подкаста: тумблер управляемый и уже стоит
  // в новом положении, а перерисовка рождала бы соседний с новым начальным
  // значением.
  return { ok: true as const };
}

/**
 * Как часто выпуск уходит книгой: каждое утро или в субботу за неделю.
 *
 * Своим действием, а не полем при тумблере: переключатель уже сохраняется
 * сам, и «частота, которая ждёт кнопку» рядом с «тумблером, который
 * не ждёт», читалась бы как забытое сохранение.
 *
 * Незнакомое значение отвергается здесь, а не поправляется молча:
 * ограничение в базе всё равно его не пустит, а упасть на своей проверке
 * понятнее, чем на чужой. Предел тарифа проверяет `denyBySection` — ровно
 * тот же, что у самого тумблера: закрытая доставка не должна настраиваться
 * в обход формы.
 */
export async function saveKindlePeriod(period: string) {
  const denied = await denyBySection("delivery");
  if (denied) return denied;

  if (!KINDLE_PERIODS.includes(period as KindlePeriod)) {
    return { error: "неизвестная периодичность" };
  }

  const readerId = await currentReaderId();

  await sql`
    update dailynews.readers
       set kindle_period = ${period}, updated_at = now()
     where id = ${readerId}
  `;
  return { ok: true as const };
}

/**
 * Присылать ли выпуск голосом.
 *
 * Своим действием, а не полем формы Kindle: та форма живёт внутри мастера,
 * и на первых его шагах переключателя на экране нет вовсе — общее действие
 * прочитало бы отсутствие флажка как «выключен» и погасило бы подкаст тому,
 * кто заново настраивает читалку.
 *
 * Сохраняется щелчком, без кнопки: у тумблера одно значение и два
 * положения, и «Сохранить» рядом с ним спрашивает второй раз то же самое.
 */
export async function savePodcast(podcast: boolean) {
  const denied = await denyByFeature("audio");
  if (denied) return denied;

  const readerId = await currentReaderId();
  await sql`
    update dailynews.readers
       set podcast = ${podcast}, updated_at = now()
     where id = ${readerId}
  `;
  // Без `revalidatePath` намеренно. Страница динамическая, и обновлять
  // на ней нечего: тумблер управляемый и уже стоит в новом положении.
  // Перерисовка же заново рождала бы соседний, неуправляемый тумблер
  // читалки с новым начальным значением — Base UI пишет об этом в консоль,
  // и за жалобой стоит настоящая возможность разойтись с базой.
  return { ok: true as const };
}

/**
 * Часовой пояс: выпуск собирается в 02:00 по нему (`src/lib/issue-time.ts`).
 *
 * Зовут двое: поле в «Доставке» и первый заход с пустым поясом — браузер
 * называет свой сам (`TimezoneSync`), спрашивать об этом в онбординге
 * значило бы добавить решение туда, где каждое лишнее закрывает вкладку.
 * Тарифом не закрыт: пояс не стоит ничего, а без него бесплатный читатель
 * в Токио получал бы выпуск к обеду.
 *
 * Имя проверяется здесь: приходит снаружи, а неизвестное таймер прочитал
 * бы как Сан-Паулу — молча и не то.
 */
export async function saveTimezone(timezone: string) {
  if (!isTimezone(timezone)) return { error: "неизвестный часовой пояс" };
  const readerId = await currentReaderId();
  await sql`
    update dailynews.readers
       set timezone = ${timezone}, updated_at = now()
     where id = ${readerId}
  `;
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
  if (!address) return { error: (await getDict()).errors.kindleAddressEmpty };
  if (!/^[^@\s]+@kindle\.com$/.test(address)) {
    return { error: (await getDict()).errors.kindleAddressSuffix };
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
  if (!raw) return { ok: false, error: (await getDict()).errors.emptyLine };

  // Тариф спрашивается до сети. Какой это будет вид, planFor знает без
  // единого запроса, а разбор ссылки X — уже платный запрос к twitterapi.io:
  // потратить деньги и отказать после сохранения значит взять плату
  // за отказ. Вид определяется правилами по хосту, поэтому отказ здесь —
  // это отказ по тарифу, а не догадка.
  const planned = planFor(raw);
  if (!("refuse" in planned)) {
    const plan = effectivePlan(await currentReader());
    const { plans } = await getDict();
    const denials = planned.candidates.map((candidate) => kindDenial(plan, candidate.kind, plans));
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
  if (!isKnownKind(kind)) return { error: (await getDict()).errors.checkLinkFirst };
  if (!url) return { error: (await getDict()).errors.pasteLink };

  // Предел тарифа проверяется до сети: отказать бесплатно дешевле,
  // чем сходить за фидом и отказать после.
  const denied = await denyForKind(reader, kind);
  if (denied) return { error: denied };

  const probe = await probeOne(kind, url, inputUrl);
  if (!probe.ok) return { error: (await getDict()).errors.sourceGone(probe.error) };

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
  return row ? { ok: true as const, label: row.label } : { error: (await getDict()).errors.sourceAlreadyGone };
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
 * Переписать сегодняшний выпуск нынешним голосом.
 *
 * Язык, сложность, манера и «кто читает» уезжают в промпт дайджеста, а выпуск
 * уже написан прежними: настройка принята, лента прежняя — тот же отказ,
 * похожий на успех, что и со сменой числа новостей. Двадцатого сентября 2026
 * выпуск пришёл по-английски, потому что колонка языка была подменена накануне;
 * исправить настройку было можно, а увидеть исправление — нет.
 *
 * Отбор не трогается: меняется то, как написано, а не что выбрано. Поэтому
 * переписывание не спрашивает ни поток, ни Jev — только письмо описаний,
 * те же куски, что и в ночном прогоне.
 */
export async function rewriteDigest() {
  const result = await rewriteFor(await currentReader());
  revalidatePath("/", "layout");
  return result;
}

async function rewriteFor(reader: Reader) {
  const [digest] = await sql<{ id: number; day: string }[]>`
    select d.id::int as id, d.day::text as day
      from dailynews.digests d
     where d.reader_id = ${reader.id}
     order by d.day desc limit 1
  `;
  if (!digest) return { error: (await getDict()).errors.noDigestYet };

  const survivors = await sql<Survivor[]>`
    select i.id::int as id, i.title, coalesce(i.excerpt, '') as excerpt, i.body, i.url,
           s.label as source_label, coalesce(t.label, '') as topic_label,
           di.total, sc.axes
      from dailynews.digest_items di
      join dailynews.items i on i.id = di.item_id
      join dailynews.sources s on s.id = i.source_id
      join dailynews.scores sc on sc.item_id = coalesce(i.dup_of, i.id)
      join dailynews.digests own_digest on own_digest.id = di.digest_id
 left join dailynews.topics t on t.id = sc.topic_id
     where di.digest_id = ${digest.id} and own_digest.reader_id = ${reader.id}
     order by di.total desc
  `;
  if (survivors.length === 0) return { error: (await getDict()).errors.digestEmpty };

  // Тот же потолок, что у догрузки и у ночного прогона: переписывание
  // стоит ровно столько же, сколько письмо описаний с нуля.
  const spent = await spentToday(reader.id);
  if (spent >= reader.daily_cap_usd) {
    return { error: (await getDict()).errors.capReachedRewrite };
  }

  // Переписанный выпуск ищется словарём нового языка: описание теперь
  // написано им, и вектор (0050) пересчитается вместе с текстом.
  const voice = effectiveVoice(reader);
  const written = await writeDigest(
    survivors.map((survivor) => ({
      ...survivor,
      axes: typeof survivor.axes === "string" ? JSON.parse(survivor.axes) : survivor.axes,
    })),
    reader.reader_context,
    voice,
    { readerId: reader.id },
  );
  if (!written.accounted) await recordCall({
    readerId: reader.id, stage: "digest", model: written.model,
    tokensIn: written.usage.input, tokensOut: written.usage.output,
    costUsd: llmCost(written.usage),
  });

  const byId = new Map(written.items.map((item) => [String(item.id), item]));
  let rewritten = 0;
  let retained = 0;
  for (const survivor of survivors) {
    if (written.excludedIds?.includes(survivor.id)) continue;
    if (written.retainedIds?.includes(survivor.id)) { retained++; continue; }
    const item = byId.get(String(survivor.id));
    // Материал, которого модель не вернула, остаётся как был: пустое
    // описание вместо прежнего — это потеря, а не обновление.
    if (!item?.title_ru || item.reading?.status === 'unavailable') { retained++; continue; }
    const updated = await sql`
      update dailynews.digest_items
         set title = ${item.title_ru}, summary = ${item.summary ?? ""},
             summary_document = ${item.reading ? sql.json(item.reading) : null},
             ts_config = coalesce(
               (select oid from pg_ts_config where cfgname = ${tsConfigFor(voice.language)}),
               ${SEARCH_CONFIG}::regconfig::oid
             )::regconfig
       where digest_id = ${digest.id} and item_id = ${survivor.id}
       returning item_id
    `;
    rewritten += updated.length;
  }
  return { ok: true as const, rewritten, retained, day: digest.day };
}

/**
 * Собственно сборка. Отдельно от topUpDigest, потому что последний шаг
 * онбординга зовёт её, не перерисовывая страницу: revalidatePath перерисовал
 * бы сам мастер, а тот, увидев пройденный онбординг, увёл бы читателя
 * на ленту — мимо экрана, ради которого всё и собиралось.
 */
async function fillDigest(reader: Reader) {
  // Только сколько уже набрано: сама строка выпуска заводится в самом конце,
  // после письма описаний. Заведённая здесь, она пережила бы любой отказ ниже —
  // исчерпанный дневной предел, пустой отбор, оборванный ответ модели, —
  // и в базе остался бы пустой выпуск за сегодня. Лента перестала бы
  // предлагать сбор (день-то уже есть), а калибровка посчитала бы выпуск,
  // которого читатель не получал. Ночной прогон делает так же.
  // Последний выпуск, какой есть. `digestProgress` всегда отдаёт объект,
  // и «выпуска ещё не было» — это `day === null`, а не пустая ссылка:
  // проверка на правдивость объекта была бы всегда истинной, и первый
  // заход получал бы слова, написанные для догрузки.
  const existing = await digestProgress(reader.id, null);

  // Через догрузку предел тарифа обходится так же, как через заказ минут:
  // digest_minutes мог остаться от прежнего тарифа, а платит за письмо
  // описаний владелец ключа. Потолок один и тот же, что и в прогоне.
  const plan = effectivePlan(reader);
  const voice = effectiveVoice(reader);
  const perCard = await perCardOf(reader);
  const target = targetMinutes(reader.digest_minutes, plan, perCard);
  const missing = itemsForMinutes(
    target - minutesOf(existing.chars, voice),
    perCard,
    plan.maxItems - existing.items,
  );
  if (missing <= 0) return { ok: true as const, added: 0 };

  // Тот же потолок, что и в ночном прогоне: кнопка «догрузить» тратит
  // те же деньги, и обходить его ей незачем.
  const spent = await spentToday(reader.id);
  if (spent >= reader.daily_cap_usd) {
    return { error: (await getDict()).errors.capReachedTopUp };
  }

  // selectSurvivors сам исключает всё, что уже попало в выпуски этого
  // читателя, поэтому повторная догрузка не выдаст те же материалы второй раз.
  const topics = await getReaderTopics(reader.id);
  // Источники тарифа те же, что в ночном прогоне: кнопка не должна
  // приносить то, чего прогон не принёс бы.
  const mySources = sourcesForPlan(await readerSources(reader.id), plan).map((s) => s.id);
  const survivors = await selectSurvivors(
    // Порог слабого материала — от лучшего за сегодня, а не от лучшего
    // среди оставшихся: иначе кнопка «добрать» приносила бы ровно тех,
    // кого ночной отбор отверг, и тем громче, чем чаще на неё нажимать.
    sql, reader.id, reader.weights, targetsOf(topics), missing, mySources, existing.best,
    // Те же личные правила, что и ночью: первый выпуск и догрузка идут
    // через эту функцию, и кнопка не должна приносить исключённое.
    rulesOf(reader),
  );
  if (survivors.length === 0) {
    // Первому выпуску и догрузке нужны разные слова: «больше нет» в ответ
    // на «собрать сейчас» звучит так, будто что-то уже приходило.
    return {
      ok: true as const,
      added: 0,
      note: existing.day
        ? (await getDict()).errors.noMoreFreshNews
        : (await getDict()).errors.noFreshNewsYet,
    };
  }

  const needImage = await sql<{ id: number; url: string }[]>`
    select id, url from dailynews.items
     where id = any(${survivors.map((item) => item.id)}::bigint[]) and image_url is null
  `;
  await enrichImages(needImage, async (id, image) => {
    await sql`update dailynews.items set image_url = ${image} where id = ${id}`;
  });

  const written = await writeDigest(survivors, reader.reader_context, voice, { readerId: reader.id });
  if (survivors.every(item => written.excludedIds?.includes(item.id))) return { ok: true as const, added: 0 };
  if (!written.accounted) await recordCall({
    readerId: reader.id, stage: "digest", model: written.model,
    tokensIn: written.usage.input, tokensOut: written.usage.output,
    costUsd: llmCost(written.usage),
  });

  // Вторая петля измерения не пропускается: иначе догруженные описания
  // не попадут в ряд по дням, и ряд начнёт врать о том, что читатель видел.
  //
  // Но и уронить выпуск она не должна. Петля меряет наш промпт — она про нас,
  // а не про читателя, — и стоит после того, как описания уже написаны
  // и оплачены. Без этой обёртки молчащий Jev забирал с собой весь первый
  // выпуск нового читателя: текст есть, деньги потрачены, в базе ничего.
  // Ряд по дням в такой день просто короче, и это видно.
  let quality: Awaited<ReturnType<typeof scoreSummaries>> | null = null;
  try {
    quality = written.accounted ? null : await scoreSummaries(
      written.items.map((item) => ({
        id: Number(item.id), title: item.title_ru, summary: item.summary,
      })),
      reader.reader_context,
    );
  } catch (error) {
    console.error(`качество описаний не измерено: ${(error as Error).message}`);
  }
  // Отдельно от самого измерения: упавшая запись расхода — это потраченные
  // деньги без следа, и называться она должна своей причиной, а не чужой.
  try {
    if (quality) await recordCall({
      readerId: reader.id, stage: "summary", model: quality.model,
      tokensIn: quality.inputTokens, costUsd: jevCost(quality.inputTokens),
    });
  } catch (error) {
    console.error(`расход на измерение не записан: ${(error as Error).message}`);
  }

  const writtenById = new Map(written.items.map((item) => [String(item.id), item]));
  const qualityById = new Map((quality?.scored ?? []).map((row) => [String(row.item_id), row]));

  /*
    Всё письмо в базу — одной транзакцией. Врозь оно коммитится по шагу,
    и падение на любом из них (материал удалён между отбором и вставкой —
    и внешний ключ не пускает) оставляет заведённый выпуск и часть строк:
    лента и разбор попаданий посчитают его наравне с настоящим.

    Выпуск перечитывается здесь, а не берётся из `existing`: тот прочитан
    до письма описаний, и за минуты письма ночной прогон успевает собрать
    новый день. `for update` держит саму строку от чужой записи в неё,
    но вставку прогоном нового дня не задерживает — у новой строки другой
    ключ. Остаётся окно в несколько минут, в которое материалы лягут
    во вчерашний выпуск; закрыть его по-настоящему можно только общим
    замком с прогоном, а он пишет выпуск вне транзакции.
  */
  const added = await sql.begin(async (tx) => {
    const [current] = await tx<{ id: number }[]>`
      select id::int as id from dailynews.digests
       where reader_id = ${reader.id}
       order by day desc limit 1
       for update
    `;
    let digestId = current?.id;
    if (digestId === undefined) {
      // `on conflict` — про гонку с ночным прогоном: он мог завести
      // сегодняшний выпуск между этим select и вставкой. Интро уже написано
      // и оплачено этим же вызовом: не сохранить его значило бы отличаться
      // от ночного выпуска молча.
      const [row] = await tx<{ id: number }[]>`
        insert into dailynews.digests (reader_id, day, intro)
        values (${reader.id}, current_date, ${written.intro})
        on conflict (reader_id, day) do update set reader_id = excluded.reader_id
        returning id::int as id
      `;
      digestId = row.id;
    }

    // Заказ этого дня остаётся при самом выпуске: лента показывает недобор,
    // сравнивая набранное с тем, что заказывали тогда, а не сегодня. Иначе
    // читатель, поднявший заказ с пяти минут до сорока пяти, увидел бы
    // «сегодня больше нечего» на каждом старом выпуске, который был полон.
    await tx`
      update dailynews.digests
         set stats = coalesce(stats, '{}'::jsonb)
                   -- Каст обязателен: у jsonb_build_object аргумент
                   -- полиморфный ("any"), и тип нетипизированного параметра
                   -- Postgres вывести не может — запрос падает на разборе,
                   -- до единой строки данных. Тот же урок, что с date - ?.
                   || jsonb_build_object('reading_target', ${Number(target.toFixed(1))}::real)
       where id = ${digestId}
    `;

    const [{ taken, chars, last }] = await tx<{ taken: number; chars: number; last: number }[]>`
      select count(*) filter (where coalesce(summary_document->>'status','verified') <> 'unavailable')::int as taken,
             coalesce(max(position),0)::int as last,
             coalesce(sum(
               case when summary_document->>'status'='unavailable' then 0
                 else char_length(coalesce(title, '')) + char_length(coalesce(summary, '')) end
             ), 0)::int as chars
        from dailynews.digest_items where digest_id = ${digestId}
    `;

    // Обрезаем по настоящему остатку: выпуск, набитый поверх чужой работы,
    // пробил бы потолок тарифа — и это были бы уже настоящие деньги.
    //
    // Здесь остаток меряется написанным текстом, а не оценкой: описания
    // уже есть, и считать их приблизительно незачем. Последняя карточка
    // переступает цель, а не не доходит до неё: разделить карточку нельзя,
    // а недобор в полминуты зажёг бы строку «сегодня больше нечего» там,
    // где есть всё.
    const fitting: Survivor[] = [];
    let filled = minutesOf(chars, voice);
    for (const survivor of survivors) {
      if (filled >= target || taken + fitting.length >= plan.maxItems) break;
      // Дописывается только написанное: снятое правилами и то, для чего
      // проверенной выжимки не вышло, карточкой не становится.
      const text = writtenById.get(String(survivor.id));
      if (!text) continue;
      fitting.push(survivor);
      filled += minutesOf(cardChars(text.title_ru ?? survivor.title, text.summary ?? ""), voice);
    }

    // Дописываем только то, чего в выпуске ещё нет: два одновременных нажатия
    // иначе положили бы один материал дважды.
    let rows = 0;
    for (const [index, survivor] of fitting.entries()) {
      const text = writtenById.get(String(survivor.id));
      const scored = qualityById.get(String(survivor.id));
      // Возвращаем item_id, а не id: у digest_items нет собственного ключа,
      // он составной — (digest_id, item_id). `returning id` падал здесь
      // на каждом вызове, и видно это было только по вежливому «не получилось
      // собрать выпуск»: у нового читателя первый выпуск не собирался вовсе.
      const inserted = await tx<{ item_id: number }[]>`
        insert into dailynews.digest_items
          (digest_id, item_id, total, position, title, summary, summary_document, summary_axes, summary_score,
           ts_config)
        values (
          ${digestId}, ${survivor.id}, ${survivor.total}, ${last + index + 1},
          ${text?.title_ru ?? survivor.title}, ${text?.summary ?? ""},
          ${text?.reading ? tx.json(text.reading) : null},
          ${scored ? sql.json(scored.axes as unknown as Parameters<typeof sql.json>[0]) : null},
          ${scored?.total ?? null},
          -- Имя словаря через каталог, с откатом на общий: неизвестное имя
          -- роняло бы вставку уже оплаченного выпуска (см. pipeline/run.ts).
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
        returning item_id::int as item_id
      `;
      rows += inserted.length;
    }
    return rows;
  });

  // Считаем вставленное, а не отобранное: при двух наложившихся нажатиях
  // `do nothing` отбрасывает часть строк молча, и «Добавлено: 5» на трёх
  // добавленных — отказ, выглядящий как успех.
  return { ok: true as const, added };
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
 * Подключить Telegram — значит назвать канал, куда он пишет: профиль
 * здесь ничего не говорит, вход через бота уже сделан. Канал проверяется
 * тем же разбором, что и источники: сохраняется только тот, что ответил
 * постами. Владение не проверяется — для этого бот должен стать админом
 * канала, и понадобится это вместе с автопостингом, не раньше.
 */
export async function connectTelegram(input: string): Promise<{ ok: true } | { error: string }> {
  const denied = await denyBySection("posts");
  if (denied) return denied;
  const readerId = await currentReaderId();

  const found = await discover(input);
  if (!found.ok) return { error: found.error };
  if (NETWORK_BY_KIND[found.found.kind] !== "telegram") {
    return { error: (await getDict()).errors.notATelegramChannel };
  }

  await saveChannel(readerId, "telegram", {
    handle: found.found.url,
    input_url: found.found.input_url,
    label: found.found.label,
  });
  await setChannelPublishes(readerId, "telegram", true);
  revalidatePath("/settings/channels");
  return { ok: true as const };
}

/**
 * Отметить сеть, куда он публикует. Адрес при этом не трогается.
 *
 * Раньше снятая галочка удаляла строку целиком, а с ней и разобранный
 * адрес канала: 22 сентября 2026 владелец снял и вернул галочку Telegram,
 * разглядывая экран, и `@publicigor` исчез молча — перечитать голос стало
 * нечем. Теперь галочка гасит только таб (0058).
 */
export async function toggleChannel(network: string, on: boolean) {
  const denied = await denyBySection("posts");
  if (denied) return denied;
  const readerId = await currentReaderId();
  if (!NETWORK_IDS.includes(network as NetworkId)) return { error: (await getDict()).errors.unknownNetwork };

  await setChannelPublishes(readerId, network, on);
  revalidatePath("/settings/channels");
  return { ok: true as const };
}

/**
 * Язык постов для одной сети. Пусто — не называть: пишется как в стиле.
 * Список проверяется здесь, а не только селектом: строка уходит в промпт,
 * и прислать туда можно что угодно мимо формы.
 */
export async function saveChannelLanguage(network: string, language: string) {
  const denied = await denyBySection("posts");
  if (denied) return denied;
  const readerId = await currentReaderId();
  if (!NETWORK_IDS.includes(network as NetworkId)) return { error: (await getDict()).errors.unknownNetwork };
  const value = String(language ?? "").trim();
  if (value && (value === SOURCE_LANGUAGE || !LANGUAGES.includes(value))) {
    return { error: (await getDict()).errors.unknownLanguage };
  }
  await setChannelLanguage(readerId, network, value || null);
  revalidatePath("/settings/channels");
  return { ok: true as const };
}

/**
 * «Писать черновики в моём стиле»: свитчер и текст одной записью.
 * Включить можно только с текстом — пустой стиль молча писал бы
 * настройками подачи под видом «моего стиля».
 */
export async function saveStyle(enabled: boolean, text: string): Promise<{ ok: true } | { error: string }> {
  const denied = await denyBySection("posts");
  if (denied) return denied;
  const readerId = await currentReaderId();
  const t = (await getDict()).onboarding.channels;
  const clean = cleanStyle(String(text ?? ""));
  if (String(text ?? "").trim().length > STYLE_LIMIT) return { error: t.styleTooLong(STYLE_LIMIT) };
  if (enabled && !hasStyle(clean)) return { error: t.styleEmpty };
  await saveVoiceStyle(readerId, Boolean(enabled), clean);
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
export async function rebuildVoice(): Promise<{ ok: true; text: string; built_from: number; ranked: boolean; failed: string[] } | { error: string }> {
  const denied = await denyBySection("posts");
  if (denied) return denied;
  const reader = await currentReader();

  const spent = await spentToday(reader.id);
  if (spent >= reader.daily_cap_usd) {
    return { error: (await getDict()).errors.dailyCap(reader.daily_cap_usd) };
  }

  const channels = await getChannels(reader.id);
  // Стиль изучается из подключённых соцсетей. X, подключённый входом,
  // адреса не хранит, но его ник из входа и есть то, что читается
  // (`from:ник`); LinkedIn и Threads наружу не отдают ничего.
  const { posts, failed } = await readOwnPosts(
    channels
      .filter((channel) => channel.publishes || channel.network === "blog")
      .map((channel) => ({
        network: channel.network as NetworkId,
        handle:
          channel.handle ??
          (channel.network === "x" && channel.account?.startsWith("@") ? channel.account : null),
      })),
    reader.voice_sample,
  );
  if (posts.length === 0) {
    return {
      error: failed.length
        ? (await getDict()).errors.noChannelAnswered(
            failed.map((entry) => `${entry.network} — ${entry.why}`).join("; "),
          )
        : (await getDict()).errors.nothingToReadFromYou,
    };
  }

  try {
    const built = await buildVoiceCard(posts, reader.id);
    await saveVoiceCard(reader.id, built.card);
    revalidatePath("/settings/channels");
    // Текст не сохраняется здесь: он ложится в поле, автор его читает
    // и правит, и сохраняет уже своей кнопкой — разбор чужими глазами
    // (модели по публичному каналу) не должен сам становиться инструкцией.
    return {
      ok: true as const,
      text: cardText(built.card),
      built_from: built.card.built_from,
      ranked: built.card.ranked,
      failed: failed.map((entry) => `${entry.network}: ${entry.why}`),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : (await getDict()).errors.voiceNotBuilt };
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
  | {
      ok: true; drafts: SavedDraft[]; hook: string; added: string[]; about: string[];
      fallback: boolean; built_from: number;
    }
  | { error: string }
> {
  const denied = await denyBySection("posts");
  if (denied) return denied;
  const reader = await currentReader();

  const spent = await spentToday(reader.id);
  if (spent >= reader.daily_cap_usd) {
    return { error: (await getDict()).errors.dailyCap(reader.daily_cap_usd) };
  }

  const item = await postSourceFor(reader.id, itemId);
  if (!item) return { error: (await getDict()).errors.itemNotYours };

  const channels = await getChannels(reader.id);
  const networks = tabsOf(publishedIn(channels));
  if (networks.length === 0) {
    return { error: (await getDict()).errors.noChannelsYet };
  }

  // Свитчер включён — пишем его стилем. Нет — настройками подачи, и мотатка
  // обязана сказать это вслух: иначе он прочтёт общий черновик и решит,
  // что возможность не работает.
  const style = draftStyle(reader);

  try {
    const ids = networks.map((network) => network.id);
    const takes = takesBlock(await recentTakes(reader.id, ids));
    const written = await writePost(
      item, [style.block, takes].filter(Boolean).join("\n\n"), ids, reader.id, languagesOf(channels),
    );
    const saved = await saveDrafts(reader.id, item.id, written.drafts);
    return {
      ok: true as const,
      drafts: saved,
      hook: written.hook,
      added: written.added,
      about: written.about,
      fallback: style.fallback,
      built_from: style.built_from,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : (await getDict()).errors.postNotWritten };
  }
}

/** Он скопировал пост: отметка и его правка — вход для следующей карточки. */
export async function takeOpinion(postId: number, text: string) {
  const readerId = await currentReaderId();
  const ok = await takeDraft(readerId, postId, text.slice(0, 10_000));
  return ok ? { ok: true as const } : { error: (await getDict()).errors.draftNotFound };
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
export async function saveOnboardingInterests(
  slugs: string[],
  custom: string[],
  // Необязательные блоки первого экрана. Сохраняются здесь же, до сборки
  // первого выпуска: он собирается на последнем шаге и обязан их учесть.
  // Пустое по умолчанию, а не отказ, как у формы настроек: на первом
  // экране правил у читателя ещё нет, и стирать здесь нечего, — а вкладка
  // со старой сборкой должна пройти онбординг, а не упереться в ошибку.
  follow: unknown = [],
  exclude: unknown = [],
) {
  const reader = await currentReader();
  const plan = effectivePlan(reader);

  const words = (await getDict()).rules;
  const followRules = cleanRules("follow", follow, words);
  if ("error" in followRules) return { error: followRules.error };
  const excludeRules = cleanRules("exclude", exclude, words);
  if ("error" in excludeRules) return { error: excludeRules.error };

  const picked = slugs
    .map((slug) => starterBySlug.get(slug))
    .filter((topic) => topic !== undefined)
    .map((topic) => ({ slug: topic.slug, label: topic.label, hint: topic.hint, count: MIN_PER_TOPIC }));

  // Вписанное руками: подсказки у него нет, и это нормально — Jev получит
  // само название. Пустая тема в справочник не уезжает.
  const mine = custom
    .map((label) => clampTopicText(label, TOPIC_LIMITS.label))
    .filter(Boolean)
    .map((label) => ({ slug: toSlug(label), label, hint: "", count: MIN_PER_TOPIC }));

  const chips = [...picked, ...mine].filter(
    (chip, index, all) => chip.slug && all.findIndex((other) => other.slug === chip.slug) === index,
  );

  if (chips.length === 0) return { error: (await getDict()).errors.pickAnyTopic };
  if (chips.length > plan.maxTopics) {
    return {
      error: (await getDict()).errors.tooManyTopics(plan.label, plan.maxTopics, chips.length),
    };
  }

  // Заказ по умолчанию — потолок тарифа: на первом экране это третье решение
  // подряд, а тариф и так знает своё время. Поменять можно в «Интересах».
  const minutes = plan.maxMinutes;
  const places = itemsForMinutes(minutes, await perCardOf(reader), plan.maxItems);
  await writeTopics(
    reader.id,
    chips,
    chips.map((chip) => chip.slug),
    normalize(chips.map(() => MIN_PER_TOPIC), places),
    minutes,
    false,
    { follow: followRules.rules, exclude: excludeRules.rules },
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
/**
 * Своя ссылка прямо на шаге источников.
 *
 * Раньше её тут не было, и подпись шага отправляла читателя в настройки
 * или в бота — «добавишь потом». Момент был выбран худший: именно здесь
 * человек готов назвать то, что читает сам, и именно здесь ему отвечали
 * «не сейчас». Экран при этом предлагает ровно столько, сколько вмещает
 * тариф, и читается как «бери или не бери».
 *
 * Путь тот же, что у бота и у формы в настройках: `addByLink` спрашивает
 * тариф до сети (разбор ссылки X — уже платный запрос), разбирает, проверяет
 * пробой и сохраняет. Своего разбора здесь нет намеренно: три копии одних
 * правил разойдутся молча, и первым разойдётся тот, которым реже пользуются.
 */
export async function addOnboardingSource(input: string) {
  const reader = await currentReader();
  const result = await addByLink(reader, input);
  if (!result.ok) return { error: result.error };

  const t = dictOf(reader.ui_language).onboarding;
  // Перерисовки здесь нет намеренно, и это тот же урок, что у finishOnboarding.
  // Источник уже связан с читателем, поэтому после revalidatePath шаг мастера
  // пересчитывается по данным, видит «источники есть» и уводит на последний
  // экран — прямо из-под пальца, вставившего ссылку. Список на экране клиент
  // и так обновляет сам.
  return {
    ok: true as const,
    suggestion: {
      key: `${result.found.kind}|${result.found.url}`,
      kind: result.found.kind,
      url: result.found.url,
      label: result.found.label,
      // Доказательство, что источник ответил, а не просто открылся:
      // принятый пустым через неделю неотличим от заброшенного.
      why: t.wizard.sources.addedWhy(result.found.fresh),
    },
  };
}

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
  if (chosen.length === 0) return { error: (await getDict()).errors.pickOneSource };

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
    return { error: (await getDict()).errors.firstIssueFailed };
  }
}
