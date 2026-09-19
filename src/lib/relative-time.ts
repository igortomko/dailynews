const RTF = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60_000],
  ["hour", 3_600_000],
  ["day", 86_400_000],
];

/**
 * «2 часа назад» вместо «2026-09-19». В ленте важно не когда вышло,
 * а насколько давно: дата требует вычитания в уме, относительное время — нет.
 */
export function relativeTime(value: string | Date): string {
  const then = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(then.getTime())) return "";

  const diff = then.getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return "только что";

  for (const [unit, ms] of STEPS) {
    if (abs < ms * (unit === "day" ? 7 : 60)) {
      return RTF.format(Math.round(diff / ms), unit);
    }
  }
  return then.toLocaleDateString("ru", { day: "numeric", month: "long" });
}
