/**
 * На каком шаге настройка Kindle.
 *
 * Два шага, и второй нечем проверить снаружи: Amazon не отвечает ни про
 * одобрение отправителя, ни про отказ, а неодобренное письмо исчезает молча.
 * Поэтому «готово» — это подтверждение читателя (`kindle_approved`),
 * а не вывод из других колонок.
 *
 * Функция отдельно от формы, потому что порядок шагов — это правило, а не
 * вёрстка: перепутанные местами условия дали бы экран, на котором просят
 * одобрить отправителя, которого ещё не выдали.
 */
export type KindleStep = "address" | "sender" | "done";

export function kindleSetupStep(reader: {
  kindle_address: string | null;
  kindle_approved: boolean;
}): KindleStep {
  if (reader.kindle_approved) return "done";
  return reader.kindle_address ? "sender" : "address";
}

/**
 * Имя обратного адреса для Kindle: из него собирается `имя@kindle.tomko.io`.
 *
 * Telegram-id, а не username: username читатель меняет в Telegram когда
 * захочет, а адрес после одобрения в Amazon заморожен навсегда. Разъехавшись,
 * они дали бы адрес, который ничего уже не значит, — и менять его нельзя.
 * Telegram-id неизменен и не переиспользуется.
 *
 * Пока Telegram не привязан, имени взять неоткуда, и берётся номер читателя.
 * Он тоже неизменен, поэтому такой адрес не хуже — просто менее узнаваем
 * в списке одобренных отправителей Amazon.
 */
export function kindleSenderName(id: number, telegramId: string | number | null): string {
  const tg = String(telegramId ?? "").trim();
  return /^\d+$/.test(tg) ? tg : `reader${id}`;
}
