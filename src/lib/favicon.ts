/**
 * Адрес значка, объявленного самой страницей.
 *
 * Разбор чужой разметки, поэтому чистой функцией и с проверкой в `npm test`:
 * сломается она при смене разметки молча, как разбор t.me и timedtext.
 *
 * Берётся `<link rel="icon">` и его родня. Порядок предпочтения — по тому,
 * что вырастет в значок 16×16 лучше: svg не мылится ни на каком экране,
 * дальше самый крупный растровый, и только потом всё остальное. Размер
 * читается из `sizes`, а не угадывается по имени файла.
 */

/** Что считается объявлением значка. `mask-icon` — силуэт Safari, не значок. */
const ICON_RELS = new Set(["icon", "shortcut icon", "apple-touch-icon", "apple-touch-icon-precomposed"]);

/** Больше этого куска разметки не читаем: объявление живёт в `<head>`. */
const HEAD_CHARS = 200_000;

type Candidate = { href: string; score: number };

/** `sizes="32x32 64x64"` → 64. Нет размера — ноль, а не догадка. */
function sizeOf(value: string | null): number {
  if (!value) return 0;
  if (value.toLowerCase() === "any") return 1024;
  return Math.max(
    0,
    ...value.split(/\s+/).map((one) => Number.parseInt(one.split(/[xх×]/i)[0], 10) || 0),
  );
}

const attr = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? match[4] ?? "").trim() : null;
};

export function iconHref(html: string, base: string): string | null {
  const head = html.slice(0, HEAD_CHARS);
  const candidates: Candidate[] = [];

  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attr(tag, "rel")?.toLowerCase();
    const href = attr(tag, "href");
    if (!rel || !href || !ICON_RELS.has(rel)) continue;
    const type = attr(tag, "type")?.toLowerCase() ?? "";
    // svg вне конкурса: он один остаётся резким и на 16, и на 64 пикселях.
    const score = type.includes("svg") || /\.svg(\?|$)/i.test(href)
      ? 2048
      : sizeOf(attr(tag, "sizes"));
    try {
      candidates.push({ href: new URL(href, base).toString(), score });
    } catch {
      // Кривой адрес в чужой разметке — обычное дело, и ронять из-за него
      // весь разбор значит терять значок там, где второе объявление годное.
    }
  }

  if (candidates.length === 0) return null;
  // Стабильно: при равном счёте побеждает объявленный раньше — так решил
  // сам сайт, и спорить с ним нам нечем.
  return candidates.reduce((best, one) => (one.score > best.score ? one : best)).href;
}

/**
 * Публичный ли это сайт. Хост приходит из запроса, поэтому проверяется он,
 * а не наши намерения: без этого адрес значка становится чужими руками
 * внутри нашей сети — `?host=localhost:3000` или адрес пулера базы.
 *
 * Тем же правилом проверяется каждый переход по редиректу, а не только
 * первый адрес: публичный сайт одним `302` уводил бы наш сервер туда же.
 *
 * ponytail: имя, которое резолвится в приватный адрес, здесь не ловится —
 * для этого нужен свой резолвер в агенте. Потолок осознанный: вход закрыт
 * сессией, наружу уходит только то, что оказалось картинкой не больше
 * 256 КБ. Понадобится строже — ставить проверку на резолве, а не дописывать
 * сюда условия.
 */
export function publicHost(host: string): boolean {
  if (!host || host.length > 253 || /[^a-z0-9.\-:]/i.test(host)) return false;
  const name = host.split(":")[0].toLowerCase();
  if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".internal")) return false;
  // Голый адрес вместо имени: у настоящего сайта есть имя, а IP в параметре
  // означает попытку дотянуться до соседа по сети.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.includes("[")) return false;
  return name.includes(".");
}
