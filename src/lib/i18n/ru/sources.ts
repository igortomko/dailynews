import type { sources as En } from "../en/sources";
import { count } from "@/lib/plural";

/**
 * Русский словарь области «sources». Текст перенесён дословно из старого
 * кода manager.tsx, source-health.ts и sources.ts — числа и склонения
 * остаются ровно такими, какими были до словаря.
 */
export const sources: typeof En = {
  health: {
    added: "добавлен, первые новости придут ночью",
    noNews: "за 30 дней ни одной новости",
    notInDigest: "за 30 дней ни одна новость не дошла до выпуска",
    summary: (items: number, inDigests: number) =>
      `за 30 дней: ${items} → ${inDigests} в выпусках`,
    opened: (n: number) => `открыто ${n}`,
    score: (value: number) => `оценка ${String(value).replace(".", ",")}`,
    duplicatesPercent: (percent: number) => `повторов ${percent}%`,
  },
  banners: {
    errorTitle: (n: number) => `Источники с ошибкой: ${n}`,
    quietTitle: (n: number) => `Отвечают, но молчат: ${n}`,
    andMore: (n: number) => `и ещё ${n}`,
    quietDays: (n: number) => `${n} дн.`,
    quietExplain: (days: number) =>
      `источник жив и отвечает, но ${count(days, "день", "дня", "дней")} подряд не даёт ни одного свежего материала. Обычно это значит, что его забросили.`,
  },
  addForm: {
    title: "Добавить источник",
    linkLabel: "Ссылка на источник",
    placeholder: "https://www.youtube.com/@канал",
    hint: "Вставь ссылку на сайт, блог, канал на YouTube или в Telegram",
    checking: "Проверяю…",
    add: "Добавить",
  },
  found: {
    nameLabel: "Название источника",
    stats: (via: string, fresh: number, entries: number) =>
      `${via} · свежих ${fresh} из ${entries}`,
    lastEntry: (sample: string) => `последняя запись: ${sample}`,
    stale: "Новости есть, но все старые. Похоже, источник забросили.",
    add: "Добавить",
    cancel: "Отмена",
  },
  paywall: {
    xTitle: (planLabel: string) => `Посты из X только на тарифе «${planLabel}»`,
    xBody: (label: string) =>
      `Нашли: ${label}. X берёт деньги за доступ к постам, поэтому они только на Pro.`,
  },
  cleanup: {
    title: "Что убрать",
    description: "Эти источники месяц занимали место зря.",
    remove: "Убрать",
    removeAria: (label: string) => `Убрать ${label} из ленты`,
    itemsPerMonth: (n: number) => `${count(n, "новость", "новости", "новостей")} за месяц`,
    shownOpened: (shown: number, opened: number) => `${shown} показано, ${opened} открыто`,
    mostlyDuplicates: (n: number) => `из них ${count(n, "повтор", "повтора", "повторов")}`,
  },
  list: {
    title: "Источники",
    count: (used: number, max: number, planLabel: string) =>
      `${used} из ${max} на тарифе «${planLabel}»`,
    emptyTitle: "Пока ни одного источника",
    emptyDescription:
      "Вставь ссылку выше: на блог, канал или рассылку. Пока источников нет, выпуск собирать не из чего.",
    removeAria: (label: string) => `Убрать ${label} из ленты`,
    removeTooltip: "Убрать из ленты, отменить можно",
    error: "ошибка",
    quietBadge: (n: number) => `молчит ${n} дн.`,
    quietTooltip: (days: number) =>
      `Отвечает, но ${count(days, "день", "дня", "дней")} подряд не даёт ничего свежего`,
    lastCountAria: (n: number) => `Прошлой ночью отсюда пришло новостей: ${n}`,
    lastCountTooltip: (yieldText: string) => `Пришло прошлой ночью · ${yieldText}`,
  },
  toast: {
    removed: (label: string) => `${label} убран из ленты`,
    undo: "Отменить",
    added: "Источник добавлен",
    alreadyAdded: "Этот источник уже был в списке",
  },
  tooManySources: (planLabel: string, max: number) =>
    `Тариф «${planLabel}» опрашивает ${max} источников — убери лишний`,
  emptyLink: "Пустая строка",
};
