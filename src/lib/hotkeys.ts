"use client";

import { useEffect } from "react";

/**
 * Правило «не перехватывать набор текста» одно на все клавиши продукта:
 * вторая его копия рядом с очередной кнопкой разъехалась бы с этой при
 * первой правке любой из них.
 *
 * Модификаторы отсеиваются здесь же: Cmd+K и Ctrl+T принадлежат браузеру
 * и системе, а не ленте.
 */
export function typingOrModified(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target as HTMLElement | null;
  return (
    !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

/**
 * Одна клавиша — одно действие, объявленное там же, где кнопка: подсказка
 * на кнопке обещает клавишу, и обещание с исполнением живут в одном файле.
 *
 * Смотрим на event.code, а не на event.key: в кириллической раскладке та же
 * клавиша отдаёт другую букву, и проверка по букве молча перестаёт работать
 * ровно у того, кто читает ленту по-русски.
 */
export function useHotkey(code: string, run: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== code || typingOrModified(event)) return;
      event.preventDefault();
      run();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [code, run]);
}
