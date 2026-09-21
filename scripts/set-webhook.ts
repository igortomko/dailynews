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
 *
 * Всё внутри main(): пакет собирается в CJS, и верхнеуровневый await
 * здесь не переживает сборку — падает не проверка, а сам запуск.
 */

/**
 * Ботов два, и вебхук им ставится одним скриптом: отличаются они только
 * именами переменных и адресом. Второй — `npm run postbot:webhook`.
 */
const postbot = process.argv[2] === "postbot";
const names = postbot
  ? {
      token: "POSTBOT_TOKEN", secret: "POSTBOT_WEBHOOK_SECRET", path: "/api/postbot",
      start: "Что можно бросить боту",
    }
  : {
      token: "TELEGRAM_BOT_TOKEN", secret: "TELEGRAM_WEBHOOK_SECRET", path: "/api/telegram",
      start: "Ссылка на ленту",
    };

const token = process.env[names.token]?.trim();
const secret = process.env[names.secret]?.trim();
const appUrl = process.env.APP_URL?.trim();

if (!token || !secret || !appUrl) {
  console.error(
    `Нужны ${names.token}, ${names.secret} и APP_URL.\n` +
    "Секрет — случайная строка; им подписан каждый запрос от Telegram:\n" +
    `  npm run env:set ${names.secret}`,
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

const url = `${appUrl.replace(/\/$/, "")}${names.path}`;

async function main() {
  await api("setWebhook", {
    url,
    secret_token: secret,
    // Только сообщения: остальные типы апдейтов бот всё равно игнорирует,
    // а Telegram не станет их слать и повторять.
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  await api("setMyCommands", { commands: [{ command: "start", description: names.start }] });

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
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
