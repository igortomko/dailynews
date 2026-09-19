/**
 * Поставить вебхук бота и убедиться, что он стоит.
 *
 *   npm run bot:webhook
 *
 * Запускать после первого развёртывания и после любой смены домена или
 * секрета. Незаданный вебхук — самый тихий отказ из возможных: сайт
 * открывается, прогон идёт, выпуски приходят, и только /start остаётся
 * без ответа, о чём никто не узнает, пока не напишет боту сам.
 *
 * Поллинга здесь нет и не будет: отдельный постоянный процесс на общей
 * машине заводить нельзя, а два процесса с одним токеном отбирают апдейты
 * друг у друга.
 */
export {};

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const appUrl = process.env.APP_URL?.trim();

if (!token || !secret || !appUrl) {
  console.error(
    "Нужны TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET и APP_URL.\n" +
    "Секрет — случайная строка; им подписан каждый запрос от Telegram:\n" +
    "  npm run env:set TELEGRAM_WEBHOOK_SECRET",
  );
  process.exit(1);
}

const api = async (method: string, body?: object) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await res.json();
  if (!payload.ok) throw new Error(`${method}: ${payload.description ?? res.status}`);
  return payload.result;
};

const url = `${appUrl.replace(/\/$/, "")}/api/telegram`;

await api("setWebhook", {
  url,
  secret_token: secret,
  // Только сообщения: остальные типы апдейтов бот всё равно игнорирует,
  // а Telegram не станет их слать и повторять.
  allowed_updates: ["message"],
  drop_pending_updates: true,
});
await api("setMyCommands", { commands: [{ command: "start", description: "Ссылка на ленту" }] });

// Спрашиваем, а не верим ответу на установку: сверять надо то, что стоит.
const info = await api("getWebhookInfo") as {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
};
if (info.url !== url) {
  console.error(`! стоит ${info.url || "ничего"}, ожидался ${url}`);
  process.exit(1);
}
console.log(`вебхук: ${info.url}`);
console.log(`в очереди: ${info.pending_update_count}`);
if (info.last_error_message) console.log(`последняя ошибка: ${info.last_error_message}`);
