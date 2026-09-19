import postgres from "postgres";

/**
 * Прямое подключение к Postgres, а не supabase-js: продуктовые схемы
 * не экспонируются в PostgREST (правило 6 инфра-документа), поэтому
 * REST-клиент до схемы dailynews всё равно не достаёт.
 *
 * DATABASE_URL — строка пулера. У прямого хоста только IPv6, а ни Vercel,
 * ни раннеры GitHub Actions по нему не ходят.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL не задан");

const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
})();
const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";

export const sql = postgres(url, {
  // Транзакционный пулер не поддерживает prepared statements.
  prepare: false,
  // Сертификат подписан собственным CA Supabase: строгая проверка падает
  // на рукопожатии. Соединение остаётся зашифрованным.
  // Локальный Postgres (разработка, db/verify.ts) TLS не слушает вовсе.
  ssl: isLocal ? false : { rejectUnauthorized: false },
  // У роли connection limit 10 и она общая с пайплайном.
  max: Number(process.env.DB_POOL_MAX ?? 3),
  idle_timeout: 20,
  connect_timeout: 15,
  // Потолок на запрос. Общий пулер иногда не отдаёт соединение сразу,
  // и без потолка страница висит вместо того, чтобы вернуть ошибку.
  connection: { statement_timeout: 15_000 },
});
