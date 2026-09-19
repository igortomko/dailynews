"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "./db";
import { checkPassword, issueSession, SESSION_COOKIE } from "./auth";
import { checkFeed } from "../../pipeline/check-sources";

export async function login(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!(await checkPassword(password))) {
    return { error: "Не подходит" };
  }
  const session = await issueSession();
  (await cookies()).set(session.name, session.value, session.options);
  redirect(String(formData.get("next") || "/"));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export type ChipInput = { slug: string; label: string; hint: string };

/** Транслитерация в slug: он уходит в Jev как имя варианта choice. */
function toSlug(label: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e",
    ю: "yu", я: "ya", ь: "", ъ: "",
  };
  return label
    .toLowerCase()
    .split("")
    .map((char) => map[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "topic";
}

export async function saveInterests(formData: FormData) {
  const chips = JSON.parse(String(formData.get("chips") ?? "[]")) as ChipInput[];
  const readerContext = String(formData.get("reader_context") ?? "").slice(0, 4000);
  const digestSize = Math.min(50, Math.max(3, Number(formData.get("digest_size") ?? 12)));

  if (chips.length === 0) return { error: "Добавь хотя бы один интерес" };

  const slugs = chips.map((chip) => chip.slug || toSlug(chip.label));

  await sql.begin(async (tx) => {
    // Темы, которые убрали, гасим, а не удаляем: на них ссылаются
    // оценки уже собранных материалов, и калибровке они ещё пригодятся.
    await tx`update dailynews.topics set active = false where slug <> all(${slugs})`;

    for (const [index, chip] of chips.entries()) {
      await tx`
        insert into dailynews.topics (slug, label, hint, position, active)
        values (${slugs[index]}, ${chip.label}, ${chip.hint ?? ""}, ${index + 1}, true)
        on conflict (slug) do update
          set label = excluded.label, hint = excluded.hint,
              position = excluded.position, active = true
      `;
    }

    await tx`
      update dailynews.profile
         set reader_context = ${readerContext},
             digest_size = ${digestSize},
             onboarded_at = coalesce(onboarded_at, now()),
             updated_at = now()
       where id = 1
    `;
  });

  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function addSource(formData: FormData) {
  const kind = String(formData.get("kind") ?? "rss") as "rss" | "reddit" | "hackernews" | "x";
  const url = String(formData.get("url") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || url;
  if (!url) return { error: "Пустой адрес" };

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
  revalidatePath("/sources");
  return { ok: true as const };
}

export async function setSourceActive(id: number, active: boolean) {
  await sql`update dailynews.sources set active = ${active} where id = ${id}`;
  revalidatePath("/sources");
}

export async function deleteSource(id: number) {
  await sql`delete from dailynews.sources where id = ${id}`;
  revalidatePath("/sources");
}
