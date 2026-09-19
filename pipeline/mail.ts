/**
 * Выделенный почтовый ящик как источник: одно письмо — один материал.
 *
 * Рассылки приходят почтой и больше никуда: у половины из них нет ни RSS,
 * ни веб-версии. Ящик опрашивается по IMAP в том же ночном прогоне —
 * входящего эндпоинта не заводится, на общей машине лишнего наружу быть
 * не должно.
 *
 * Клиент написан руками и нарочно узкий: LOGIN, SELECT, UID SEARCH, UID FETCH.
 * Готовые imapflow и mailparser тянут шестнадцать пакетов, включая логгер
 * и клиент SOCKS, — многовато для персональной читалки на общей машине.
 * ponytail: ограничения здесь честные — ни IDLE, ни OAuth, ни вложений;
 * появится нужда в них — проще взять библиотеку, чем достраивать это.
 *
 * Из письма не подгружается ничего. Текст получается разбором того, что уже
 * пришло, а разметка чистится вместе с адресами: трекинговый пиксель —
 * это <img src>, и до него дело не доходит вовсе.
 */
import { connect } from "node:tls";
import { stripHtml } from "./fetch";

export type Letter = {
  /** Глобально уникален по RFC — на нём держится дедуп. */
  messageId: string;
  from: string;
  subject: string;
  date: Date | null;
  text: string;
  /** Веб-версия письма, если она объявлена или найдена в тексте. */
  link: string | null;
};

// --- разбор письма ---------------------------------------------------------

/**
 * Заголовки письма. Длинные переносятся с отступом — «развернуть» их надо
 * до всякого разбора, иначе Message-ID, разорванный по строкам, перестаёт
 * совпадать сам с собой, и одно письмо приезжает в ленту каждый день заново.
 */
export function parseHeaders(raw: string): Map<string, string> {
  const end = raw.search(/\r?\n\r?\n/);
  const head = (end === -1 ? raw : raw.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
  const headers = new Map<string, string>();
  for (const line of head.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    // Первое вхождение: Received и подобные повторяются, а нужные — нет.
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
  }
  return headers;
}

function decodeBytes(bytes: string, charset: string): string {
  try {
    return new TextDecoder(charset).decode(Buffer.from(bytes, "latin1"));
  } catch {
    return Buffer.from(bytes, "latin1").toString("utf8");
  }
}

const unQp = (text: string) =>
  text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

const unBase64 = (text: string) =>
  Buffer.from(text.replace(/\s+/g, ""), "base64").toString("latin1");

/**
 * Заголовки с не-ASCII приходят закодированными (RFC 2047). Без разбора
 * тема письма доезжает до дайджеста как «=?UTF-8?B?0J...?=» — заголовок,
 * который выглядит как поломка, но ею не является.
 */
export function decodeWords(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_, charset: string, kind: string, text: string) => {
      const bytes = kind.toLowerCase() === "b" ? unBase64(text) : unQp(text.replace(/_/g, " "));
      return decodeBytes(bytes, charset.toLowerCase());
    },
  );
}

function decodePart(body: string, encoding: string, charset: string): string {
  const raw =
    encoding === "base64" ? unBase64(body)
    : encoding === "quoted-printable" ? unQp(body)
    : body;
  return decodeBytes(raw, charset);
}

const paramOf = (header: string, name: string): string =>
  header.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*([^;\\s]+)`, "i"))
    ?.slice(1)
    .find(Boolean) ?? "";

/**
 * Текст письма. Простой текст предпочитается разметке: он уже написан
 * для чтения, а из HTML приходится вырезать колонтитулы, кнопки и пиксели.
 */
export function textOf(raw: string, depth = 0): { text: string; link: string | null } {
  if (depth > 6) return { text: "", link: null };

  const headers = parseHeaders(raw);
  const split = raw.search(/\r?\n\r?\n/);
  const body = split === -1 ? "" : raw.slice(raw.indexOf("\n", split) + 1);
  const type = (headers.get("content-type") ?? "text/plain").toLowerCase();
  const encoding = (headers.get("content-transfer-encoding") ?? "").trim().toLowerCase();
  const charset = paramOf(type, "charset").toLowerCase() || "utf-8";

  if (type.startsWith("multipart/")) {
    const boundary = paramOf(headers.get("content-type") ?? "", "boundary");
    if (!boundary) return { text: "", link: null };
    const parts = body.split(`--${boundary}`).slice(1, -1);
    const read = parts.map((part) => textOf(part.replace(/^\r?\n/, ""), depth + 1));
    // Простой текст выигрывает у разметки, даже если лежит вторым:
    // multipart/alternative кладёт его первым, но не всякий отправитель
    // соблюдает порядок.
    const plain = read.find((part) => part.text && !part.link);
    const any = read.find((part) => part.text);
    const withLink = read.find((part) => part.link);
    const chosen = plain ?? any;
    return { text: chosen?.text ?? "", link: chosen?.link ?? withLink?.link ?? null };
  }

  const decoded = decodePart(body, encoding, charset);

  if (type.startsWith("text/html")) {
    // Ссылка берётся из <a href> и только из него: трекинговый пиксель —
    // это <img src>, и он не должен попасть даже в поле адреса, не то что
    // быть запрошенным.
    const link = decoded.match(/<a\s[^>]*href\s*=\s*["']?(https?:\/\/[^"'>\s]+)/i)?.[1] ?? null;
    const text = stripHtml(
      decoded.replace(/<\/(p|div|tr|h[1-6])>/gi, "\n").replace(/<br\s*\/?>/gi, "\n"),
    );
    return { text, link };
  }

  if (type.startsWith("text/")) {
    return { text: decoded, link: null };
  }

  // Вложения и всё прочее: материалом они не являются.
  return { text: "", link: null };
}

/**
 * Письмо целиком.
 *
 * `raw` — байты письма, прочитанные как latin1: так их отдаёт сокет, и так
 * один символ равен одному байту. Прочитанное как utf8 письмо декодируется
 * дважды, и кириллица рассыпается — а выглядит это как письмо с кракозябрами,
 * то есть как чужая проблема.
 */
export function parseLetter(raw: string): Letter {
  const headers = parseHeaders(raw);
  const { text, link } = textOf(raw);
  const when = headers.get("date") ? new Date(headers.get("date")!) : null;

  // Веб-версия письма: сначала то, что отправитель объявил сам (RFC 5064
  // и 2369), и только потом первая ссылка из текста.
  const archived =
    headers.get("archived-at")?.match(/https?:\/\/[^>\s]+/)?.[0] ??
    headers.get("list-archive")?.match(/https?:\/\/[^>\s]+/)?.[0] ??
    null;

  return {
    messageId: (headers.get("message-id") ?? "").replace(/^<|>$/g, "").trim(),
    from: decodeWords(headers.get("from") ?? ""),
    subject: decodeWords(headers.get("subject") ?? "").replace(/\s+/g, " ").trim(),
    date: when && !Number.isNaN(when.getTime()) ? when : null,
    text: text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(),
    link: archived ?? link ?? text.match(/https?:\/\/[^\s<>"]+/)?.[0] ?? null,
  };
}

/** Адрес из поля From: «Имя <a@b.c>» → «a@b.c». */
export const addressOf = (from: string): string =>
  (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();

// --- IMAP ------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Дата в том виде, в каком её понимает SEARCH SINCE. */
export const imapDate = (date: Date): string =>
  `${date.getUTCDate()}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;

/**
 * Где в буфере заканчивается ответ на команду с этим тегом.
 *
 * Считать по строке «тег OK» нельзя: письмо приходит литералом — сервер
 * объявляет `{12345}` и льёт ровно столько байт, среди которых строка
 * «a3 OK» встречается как обычный текст. Ответ обрывался бы на середине
 * письма, и выглядело бы это как короткое письмо, а не как ошибка.
 */
export function responseEnd(buffer: string, tag: string): number {
  let at = 0;
  while (at < buffer.length) {
    const eol = buffer.indexOf("\r\n", at);
    if (eol === -1) return -1;
    const line = buffer.slice(at, eol);
    at = eol + 2;

    const literal = line.match(/\{(\d+)\}$/);
    if (literal) {
      at += Number(literal[1]);
      if (at > buffer.length) return -1;
      continue;
    }
    if (line.startsWith(`${tag} `)) return at;
  }
  return -1;
}

/**
 * Письма из ответа на FETCH.
 *
 * Резать надо по объявленной длине литерала, а не по виду границы: в теле
 * письма встречается что угодно, включая строки, неотличимые от служебных.
 */
export function lettersFrom(response: string): Letter[] {
  const letters: Letter[] = [];
  for (const mark of response.matchAll(/\{(\d+)\}\r\n/g)) {
    const start = (mark.index ?? 0) + mark[0].length;
    const raw = response.slice(start, start + Number(mark[1]));
    const letter = parseLetter(raw);
    // Без Message-ID дедупить нечем, без текста оценивать нечего.
    if (letter.messageId && letter.text) letters.push(letter);
  }
  return letters;
}

type Session = {
  send: (command: string) => Promise<string>;
  close: () => void;
};

function openSession(url: URL, timeoutMs: number): Promise<Session> {
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: url.hostname,
      port: Number(url.port) || 993,
      servername: url.hostname,
    });
    socket.setTimeout(timeoutMs);

    let buffer = "";
    let counter = 0;
    let waiting: { tag: string; settle: (response: string) => void; fail: (e: Error) => void } | null = null;
    let ready = false;

    const abort = (error: Error) => {
      const pending = waiting;
      waiting = null;
      socket.destroy();
      pending?.fail(error);
      if (!ready) reject(error);
    };

    socket.on("error", abort);
    socket.on("timeout", () => abort(new Error("ящик не ответил за отведённое время")));
    socket.on("close", () => {
      if (waiting) abort(new Error("ящик закрыл соединение"));
    });

    const send = (command: string): Promise<string> =>
      new Promise((ok, no) => {
        if (waiting) return no(new Error("команды идут по одной"));
        const tag = `d${++counter}`;
        waiting = { tag, settle: ok, fail: no };
        socket.write(`${tag} ${command}\r\n`);
        drain();
      });

    const drain = () => {
      if (!waiting) return;
      const end = responseEnd(buffer, waiting.tag);
      if (end === -1) return;
      const response = buffer.slice(0, end);
      buffer = buffer.slice(end);
      const pending = waiting;
      waiting = null;
      const status = response.slice(response.lastIndexOf(`${pending.tag} `) + pending.tag.length + 1);
      if (/^OK\b/i.test(status)) pending.settle(response);
      // Пароль в тексте ошибки не печатается: сервер его и не возвращает,
      // но ответ на LOGIN целиком туда попасть может.
      else pending.fail(new Error(status.split("\r\n")[0].slice(0, 200)));
    };

    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      if (!ready) {
        const eol = buffer.indexOf("\r\n");
        if (eol === -1) return;
        const greeting = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        ready = true;
        if (!/^\* (OK|PREAUTH)/.test(greeting)) {
          return abort(new Error(greeting.slice(0, 200) || "ящик не поздоровался"));
        }
        resolve({ send, close: () => socket.destroy() });
      }
      drain();
    });
  });
}

const quote = (value: string) => `"${value.replace(/([\\"])/g, "\\$1")}"`;

export type MailboxConfig = { url: string; folder?: string };

/**
 * Письма от одного отправителя за окно свежести.
 *
 * Отбирает сервер, а не мы: вытягивать весь ящик, чтобы выбросить из него
 * почти всё, — это трафик и время на каждый источник в каждом прогоне.
 */
export async function fetchLetters(
  config: MailboxConfig,
  from: string,
  sinceDays: number,
  limit: number,
  timeoutMs = 30_000,
): Promise<Letter[]> {
  const url = new URL(config.url);
  if (url.protocol !== "imaps:") {
    throw new Error("адрес ящика должен начинаться с imaps:// — открытый IMAP не поддерживается");
  }
  if (!url.username || !url.password) throw new Error("в адресе ящика нет имени или пароля");

  const session = await openSession(url, timeoutMs);
  try {
    await session.send(
      `LOGIN ${quote(decodeURIComponent(url.username))} ${quote(decodeURIComponent(url.password))}`,
    );
    await session.send(`SELECT ${quote(config.folder ?? "INBOX")}`);

    const since = imapDate(new Date(Date.now() - sinceDays * 86_400_000));
    const found = await session.send(`UID SEARCH FROM ${quote(from)} SINCE ${since}`);
    const uids = (found.match(/^\* SEARCH([^\r\n]*)/m)?.[1] ?? "")
      .trim()
      .split(/\s+/)
      .filter((value) => /^\d+$/.test(value));
    if (uids.length === 0) return [];

    // Свежие, а не первые попавшиеся: UID растут со временем.
    const wanted = uids.slice(-limit);
    // BODY.PEEK, а не BODY: обычный FETCH ставит письму \Seen, и ящик,
    // который читает ещё и человек, молча помечается прочитанным.
    const fetched = await session.send(`UID FETCH ${wanted.join(",")} (BODY.PEEK[])`);

    return lettersFrom(fetched);
  } finally {
    session.close();
  }
}
