/**
 * Иллюстрация материала из разметки страницы.
 *
 * Тянется только для выживших — двенадцать запросов вместо трёхсот.
 * Скачивается начало документа: og:image лежит в <head>, и ради него
 * незачем качать страницу целиком.
 */
const UA = "dailynews/2.0 (+https://github.com/igortomko/dailynews)";
const HEAD_BYTES = 120_000;

const PATTERNS = [
  /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
];

export async function fetchOgImage(pageUrl: string, timeoutMs = 12_000): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  try {
    const res = await fetch(pageUrl, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok || !res.headers.get("content-type")?.includes("html")) return null;

    // Читаем по кускам и останавливаемся, как только <head> закончился.
    const reader = res.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let html = "";
    while (html.length < HEAD_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    await reader.cancel().catch(() => {});

    for (const pattern of PATTERNS) {
      const match = html.match(pattern);
      if (!match?.[1]) continue;
      // Адрес бывает относительным и с неразвёрнутыми сущностями.
      const raw = match[1].replace(/&amp;/g, "&").trim();
      try {
        return new URL(raw, parsed.origin).toString();
      } catch {
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Тянет картинки пачкой, по четыре одновременно: издания разные, но щадим. */
export async function enrichImages(
  items: { id: number; url: string }[],
  onFound?: (id: number, image: string) => Promise<void>,
): Promise<number> {
  let found = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      const image = await fetchOgImage(item.url);
      if (image) {
        found++;
        await onFound?.(item.id, image);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  return found;
}
