"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { HISTORY_KEY, recentFrom, remember } from "@/lib/search-history";

/**
 * Недавние запросы — в браузере, а не в базе.
 *
 * История поиска была бы первым по-настоящему личным, что мы завели бы
 * на сервере: не что человеку прислали, а что он искал. Ради пяти строк,
 * полезных в одном браузере, это плохой размен — и в общей базе тем более.
 *
 * Пишет их одно место: страница результатов при открытии. Форма из шапки
 * ведёт туда же, поэтому второй писатель разошёлся бы с первым ровно тогда,
 * когда запрос пришёл ссылкой, а не из поля.
 */
function read(): string[] {
  try {
    return recentFrom(localStorage.getItem(HISTORY_KEY));
  } catch {
    // Приватное окно, запрещённые данные сайта, чужая строка в ключе —
    // истории просто нет. Искать можно и без неё, ронять страницу не за что.
    return [];
  }
}

/**
 * Разобранный список и строка, из которой он получен.
 *
 * Кэш обязателен, а не ускорение: React сравнивает снимок по ссылке
 * и зациклится на новом массиве при каждом опросе. Обновляется он тогда,
 * когда меняется сама строка в хранилище.
 */
let cachedRaw: string | null | undefined;
let cachedList: string[] = [];

function snapshot(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(HISTORY_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = recentFrom(raw);
  }
  return cachedList;
}

/** Событие storage приходит от соседней вкладки: там тоже ищут. */
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Ничего не рисует: запоминает запрос, с которым открыли выдачу. */
export function RememberQuery({ query }: { query: string }) {
  useEffect(() => {
    if (!query.trim()) return;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(remember(read(), query)));
    } catch {
      // см. read(): негде — значит негде.
    }
  }, [query]);

  return null;
}

/**
 * Полоса под раскрытым полем — на месте вкладок ленты.
 *
 * Недавнее, а не частые слова темы или архива: подсказка должна экономить
 * набор, а не изображать осведомлённость. Частое слово ленты — «модель»
 * или «данные», и нажатие на него даёт сорок материалов, то есть ничего;
 * а к своему прошлому запросу возвращаются на самом деле.
 *
 * Пустая история не закрывается ничем: место остаётся пустым. Объяснение,
 * где именно идёт поиск, стояло здесь и читалось инструкцией к полю, в
 * которое уже целятся пальцем, — а прочитав его однажды, второй раз
 * человек его не читает вовсе.
 */
export function SearchHints() {
  // localStorage нет на сервере, и читать его в рендере — значит разойтись
  // с разметкой, приехавшей оттуда. Снимок с сервера — null: сначала пустое
  // место нужной высоты, содержимое — после появления в браузере. Иначе
  // лента подпрыгивает ровно в тот момент, когда в неё целятся пальцем.
  const recent = useSyncExternalStore<string[] | null>(subscribe, snapshot, () => null);

  // Высота держится и пустой: вкладки ленты занимают столько же, и без неё
  // страница подпрыгивает от одного нажатия на лупу.
  if (recent === null || recent.length === 0) return <div className="h-9" />;

  return (
    <div className="mx-auto flex h-9 max-w-page items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span className="shrink-0 text-xs text-muted-foreground/70">недавнее</span>
      {recent.map((query) => (
        <Link
          key={query}
          href={`/search?q=${encodeURIComponent(query)}`}
          className="shrink-0 rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {query}
        </Link>
      ))}
    </div>
  );
}
