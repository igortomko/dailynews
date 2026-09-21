import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { archiveSize, searchArchive, type ArchiveHit } from "@/lib/queries";
import { highlight } from "@/lib/search";
import { currentReader } from "@/lib/session";
import { dayInWords } from "@/lib/telegram";
import { PageHeader } from "@/components/page-header";
import { SearchForm } from "@/components/search-form";
import { RememberQuery } from "@/components/search-memory";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getDict } from "@/lib/i18n/server";
import type { Dict } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Archive = { items: number; days: number };
type Found = { hits: ArchiveHit[]; loose: boolean };

/**
 * Дата выпуска в выдаче. `dayInWords` намеренно не пишет год — выпуск
 * приходит в день выпуска, — но здесь смысл обратный: ищут как раз то,
 * что было давно, и «19 сентября» без года у прошлогоднего материала
 * выглядит свежим.
 *
 * Год пишется всегда, а не только у прошлых лет. Сравнивать было бы
 * не с чем: «нынешний год» на сервере считается по UTC, а читатель живёт
 * в своём часовом поясе, и под Новый год у половины земного шара это
 * разные годы. Лишний год в архиве — это лишнее слово, недостающий —
 * неверная дата.
 */
function dayLabel(day: string): string {
  const words = dayInWords(day);
  return words === day ? day : `${words} ${day.slice(0, 4)}`;
}

function Hit({ hit, t }: { hit: ArchiveHit; t: Dict }) {
  return (
    <article className="border-b py-4 last:border-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {/* Выпуск, а не только статья: «где я это видел» — вопрос и про
            соседние новости того дня тоже. */}
        <Link href={`/?day=${hit.day}`} className="hover:text-foreground">
          {t.feed.searchPage.digestOf(dayLabel(hit.day))}
        </Link>
        <span aria-hidden>·</span>
        <span>{hit.source_label}</span>
        {hit.topic_label ? (
          <>
            <span aria-hidden>·</span>
            <span>{hit.topic_label}</span>
          </>
        ) : null}
      </div>
      <h3 className="mt-1 leading-snug font-medium">
        <a
          href={hit.url}
          target="_blank"
          rel="noreferrer"
          className="hover:underline focus-visible:underline"
        >
          {hit.title}
        </a>
      </h3>
      {/* Пустого абзаца быть не должно: у материала без описания и без
          текста отрывку взяться неоткуда, а поля вокруг пустоты читаются
          как потерянная строка. */}
      {hit.snippet.length > 0 ? (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {/* Найденное отмечается начертанием и цветом, а не заливкой: жёлтый
              маркер живёт в светлой теме и разваливается в тёмной. */}
          {highlight(hit.snippet).map((part, index) =>
            part.mark ? (
              <mark key={index} className="bg-transparent font-medium text-foreground">
                {part.text}
              </mark>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </p>
      ) : null}
    </article>
  );
}

/**
 * Четыре состояния страницы: искать не в чем, ещё не искали, не нашлось,
 * нашлось. Ранними возвратами, а не лестницей условий: лестницу из четырёх
 * ступеней читают только целиком, а состояния друг от друга не зависят.
 */
function Results({
  archive,
  query,
  found,
  t,
}: {
  archive: Archive;
  query: string;
  found: Found | null;
  t: Dict;
}) {
  if (archive.items === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t.feed.searchPage.emptyArchiveTitle}</EmptyTitle>
          <EmptyDescription>
            {t.feed.searchPage.emptyArchiveBody}{" "}
            <Link href="/" className="underline underline-offset-4">
              {t.feed.searchPage.backToFeedLink}
            </Link>
            .
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (!found) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t.feed.searchPage.noQueryTitle}</EmptyTitle>
          <EmptyDescription>
            {/* Настоящее число, а не «по всему архиву»: оно отвечает
                на вопрос, который возникает раньше запроса, — есть ли
                вообще в чём искать. */}
            {t.feed.searchPage.noQueryBody}{" "}
            {t.feed.searchPage.storiesCount(archive.items)} {t.feed.searchPage.over}{" "}
            {t.feed.searchPage.digestsCount(archive.days)}. {t.feed.searchPage.matchExplainer}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (found.hits.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t.feed.searchPage.noResultsTitle}</EmptyTitle>
          <EmptyDescription>
            {t.feed.searchPage.noResultsBody(query)}{" "}
            {t.feed.searchPage.storiesSearchedCount(archive.items)} {t.feed.searchPage.over}{" "}
            {t.feed.searchPage.digestsCount(archive.days)}.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <p className="px-1 pb-2 text-xs text-muted-foreground">
        {t.feed.searchPage.storiesCount(found.hits.length)}
        {/* Ослабленный запрос называется вслух: молча показать выдачу
            по одному слову из четырёх — значит выдать другое за то же
            самое. */}
        {found.loose ? t.feed.searchPage.looseNote : null}
      </p>
      <div className="rounded-xl bg-card px-4 shadow-(--shadow-border) sm:px-6">
        {found.hits.map((hit) => (
          <Hit key={`${hit.day}-${hit.item_id}`} hit={hit} t={t} />
        ))}
      </div>
    </>
  );
}

/**
 * Поиск по тому, что лента уже присылала этому читателю.
 *
 * Обычная форма и обычная ссылка: страница отвечает на адрес с `?q=`,
 * поэтому найденное можно сохранить в закладки и переслать себе же,
 * а работает она до и без всякого javascript.
 */
export default async function SearchPage({
  searchParams,
}: {
  // Повторённый параметр (`?q=a&q=b`) приезжает массивом, и объявить его
  // строкой — значит попросить компилятор промолчать: `trim` на массиве
  // отдаёт 500 вместо выдачи.
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const [reader, { q }, t] = await Promise.all([currentReader(), searchParams, getDict()]);
  const query = ((Array.isArray(q) ? q[0] : q) ?? "").trim();
  const [archive, found] = await Promise.all([
    archiveSize(reader.id),
    query ? searchArchive(reader.id, query) : null,
  ]);

  return (
    <>
      {/* Запрос запоминается здесь, а не в форме: сюда приходят и из поля
          в шапке ленты, и по ссылке, и по своей же подсказке — а писатель
          у истории должен быть один. */}
      <RememberQuery query={query} />
      <PageHeader
        left={
          <div className="flex w-full items-center gap-2">
            <Link
              href="/"
              aria-label={t.feed.searchPage.backToFeedAria}
              className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:size-8"
            >
              <ChevronLeftIcon className="size-5 sm:size-4" />
            </Link>
            {/* Та же форма, что раскрывается в шапке ленты: адрес и имя
                параметра у них общие, иначе поиск, начатый из ленты,
                однажды перестанет доезжать до страницы, которая его
                показывает. */}
            <SearchForm
              defaultValue={query}
              autoFocus
              placeholder={t.feed.searchPage.placeholder}
              label={t.feed.search.label}
              submitLabel={t.feed.search.submit}
              className="flex-1"
            />
          </div>
        }
      />

      <div className="mx-auto w-full max-w-page px-4 py-4 sm:py-6">
        <Results archive={archive} query={query} found={found} t={t} />
      </div>
    </>
  );
}
