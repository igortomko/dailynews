"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";

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
const KEY = "reporta:searches";
const MAX = 5;

function read(): string[] {
  try {
    return recentFrom(localStorage.getItem(KEY));
  } catch {
    // Приватное окно, запрещённые данные сайта, чужая строка в ключе —
    // истории просто нет. Искать можно и без неё, ронять страницу не за что.
    return [];
  }
}

/**
 * Что лежит в хранилище, знает не наш код: ключ переживает наши правки,
 * его пишет соседняя вкладка другой версии и правит кто угодно из консоли.
 * Поэтому разбор ничего не обещает и на любую неожиданность отвечает
 * пустой историей, а не исключением посреди отрисовки шапки.
 */
export function recentFrom(raw: string | null): string[] {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((item): item is string => typeof item === "string").slice(0, MAX);
  } catch {
    return [];
  }
}

/**
 * Список после нового запроса: свежий первым, повтор не удваивается,
 * длина не растёт.
 *
 * Регистр не считается различием: «Uranium» следом за «uranium» — это один
 * и тот же поиск, и две подсказки вместо одной съедают место, ничего
 * не добавляя.
 */
export function remember(list: string[], query: string): string[] {
  const text = query.trim();
  if (!text) return list;
  const rest = list.filter((old) => old.toLowerCase() !== text.toLowerCase());
  return [text, ...rest].slice(0, MAX);
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
    raw = localStorage.getItem(KEY);
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
      localStorage.setItem(KEY, JSON.stringify(remember(read(), query)));
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
 * Пустая история закрывается не кнопками, а знанием: строка говорит, где
 * именно идёт поиск. Это единственное место, где такое можно сказать
 * вовремя — потом человек уже набирает.
 */
export function SearchHints() {
  // localStorage нет на сервере, и читать его в рендере — значит разойтись
  // с разметкой, приехавшей оттуда. Снимок с сервера — null: сначала пустое
  // место нужной высоты, содержимое — после появления в браузере. Иначе
  // лента подпрыгивает ровно в тот момент, когда в неё целятся пальцем.
  const recent = useSyncExternalStore<string[] | null>(subscribe, snapshot, () => null);

  if (recent === null) return <div className="h-9" />;

  if (recent.length === 0) {
    return (
      <p className="mx-auto flex h-9 max-w-page items-center px-4 text-xs text-muted-foreground">
        Ищу по твоим прошлым выпускам: по описаниям и по заголовкам источников —
        «уран» и «uranium» найдут одно и то же.
      </p>
    );
  }

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
