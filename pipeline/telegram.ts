const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type Headline = { title: string; topic: string };

/**
 * Telegram здесь — уведомление, а не место чтения. Заголовки без ссылок
 * на источники: открытие материала должно происходить в вебе, иначе
 * калибровке неоткуда узнать, что было прочитано, а что пролистано.
 */
export async function notify(
  day: string,
  intro: string,
  headlines: Headline[],
  appUrl: string,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("  Telegram не настроен, уведомление пропущено");
    return;
  }

  const byTopic = new Map<string, string[]>();
  for (const h of headlines) {
    byTopic.set(h.topic, [...(byTopic.get(h.topic) ?? []), h.title]);
  }

  const body = [...byTopic.entries()]
    .map(([topic, titles]) =>
      [`<b>${escapeHtml(topic)}</b>`, ...titles.map((t) => `· ${escapeHtml(t)}`)].join("\n"),
    )
    .join("\n\n");

  const text = [
    `<b>Дайджест за ${escapeHtml(day)}</b> — ${headlines.length} материалов`,
    intro ? escapeHtml(intro) : "",
    body,
    `<a href="${escapeHtml(appUrl)}">Читать</a>`,
  ].filter(Boolean).join("\n\n").slice(0, 4000);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
