import { createRequire } from "node:module";
const t0 = Date.now();
const mark = (s: string) => console.log(`[${String(Date.now() - t0).padStart(5)} мс] ${s}`);
async function main() {
  const require_ = createRequire(import.meta.url);
  const Module = require_("node:module") as any;
  const stub = require_.resolve("server-only").replace(/index\.js$/, "empty.js");
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (r: string, ...rest: unknown[]) {
    return r === "server-only" ? stub : resolve.call(this, r, ...rest);
  };
  const { sql } = await import("../src/lib/db");
  const q = await import("../src/lib/queries");
  mark("модули загружены");

  const [meta] = await sql<{ who: string }[]>`select current_user as who`;
  mark(`сырой запрос: ${meta.who}`);

  const wrap = <T>(name: string, p: Promise<T>) =>
    p.then((r) => { mark(`${name}: готово`); return r; })
     .catch((e) => { mark(`${name}: ОШИБКА ${String(e).slice(0, 80)}`); throw e; });

  await Promise.all([
    wrap("getProfile", q.getProfile()),
    wrap("getTopics", q.getTopics()),
    wrap("getSources", q.getSources()),
    wrap("getFeed", q.getFeed()),
  ]);
  mark("Promise.all завершён");
  await sql.end({ timeout: 3 });
  mark("соединения закрыты");
}
main().catch((e) => mark(`ПАДЕНИЕ: ${String(e).slice(0, 160)}`));
