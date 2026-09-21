/** Apply to rendered text, never to URLs or stored source evidence. */
export function typography(value: string): string {
  return value
    .replace(/(?<![\p{L}\p{N}])([авикосуя]|во|со|на|не|ни|но|за|из|от|до|по|об|ко|же|бы|то|для|при|без|над|под) +(?=\S)/giu, "$1\u00a0")
    .replace(/(\d)[ ]+(?=\d{3}(?:\D|$))/gu, "$1\u00a0")
    .replace(/(\d)[ ]+(?=(?:%|₽|€|\$|км|мин|сек|с|кг|мг|г|млн|тыс|лет|год(?:а)?|час|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?!\p{L}))/giu, "$1\u00a0")
    .replace(/([≈№$€]) +(?=\S)/gu, "$1\u00a0")
    .replace(/(\d)[ ]*[–—-][ ]*(?=\d)/gu, "$1\u2060–\u2060")
    .replace(/(Шаг|Этап) +(\d)/gu, "$1\u00a0$2")
    .replace(/(\d) +(из) +(\d)/gu, "$1\u00a0$2\u00a0$3");
}
export function summaryTime(seconds: number): string {
  const rounded = Math.max(10, Math.ceil(seconds / 10) * 10);
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `≈\u00a0${minutes ? `${minutes}\u00a0мин` : ""}${minutes && rest ? " " : ""}${rest ? `${rest}\u00a0с` : ""}`;
}
