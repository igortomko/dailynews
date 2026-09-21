import type { Dict } from "../en";
import * as shell from "./shell";
import { errors } from "./errors";
import { feed } from "./feed";
import { settings } from "./settings";
import { sources } from "./sources";
import { plans } from "./plans";
import { onboarding } from "./onboarding";
import { rules } from "./rules";

/**
 * Русский словарь. Раскладка файл в файл с английским: расходятся они
 * тем тише, чем дольше их не сводить.
 */
export const ru: Dict = {
  nav: shell.nav,
  theme: shell.theme,
  locale: shell.locale,
  errors,
  feed,
  settings,
  sources,
  plans,
  onboarding,
  rules,
};
