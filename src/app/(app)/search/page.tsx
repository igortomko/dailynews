import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { archiveSize, searchArchive, type ArchiveHit } from "@/lib/queries";
import { highlight } from "@/lib/search";
import { currentReader } from "@/lib/session";
import { count } from "@/lib/plural";
import { dayInWords, digestsWord } from "@/lib/telegram";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export const dynamic = "force-dynamic";

/**
 * Дата выпуска в выдаче. `dayInWords` намеренно не пишет год — выпуск
 * приходит в день выпуска, — но здесь смысл обратный: ищут как раз то,
 * что было давно, и «19 сентября» без года у прошлогоднего материала
 * выглядит свежим. Год появляется, только когда он не этот: писать его
 * у вчерашнего значит писать его всегда.
 */
function dayLabel(day: string): string {
  const year = day.slice(0, 4);
  const words = dayInWords(day);
  return year === String(new Date().getFullYear()) || words === day
    ? words
    : `${words} ${year}`;
}

function Hit({ hit }: { hit: ArchiveHit }) {
  return (
    <article className="border-b py-4 last:border-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {/* Выпуск, а не только статья: «где я это видел» — вопрос и про
            соседние новости того дня тоже. */}
        <Link href={`/?day=${hit.day}`} className="hover:text-foreground">
          выпуск {dayLabel(hit.day)}
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
    </article>
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
  searchParams: Promise<{ q?: string }>;
}) {
  const [reader, { q }] = await Promise.all([currentReader(), searchParams]);
  const query = (q ?? "").trim();
  const [archive, result] = await Promise.all([
    archiveSize(reader.id),
    query ? searchArchive(reader.id, query) : null,
  ]);

  return (
    <>
      <PageHeader
        left={
          <div className="flex w-full items-center gap-2">
            <Link
              href="/"
              aria-label="К ленте"
              className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:size-8"
            >
              <ChevronLeftIcon className="size-5 sm:size-4" />
            </Link>
            {/* GET, а не действие: адрес с запросом — это и есть состояние
                страницы, и «назад» после поиска возвращает к прошлому
                поиску, а не к пустому полю. */}
            <form action="/search" className="flex-1">
              <Input
                type="search"
                name="q"
                defaultValue={query}
                autoFocus
                enterKeyHint="search"
                placeholder="Например: uranium дата-центры"
                aria-label="Поиск по выпускам"
                className="h-10 sm:h-8"
              />
            </form>
          </div>
        }
      />

      <div className="mx-auto w-full max-w-page px-4 py-4 sm:py-6">
        {archive.items === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Искать пока не в чем</EmptyTitle>
              <EmptyDescription>
                Поиск идёт по твоим выпускам. Первый ещё не приходил —{" "}
                <Link href="/" className="underline underline-offset-4">
                  вернуться в ленту
                </Link>
                .
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : !result ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Ищу по твоим выпускам</EmptyTitle>
              <EmptyDescription>
                {/* Настоящее число, а не «по всему архиву»: оно отвечает
                    на вопрос, который возникает раньше запроса, — есть ли
                    вообще в чём искать. */}
                Это не поиск по интернету: только то, что лента тебе присылала, —{" "}
                {count(archive.items, "материал", "материала", "материалов")} за{" "}
                {archive.days} {digestsWord(archive.days)}. Слова ищутся и в описании
                выпуска, и в исходном заголовке: «уран» и «uranium» найдут одно и то же.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : result.hits.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Ничего не нашлось</EmptyTitle>
              <EmptyDescription>
                По запросу «{query}» в твоих выпусках пусто. Материал, которого лента
                не присылала, здесь не найдётся: искали по{" "}
                {count(archive.items, "материалу", "материалам", "материалам")} за{" "}
                {archive.days} {digestsWord(archive.days)}.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <p className="px-1 pb-2 text-xs text-muted-foreground">
              {count(result.hits.length, "материал", "материала", "материалов")}
              {/* Ослабленный запрос называется вслух: молча показать выдачу
                  по одному слову из четырёх — значит выдать другое за то же
                  самое. */}
              {result.loose ? " — по всем словам разом ничего, это по любому из них" : null}
            </p>
            <div className="rounded-xl bg-card px-4 shadow-(--shadow-border) sm:px-6">
              {result.hits.map((hit) => (
                <Hit key={`${hit.day}-${hit.item_id}`} hit={hit} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
