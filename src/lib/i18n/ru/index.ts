import type { Dict } from "../en";
import * as shell from "./shell";

/**
 * Русский словарь. Раскладка файл в файл с английским: расходятся они
 * тем тише, чем дольше их не сводить.
 */
export const ru: Dict = {
  nav: shell.nav,
  theme: shell.theme,
  locale: shell.locale,
};
