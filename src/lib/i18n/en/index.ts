/**
 * Английский словарь — источник правды для типа.
 *
 * Разложен по областям экрана, по файлу на область: строку ищут оттуда,
 * где её увидели, а один файл на четыреста строк не даёт двум правкам
 * идти рядом. Русский повторяет ту же раскладку файл в файл.
 *
 * Множественное число — функцией, а не строкой с числом: в английском форм
 * две, в русском три, и одна подстановка на оба языка врёт в одном из них.
 * Поэтому число всегда приходит в функцию, а форму выбирает сам словарь.
 */
import * as shell from "./shell";
import { errors } from "./errors";
import { feed } from "./feed";
import { settings } from "./settings";
import { sources } from "./sources";
import { plans } from "./plans";
import { onboarding } from "./onboarding";

export const en = {
  nav: shell.nav,
  theme: shell.theme,
  locale: shell.locale,
  errors,
  feed,
  settings,
  sources,
  plans,
  onboarding,
};

/**
 * Форма словаря: русский обязан ей соответствовать целиком, и пропущенный
 * ключ не даст собраться. Без `as const` намеренно — иначе типом строки
 * становится она сама, и «Настройки» не подходит под «Settings».
 */
export type Dict = typeof en;
