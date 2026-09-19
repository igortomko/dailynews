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
