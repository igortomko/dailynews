import { createHash } from "node:crypto";
import { videoIdOf } from "../../pipeline/youtube";

/**
 * Материал, брошенный владельцем боту, — вход для поста помимо выпуска.
 *
 * Четыре вида на один разбор, потому что отличаются они только тем, откуда
 * берётся текст: ссылка читается статьёй, ролик — субтитрами, пересланный
 * пост и своя мысль приходят текстом уже в сообщении. Дальше все четыре
 * ложатся в `items` и идут тем же путём, что новость из выпуска: карточка
 * голоса, два черновика, сверка чисел, отметка взятого.
 *
 * Мысль отличается от остальных одним: источника у неё нет, и проверять
 * числа не с чем. Поэтому она уходит в промпт как есть — материалом
 * становится сам текст владельца, а не чужой.
 */
export type Drop =
  | { kind: "link"; url: string; note: string }
  | { kind: "video"; url: string; note: string }
  | { kind: "post"; text: string }
  | { kind: "thought"; text: string };

const URL_RE = /https?:\/\/\S+/;

/**
 * Что прислали. Чистая функция: решение принимается по тексту и признаку
 * пересылки, без единого запроса наружу — иначе разбор нельзя проверить
 * без сети, а ломается он молча.
 *
 * Ссылка внутри длинного текста не делает сообщение ссылкой: владелец,
 * приславший абзац мысли со ссылкой в середине, хочет пост про мысль.
 * Поэтому адрес должен занимать сообщение целиком или стоять первым,
 * а остаток короче трёхсот знаков становится его пометкой — «а вот это
 * важно», «посмотри второй абзац».
 */
export function classifyDrop(text: string, forwarded: boolean): Drop | null {
  const body = text.trim();
  if (!body) return null;
  if (forwarded) return { kind: "post", text: body };

  const match = body.match(URL_RE);
  const url = match?.[0]?.replace(/[)\].,;]+$/, "");
  const leading = url !== undefined && body.indexOf(url) === 0;
  const note = url ? body.slice(body.indexOf(url) + url.length).trim() : "";
  if (url && leading && note.length <= 300) {
    return videoIdOf(url) ? { kind: "video", url, note } : { kind: "link", url, note };
  }
  return { kind: "thought", text: body };
}

/** Заголовок мысли — её первая фраза: другого у неё нет. */
export function titleOf(text: string): string {
  const first = text.split(/\n|(?<=[.!?…])\s/)[0]?.trim() ?? text;
  return (first.length > 120 ? `${first.slice(0, 119)}…` : first) || "Без заголовка";
}

/**
 * Адрес для того, у чего адреса нет. Хеш по тексту, а не время: дважды
 * брошенная мысль должна попасть в тот же материал, иначе черновики
 * по ней разойдутся по двум строкам и сигнал о вкусе разъедется.
 */
export const syntheticUrl = (kind: string, text: string) =>
  `drop://${kind}/${createHash("sha1").update(text).digest("hex").slice(0, 16)}`;
