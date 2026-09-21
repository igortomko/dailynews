import type { nav as Nav, theme as Theme, locale as Locale } from "../en/shell";

export const nav: typeof Nav = {
  settings: "Настройки",
  onboarding: "Знакомство",
  backToFeed: "Назад к ленте",
  signOut: "Выйти",
  personalization: "Язык и подача",
  sources: "Источники",
  interests: "Интересы",
  delivery: "Доставка",
  channels: "Мои площадки",
  subscription: "Подписка",
  about: "О проекте",
};

export const theme: typeof Theme = {
  toggle: "Переключить тему",
  dark: "Тёмная тема",
  light: "Светлая тема",
};

export const locale: typeof Locale = {
  toggle: "Язык интерфейса",
  pick: (name: string) => `Переключить интерфейс на ${name}`,
};
