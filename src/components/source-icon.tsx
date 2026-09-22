"use client";

import { useState } from "react";
import { GlobeIcon } from "lucide-react";
import type { Source } from "@/lib/types";

/**
 * Значок и адрес источника — общие для настроек и для первого захода.
 *
 * Жили в экране настроек, пока источники не понадобились в онбординге.
 * Копия разошлась бы молча: favicon чинят в одном месте, а во втором
 * он ещё год показывает глобус.
 */

/**
 * Значок источника: Telegram своим знаком, остальные — своим favicon.
 *
 * Идёт он через наш адрес, а не прямо на чужой домен, и на то две причины.
 * Прямая ссылка на `/favicon.ico` не показывала значок у трети стартового
 * набора: у кого 404, у кого 405, у кого 200 с нулём байт, а у кого
 * бот-защита на кросс-сайтовый `Referer`. И она раздавала читателя —
 * семнадцать строк списка означали семнадцать запросов с его адреса
 * на семнадцать чужих доменов при каждом показе страницы. Подробности
 * и замер — в `src/app/api/favicon/route.ts`.
 *
 * Чужой сервис вроде s2/favicons не годится по той же второй причине:
 * список того, что читает человек, не уезжает третьей стороне ради картинок.
 */
function faviconOf(kind: Source["kind"], url: string): string | null {
  const host =
    kind === "hackernews" ? "news.ycombinator.com"
    : kind === "x" ? "x.com"
    : kind === "reddit" ? "www.reddit.com"
    : kind === "email" ? url.split("@")[1]
    : (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return null;
        }
      })();
  return host ? `/api/favicon?host=${encodeURIComponent(host)}` : null;
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

/**
 * Значок с запасным вариантом: у части сайтов значка не найти вовсе, и наш
 * адрес отвечает на это пустым 204. Для `<img>` пустой ответ — такая же
 * ошибка, как 404, поэтому глобус встаёт сам, без отдельной ветки.
 */
export function SourceIcon({
  kind,
  url,
  className = "size-4",
}: { kind: Source["kind"]; url: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (kind === "telegram") return <TelegramIcon className={className} />;
  const src = faviconOf(kind, url);
  if (!src || failed) return <GlobeIcon className={`${className} text-muted-foreground`} />;
  return (
    // Ленивая загрузка не украшение: промах кэша стоит нашему серверу
    // похода на чужой сайт, а контейнеру дано одно ядро. С lazy платим
    // только за строки, до которых долистали.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      width={16}
      height={16}
      className={`${className} shrink-0 rounded-sm`}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Куда ведёт источник, если по нему щёлкнуть.
 *
 * Адресом фида url бывает не у всех: у Hacker News там листинг, у Telegram —
 * имя канала, у почты — адрес отправителя. Ссылка на «topstories» вела бы
 * в никуда, поэтому адрес собирается по виду источника, а где открывать
 * нечего — ссылки нет вовсе.
 */
export function openUrlOf(source: { kind: Source["kind"]; url: string }): string | null {
  switch (source.kind) {
    case "rss":
      return /^https?:\/\//.test(source.url) ? source.url : null;
    case "hackernews":
      return source.url === "newstories"
        ? "https://news.ycombinator.com/newest"
        : source.url === "beststories"
          ? "https://news.ycombinator.com/best"
          : "https://news.ycombinator.com/";
    case "telegram":
      return `https://t.me/${source.url}`;
    case "reddit":
      return `https://www.reddit.com/r/${source.url}`;
    case "x":
      return `https://x.com/search?q=${encodeURIComponent(source.url)}`;
    // У почты открывать нечего: адрес отправителя — не страница, а щелчок
    // по нему запускал бы почтовую программу, чего никто не просил.
    case "email":
      return null;
  }
}

