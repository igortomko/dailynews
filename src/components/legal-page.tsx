import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getReader } from "@/lib/readers";
import { LOCALES, LOCALE_LABELS, localeOf, type Locale } from "@/lib/i18n";
import { LEGAL } from "@/lib/legal";

/**
 * Политика и условия открыты без входа: их читают ревьюеры Meta и тот,
 * кто ещё решает, заводиться ли. Язык — из `?lang`, иначе у вошедшего
 * читателя его собственный, иначе английский, как на экране входа.
 */
export async function legalLocale(lang: string | string[] | undefined): Promise<Locale> {
  if (typeof lang === "string" && (LOCALES as readonly string[]).includes(lang)) return lang as Locale;
  const id = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const reader = id ? await getReader(id).catch(() => undefined) : undefined;
  return localeOf(reader?.ui_language);
}

export async function LegalPage({
  kind,
  searchParams,
}: {
  kind: "privacy" | "terms" | "refund";
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const locale = await legalLocale((await searchParams).lang);
  const doc = LEGAL[locale][kind];
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12 text-sm leading-relaxed">
      <nav className="flex gap-3 text-muted-foreground">
        {LOCALES.map((code) => (
          <Link
            key={code}
            href={`/${kind}?lang=${code}`}
            aria-current={code === locale ? "page" : undefined}
            className={code === locale ? "font-medium text-foreground" : "hover:text-foreground"}
          >
            {LOCALE_LABELS[code]}
          </Link>
        ))}
      </nav>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium">{doc.title}</h1>
        <p className="text-muted-foreground">{doc.updated}</p>
      </header>
      <p>{doc.intro}</p>
      {doc.sections.map((section) => (
        <section key={section.id} id={section.id} className="flex flex-col gap-2">
          <h2 className="text-base font-medium">{section.heading}</h2>
          {section.paragraphs.map((text) => (
            <p key={text} className="text-muted-foreground">{text}</p>
          ))}
        </section>
      ))}
    </main>
  );
}
