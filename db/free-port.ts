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

type Pglite = { exec: (sql: string) => Promise<unknown> };
type SocketServer = { start: () => Promise<unknown>; stop: () => Promise<unknown> };

export async function startLocalPg(
  db: Pglite,
  makeServer: (port: number) => SocketServer,
): Promise<LocalPg> {
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
