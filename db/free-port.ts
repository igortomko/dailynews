import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

/**
 * База в процессе, до которой ходят через postgres.js.
 *
 * Порт был прибит числом, и это тихо врало при параллельной работе: две
 * ветки в соседних worktree запускают проверку одновременно, и клиент
 * уходит к чужому серверу. Сверка схемы показывала тогда выдуманные
 * расхождения — «в базе нет ни одной таблицы», — а в обратную сторону
 * было бы хуже: чужая база отвечает «всё на месте», и проверка проходит,
 * ничего не проверив.
 *
 * База помечается меткой, и вызывающий читает её обратно своим же
 * соединением (`assertOwn`). Своим — потому что сокет PGlite обслуживает
 * одно подключение за раз: пробное соединение рядом с рабочим оставляет
 * сервер в состоянии, где запросы возвращают пустоту. Именно так
 * и выглядела чинимая поломка, только по другой причине.
 *
 * Здесь же снимается лишний `ReadyForQuery` — см. `dropStrayReady`.
 */
export type LocalPg = { port: number; token: string; stop: () => Promise<void> };

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** Тег `ReadyForQuery` — «пачка закрыта, можно слать следующий запрос». */
const READY_FOR_QUERY = 0x5a; // 'Z'

/**
 * Сообщения расширенного протокола. Настоящий Postgres отвечает
 * `ReadyForQuery` только на `Sync` и на простой `Query`; на эти — никогда,
 * ни при успехе, ни при ошибке.
 */
const EXTENDED = new Set([..."PBDECHF"].map((tag) => tag.charCodeAt(0)));

/** Разложить ответ на кадры «тег + длина». `null` — разобрать не вышло. */
function frames(response: Buffer): { tag: number; at: number; end: number }[] | null {
  const out: { tag: number; at: number; end: number }[] = [];
  let at = 0;
  while (at < response.length) {
    if (at + 5 > response.length) return null;
    const length = response.readInt32BE(at + 1);
    if (length < 4 || at + 1 + length > response.length) return null;
    out.push({ tag: response[at], at, end: at + 1 + length });
    at += 1 + length;
  }
  return out;
}

/**
 * Убрать `ReadyForQuery` из ответа на сообщение расширенного протокола.
 *
 * Из-за него `npm run verify:db` падала в 16 прогонах из 60 — каждый раз
 * в другом месте и каждый раз правдоподобно: «у владельца 0 тем», «площадки
 * читателя — только его», список из трёх десятков несуществующих расхождений
 * схемы. Ни одно утверждение не было неверным: один запрос закрывался
 * пустым, а каждый следующий получал строки предыдущего.
 *
 * Откуда сдвиг. Отбивая запрос, PGlite отвечает на `Parse` или на `Execute`
 * двумя кадрами: `ErrorResponse` и следом `ReadyForQuery` (снято с живого
 * обмена, `Z` бывает только при ошибке). На `Sync` приходит второй
 * `ReadyForQuery`. Настоящий Postgres шлёт его один раз и только на `Sync`.
 *
 * Лишний `Z` считает postgres.js: в `ReadyForQuery` он закрывает текущий
 * запрос и достаёт следующий из уже отправленных. Первый `Z` честно
 * отбивает запрос, второй закрывает следующий — до того, как пришли его
 * строки, то есть пустым результатом. Дальше ответы едут на один: третий
 * запрос получает строки второго, и так до конца соединения.
 *
 * Отсюда и мерцание: если к приходу лишнего `Z` следующий запрос ещё
 * не отправлен, закрывать нечего и прогон проходит. Отбитых запросов
 * в проверке пять, и каждый бросает кубик.
 *
 * Шов выбран у PGlite, а не у сокет-сервера: `execProtocolRawStream` — это
 * то, чем pglite-socket пользуется снаружи, а разбор сообщений у него
 * приватный и минифицированный. Уедет и этот метод — правка скажет вслух:
 * молча снятая, она вернула бы мерцание, и искать пришлось бы заново.
 * Снять, когда PGlite перестанет слать `Z` на расширенные сообщения;
 * 0.5.8 — версия, на которой это ещё так.
 */
export function dropStrayReady(request: Uint8Array, response: Buffer): Buffer {
  if (request.length === 0 || !EXTENDED.has(request[0])) return response;
  const parsed = frames(response);
  // Ответ, который не разобрался на кадры, не трогаем вовсе: испортить
  // протокол хуже, чем не чинить.
  if (!parsed) return response;
  const keep = parsed.filter((frame) => frame.tag !== READY_FOR_QUERY);
  if (keep.length === parsed.length) return response;
  return Buffer.concat(keep.map((frame) => response.subarray(frame.at, frame.end)));
}

type RawStream = (
  message: Uint8Array,
  options?: { onRawData?: (data: Uint8Array) => void },
) => Promise<unknown>;

/** Поставить правку на живой экземпляр PGlite. Идемпотентно. */
function fixStrayReady(db: object): void {
  const host = db as { execProtocolRawStream?: RawStream; __readyFixed?: boolean };
  if (host.__readyFixed) return;
  if (typeof host.execProtocolRawStream !== "function") {
    throw new Error(
      "PGlite: execProtocolRawStream не найден — правка лишнего ReadyForQuery устарела. " +
        "Без неё db/verify.ts мерцает: после каждого намеренно отбитого запроса " +
        "ответы уезжают на один запрос вперёд.",
    );
  }

  const original = host.execProtocolRawStream.bind(db) as RawStream;
  host.execProtocolRawStream = async (message, options) => {
    // Копия снимается прямо в обработчике: `onRawData` отдаёт вид на память
    // wasm, и к концу запроса там уже лежит чужое. Отложенная копия читается
    // как «кадры пришли в другом порядке» — на этом легко потерять день.
    const chunks: Buffer[] = [];
    const result = await original(message, {
      ...options,
      onRawData: (data) => void chunks.push(Buffer.from(data)),
    });
    const response = dropStrayReady(message, Buffer.concat(chunks));
    if (response.length > 0) options?.onRawData?.(response);
    return result;
  };
  host.__readyFixed = true;
}

type Pglite = { exec: (sql: string) => Promise<unknown> };
type SocketServer = { start: () => Promise<unknown>; stop: () => Promise<unknown> };

export async function startLocalPg(
  db: Pglite,
  makeServer: (port: number) => SocketServer,
): Promise<LocalPg> {
  fixStrayReady(db);

  const token = randomUUID();
  await db.exec(`
    create table if not exists public.pg_owner_token (token text primary key);
    delete from public.pg_owner_token;
    insert into public.pg_owner_token values ('${token}');
  `);

  const tried: number[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await freePort();
    tried.push(port);
    const server = makeServer(port);
    try {
      await server.start();
    } catch {
      continue;
    }
    return { port, token, stop: async () => void (await server.stop().catch(() => {})) };
  }
  throw new Error(`не удалось занять порт, пробовали: ${tried.join(", ")}`);
}

/**
 * Убедиться, что соединение ведёт в свою базу. Вызывается тем же клиентом,
 * которым потом идут все запросы: другого способа проверить нет, а лишнее
 * подключение к сокету PGlite делает хуже, чем отсутствие проверки.
 */
export async function assertOwn(
  local: LocalPg,
  ask: (sql: string) => Promise<{ token?: string } | undefined>,
): Promise<void> {
  const row = await ask("select token from public.pg_owner_token").catch(() => undefined);
  if (row?.token === local.token) return;
  throw new Error(
    `база на порту ${local.port} не наша (метка ${row?.token ?? "не читается"}) — ` +
      "порт занимает проверка из соседнего worktree, запусти ещё раз",
  );
}
