"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "./db";
import { checkPassword, issueLoginToken, issueSession, SESSION_COOKIE } from "./auth";
import { detectSource, probeSource, saveSource } from "../../pipeline/detect";
import { selectSurvivors } from "../../pipeline/select";
import { writeDigest } from "../../pipeline/digest";
import { scoreSummaries } from "../../pipeline/summary-quality";
import { enrichImages } from "../../pipeline/og";
import { SOURCE_KINDS, type Profile, type SourceKind } from "./types";
import { MAX_DIGEST, MIN_PER_TOPIC, normalize } from "./topic-budget";
import { DEFAULT_COMPLEXITY, DEFAULT_STYLE } from "./voice";
import { toSlug } from "./slug";

export async function login(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!(await checkPassword(password))) {
    return { error: "Не подходит" };
  }
  const session = await issueSession();
  (await cookies()).set(session.name, session.value, session.options);
  redirect(String(formData.get("next") || "/"));
}

/**
 * Ссылка входа приходит в тот же чат, что и дайджест. Почта потребовала бы
 * отдельного провайдера и ещё одного ключа, а бот уже настроен и проверен.
 */
export async function sendLoginLink() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const appUrl = process.env.APP_URL;
  if (!token || !chatId || !appUrl) {
    return { error: "Telegram или адрес приложения не настроены" };
  }

  const link = `${appUrl.replace(/\/$/, "")}/auth?token=${encodeURIComponent(await issueLoginToken())}`;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `<a href="${link}">Войти в ленту</a>\n\nСсылка действует 10 минут.`,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return { error: `Telegram ответил ${res.status}` };
  return { ok: true as const };
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

/** `count` — цель по числу новостей в день; в базе это `topics.weight`. */
export type ChipInput = { slug: string; label: string; hint: string; count: number };

/**
 * Персонализация и интересы — две формы, поэтому два действия. Одна функция
 * с ветками «пришло ли поле» молча очищала бы то, чего в форме нет.
 */
export async function savePersonalization(formData: FormData) {
  // Язык — свободный текст: список из трёх выбирал автор формы, а не читатель.
  const language = String(formData.get("language") ?? "").trim().slice(0, 60) || "русском";
  const readerContext = String(formData.get("reader_context") ?? "").slice(0, 4000);
  // Ползунок шлёт строку, а нечисло превратилось бы в NaN и уронило запрос
  // ограничением, а не подсказкой. Держим в границах колонки здесь же.
  const asked = Number(formData.get("complexity"));
  const complexity = Math.min(5, Math.max(1, Math.round(Number.isFinite(asked) ? asked : 3)));
  const style = String(formData.get("style") ?? "").trim().slice(0, 40) || "нейтральный";

  await sql`
    update dailynews.profile
       set reader_context = ${readerContext},
           language = ${language},
           complexity = ${complexity},
           style = ${style},
           onboarded_at = coalesce(onboarded_at, now()),
           updated_at = now()
     where id = 1
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
  const chips = JSON.parse(String(formData.get("chips") ?? "[]")) as ChipInput[];
  if (chips.length === 0) return { error: "Добавь хотя бы один интерес" };

  const slugs = chips.map((chip) => chip.slug || toSlug(chip.label));
  // Разные названия дают один slug: «ИИ-инфра» и «ИИ инфра» после
  // транслитерации совпадают, on conflict схлопывает их в одну строку,
  // и цель первой темы теряется. Сумма целей молча перестаёт равняться
  // размеру дайджеста — полоса показывает одно, приходит другое.
  if (new Set(slugs).size !== slugs.length) {
    return { error: "Два интереса совпадают после упрощения названия — переименуй один" };
  }
  const digestSize = Math.min(MAX_DIGEST, Math.max(3, Math.round(Number(formData.get("digest_size"))) || 12));
  // Приводим ещё раз на сервере: из формы приходит то, что нарисовал
  // браузер, а сумма целей — это и есть обещание размера дайджеста.
  const counts = normalize(
    chips.map((chip) => Math.max(MIN_PER_TOPIC, Math.round(Number(chip.count)) || MIN_PER_TOPIC)),
    digestSize,
  );

  await sql.begin(async (tx) => {
    await tx`update dailynews.profile set digest_size = ${digestSize} where id = 1`;
    // Темы, которые убрали, гасим, а не удаляем: на них ссылаются
    // оценки уже собранных материалов, и калибровке они ещё пригодятся.
    await tx`update dailynews.topics set active = false where slug <> all(${slugs})`;

    for (const [index, chip] of chips.entries()) {
      // Цель по числу новостей и есть вес темы: отбор делит номер материала
      // внутри темы на неё, и при сумме, равной размеру дайджеста, каждая
      // тема получает примерно столько, сколько здесь написано.
      const weight = counts[index];
      await tx`
        insert into dailynews.topics (slug, label, hint, weight, position, active)
        values (${slugs[index]}, ${chip.label}, ${chip.hint ?? ""}, ${weight}, ${index + 1}, true)
        on conflict (slug) do update
          set label = excluded.label, hint = excluded.hint,
              weight = excluded.weight,
              position = excluded.position, active = true
      `;
    }

    // Онбординг считается пройденным по интересам: без них лента пуста.
    await tx`
      update dailynews.profile
         set onboarded_at = coalesce(onboarded_at, now()), updated_at = now()
       where id = 1
    `;
  });

  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function saveLlm(formData: FormData) {
  const provider = String(formData.get("base_url") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const apiKey = String(formData.get("api_key") ?? "").trim();

  if (provider && !/^https:\/\//.test(provider)) {
    return { error: "Адрес должен начинаться с https://" };
  }

  // Пустой ключ означает «не менять»: иначе форма стирала бы сохранённый
  // ключ каждый раз, когда её открывают посмотреть остальные поля.
  await sql`
    update dailynews.profile
       set llm = jsonb_strip_nulls(
             llm
             || jsonb_build_object('base_url', nullif(${provider}, ''))
             || jsonb_build_object('model', nullif(${model}, ''))
             || case when ${apiKey} = '' then '{}'::jsonb
                     else jsonb_build_object('api_key', ${apiKey}) end
           ),
           updated_at = now()
     where id = 1
  `;
  revalidatePath("/settings/subscription");
  return { ok: true as const };
}

export async function clearLlmKey() {
  await sql`update dailynews.profile set llm = llm - 'api_key' where id = 1`;
  revalidatePath("/settings/subscription");
}

/**
 * Добавление источника. Основной путь — просто ссылка: тип и настоящий адрес
 * фида определяются сами, название берётся из фида. Остальные типы (запрос X,
 * listing Hacker News) ссылкой не выражаются, поэтому тип можно выбрать руками.
 *
 * Любой путь проходит живую пробу до сохранения: каталог из непроверенных
 * адресов превращается в пустую вкладку через неделю.
 */
export async function addSource(formData: FormData) {
  const kind = String(formData.get("kind") ?? "auto");
  const input = String(formData.get("url") ?? "").trim();
  const typed = String(formData.get("label") ?? "").trim();
  if (!input) return { error: "Пустой адрес" };
  // Тип приходит скрытым полем, то есть извне. Незнакомое значение иначе
  // дойдёт до check-ограничения колонки и упадёт запросом, а не подсказкой.
  if (kind !== "auto" && !SOURCE_KINDS.includes(kind as SourceKind)) {
    return { error: `Неизвестный тип источника: ${kind}` };
  }

  const probe =
    kind === "auto"
      ? await detectSource(input)
      : await probeSource({
          kind: kind as SourceKind,
          url: input,
          label: typed || input,
        });
  if (!probe.ok) return { error: probe.error };
  const found = probe.found;

  try {
    await saveSource(sql, { ...found, label: typed || found.label }, input);
  } catch (error) {
    // Вид источника разрешает ограничение колонки, а не только код. Пока
    // миграция не применена, база отвергает то, что форма уже предлагает,
    // и без этой ветки читатель получает пятисотку вместо причины.
    if ((error as { code?: string }).code === "23514") {
      return {
        error: `База не знает вид «${found.kind}» — примени миграции из db/migrations`,
      };
    }
    throw error;
  }
  revalidatePath("/settings/sources");
  return { ok: true as const, found };
}

export async function setSourceActive(id: number, active: boolean) {
  await sql`update dailynews.sources set active = ${active} where id = ${id}`;
  revalidatePath("/settings/sources");
}

export async function deleteSource(id: number) {
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
  const [profile] = await sql<Profile[]>`select * from dailynews.profile where id = 1`;
  const [digest] = await sql<{ day: string; item_ids: number[] }[]>`
    select day::text as day, item_ids from dailynews.digests order by day desc limit 1
  `;
  if (!digest) return { error: "Ни одного выпуска ещё нет — дождись прогона" };

  const missing = profile.digest_size - digest.item_ids.length;
  if (missing <= 0) return { ok: true as const, added: 0 };

  // selectSurvivors сам исключает всё, что уже попало в любой выпуск,
  // поэтому повторная догрузка не выдаст те же материалы второй раз.
  const survivors = await selectSurvivors(sql, missing);
  if (survivors.length === 0) {
    return { ok: true as const, added: 0, note: "Свежих материалов больше нет" };
  }

  await enrichImages(
    survivors.map((item) => ({ id: item.id, url: item.url })),
    async (id, image) => {
      await sql`update dailynews.items set image_url = ${image} where id = ${id}`;
    },
  );

  const written = await writeDigest(survivors, profile.reader_context, profile.llm ?? {}, {
    language: profile.language ?? "русском",
    complexity: profile.complexity ?? DEFAULT_COMPLEXITY,
    style: profile.style ?? DEFAULT_STYLE,
  });
  for (const item of written.items) {
    await sql`
      update dailynews.items
         set title_ru = ${item.title_ru}, summary = ${item.summary}
       where id = ${item.id}
    `;
  }

  // Вторая петля измерения не пропускается: иначе догруженные описания
  // не попадут в ряд по дням, и ряд начнёт врать о том, что читатель видел.
  const quality = await scoreSummaries(
    written.items.map((item) => ({
      id: Number(item.id), title: item.title_ru, summary: item.summary,
    })),
    profile.reader_context,
  );
  for (const row of quality.scored) {
    await sql`
      update dailynews.items
         set summary_axes = ${sql.json(row.axes as unknown as Parameters<typeof sql.json>[0])},
             summary_score = ${row.total}
       where id = ${row.item_id}
    `;
  }

  // Дописываем только то, чего в выпуске ещё нет: два одновременных нажатия
  // иначе положили бы один материал дважды.
  await sql`
    update dailynews.digests
       set item_ids = item_ids || (
             select coalesce(array_agg(id), '{}')
               from unnest(${survivors.map((item) => item.id)}::bigint[]) as fresh(id)
              where not (id = any(item_ids))
           )
     where day = ${digest.day}
  `;

  revalidatePath("/", "layout");
  return { ok: true as const, added: survivors.length };
}
