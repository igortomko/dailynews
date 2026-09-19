/**
 * Разбор ссылки живым запросом из командной строки — ровно тем же кодом,
 * которым пользуется форма добавления источника. Каталог из непроверенных
 * адресов превращается в пустую вкладку через неделю.
 *
 *   npx tsx pipeline/check-sources.ts <ссылка> [ссылка...]
 */
import { discover } from "./discover";

if (process.argv[2]) {
  (async () => {
    for (const input of process.argv.slice(2)) {
      const result = await discover(input);
      if (!result.ok) {
        console.log(`FAIL  ${input}\n      ${result.error}\n`);
        continue;
      }
      const { kind, url, label, entries, fresh, sample, via } = result.found;
      console.log(
        `OK    ${input}\n` +
        `      ${kind} · ${via} · свежих ${fresh} из ${entries}\n` +
        `      ${url}\n` +
        `      ${label} — ${sample.slice(0, 70)}\n`,
      );
    }
  })();
}
