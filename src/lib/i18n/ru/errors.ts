import type { errors as En } from "../en/errors";
import { plural } from "@/lib/plural";

export const errors: typeof En = {
  wrongPassword: "Пароль не подходит",
  noSuchEntrance: "Такого входа сейчас нет. Войди через бота",
  sectionLocked: (plan: string) => `Раздел доступен на тарифе «${plan}»`,

  pickOneTopic: "Добавь хотя бы один интерес",
  pickAnyTopic: "Выбери хотя бы один интерес",
  pickOneSource: "Выбери хотя бы один источник",
  tooManyTopics: (plan: string, allowed: number, picked: number) =>
    `На тарифе «${plan}» можно ${allowed} ${plural(allowed, "интерес", "интереса", "интересов")}, ` +
    `а выбрано ${picked}`,
  duplicateTopic: "Такой интерес уже есть, назови иначе",

  kindleAddressEmpty: "Впиши адрес читалки",
  kindleAddressSuffix: "Адрес должен заканчиваться на @kindle.com",

  emptyLine: "Пустая строка",
  checkLinkFirst: "Сначала проверь ссылку",
  pasteLink: "Вставь ссылку",
  sourceGone: (reason: string) => `Источник больше не отвечает: ${reason}`,
  sourceAlreadyGone: "Источник уже убран",

  noDigestYet: "Выпуска ещё нет, переписывать нечего",
  digestEmpty: "В выпуске нет материалов",
  capReachedRewrite: "Сегодня больше нельзя, завтра лимит обнулится",
  capReachedTopUp: "Сегодня больше добавить нельзя, завтра лимит обнулится",
  dailyCap: (usd: number) => `Дневной потолок $${usd} исчерпан, до завтра`,

  notANewsletter:
    "Это похоже на рассылку, а не на твой канал: нужен канал Telegram, аккаунт X или блог",
  unknownNetwork: "Неизвестная сеть",
  itemNotYours: "Этого материала в твоих выпусках нет",
  noChannelsYet: "Сначала отметь в настройках, где ты публикуешь",
  draftNotFound: "Черновик не найден",

  kindleNoAddress: "Сначала настрой Kindle в «Доставке»: там нужен адрес читалки",
  kindleNoSender: "Это наша поломка, напиши боту в Telegram",
  kindleNotApproved: "Amazon ещё не разрешил наш адрес, доделай настройку в «Доставке»",
  kindleCapReached: "Сегодня больше отправить нельзя, завтра лимит обнулится",
  kindleAlreadySending: "Эта статья уже в пути",
  storyNotYours: "Этой новости нет в твоих выпусках",
  noSession: "Сессия кончилась, войди заново",
  badRequest: "Не смогли прочитать запрос",

  firstIssueFailed: "Не получилось собрать первый выпуск, соберу ночью",
};
