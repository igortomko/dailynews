import type { settings as En } from "../en/settings";
import { count, plural } from "@/lib/plural";

/**
 * Русский словарь области «settings». Текст перенесён дословно из старого
 * кода personalization/form.tsx, interests/form.tsx, delivery/form.tsx,
 * topic-chips.tsx, topic-budget-bar.tsx, unsaved-guard.tsx и voice.ts.
 */
const complexity: typeof En.voice.complexity = {
  "1": { label: "Очень просто", hint: "Объясняем каждое новое слово и пишем короткими фразами" },
  "2": { label: "Просто", hint: "Объясняем на ходу, длинные фразы делим надвое" },
  "3": { label: "Объяснять термины", hint: "Объясняем только редкие слова, привычные оставляем" },
  "4": { label: "По делу", hint: "Не объясняем то, что ты и так знаешь" },
  "5": { label: "Экспертно", hint: "Пишем как коллеге, ничего не разжёвываем" },
};

const styles: typeof En.voice.styles = {
  "нейтральный": { label: "Нейтрально", hint: "Ровно и без оценок" },
  "разговорный": { label: "Как другу", hint: "Живо, с пояснениями" },
  "телеграфный": { label: "Сжато", hint: "Коротко и по сути" },
  "аналитический": { label: "Разбор", hint: "Подробнее, с причинами и выводами" },
};

// В русском интерфейсе значение LANGUAGES и есть показ — «русском» уже
// стоит в предложном падеже, как того требует промпт. Карта поэтому
// тождественная, а не украшение: без неё негде было бы взять показ
// для незнакомого языка, сохранённого вне списка.
/**
 * Слева ключ, справа то, что видит читатель. Ключ — предложный падеж,
 * потому что он лежит в базе и уходит в промпт дайджеста строкой; пункт
 * списка стоит в именительном, потому что над ним написано «Перевести на»,
 * и «Перевести на: русском» — это машинный текст.
 */
const languageNames: typeof En.voice.languageNames = {
  "языке источника": "язык источника",
  "русском": "русский",
  "английском": "английский",
  "португальском (бразильский)": "португальский (бразильский)",
  "испанском": "испанский",
  "немецком": "немецкий",
  "французском": "французский",
  "итальянском": "итальянский",
  "нидерландском": "нидерландский",
  "польском": "польский",
  "украинском": "украинский",
  "турецком": "турецкий",
  "японском": "японский",
  "китайском": "китайский",
  "корейском": "корейский",
  "арабском": "арабский",
};

const nOf = (n: number, total: number) => `${n} из ${total}`;

export const settings: typeof En = {
  common: {
    save: "Сохранить",
    saveError: "Не удалось сохранить. Попробуй ещё раз",
  },

  personalization: {
    firstTitle: "Настрой ленту",
    firstDescription: "Скажи, на каком языке и как писать новости. Интересы выберешь следующим шагом.",
    description: "На каком языке и как написан твой выпуск. О чём он, выбираешь в «Интересах».",
    languageLabel: "Перевести на",
    translatedHint: "Источники остаются на своих языках, мы переводим и адаптируем.",
    notTranslatedHint: "Выпуск приходит на языке источника. Перевод есть на «Plus» и «Pro».",
    complexityLabel: "Сложность языка",
    styleLabel: "Манера подачи",
    aboutLabel: "О себе и что важно",
    aboutPlaceholder: "Чем занимаешься, что за продукт, где живёшь и какие новости тебе особенно интересны",
    aboutHint: "Чем подробнее напишешь, тем точнее объясним, чем новость важна тебе.",
    next: "Дальше: черновики постов",
    done: "Готово",
  },

  voice: { complexity, styles, languageNames },

  interests: {
    description: "О чём собирать новости. Двигай границы: чем больше доля темы, тем больше новостей по ней.",
  },

  topicChips: {
    minutesLabel: "Время чтения в выпуске",
    minutes: (n: number) => count(n, "минута", "минуты", "минут"),
    minutesShort: (n: number) => `${n} мин`,
    onPaidPlan: "на платном тарифе",
    storiesWord: (n: number) => plural(n, "новость", "новости", "новостей"),
    capReached: (planLabel: string, maxItems: number, minutesText: string) =>
      `На тарифе «${planLabel}» в выпуск попадает не больше ${count(maxItems, "новости", "новостей", "новостей")}: это ${minutesText}.`,
    upToMinutes: (planLabel: string, maxMinutes: number) =>
      `На тарифе «${planLabel}» до ${maxMinutes} минут. Дольше читать`,
    onPlans: (planLabels: string[]) => `на «${planLabels.join("» и «")}»`,
    distributionLabel: "Распределение по темам, новостей",
    yourTopics: "Твои темы",
    ofTotal: nOf,
    chipAria: (label: string, count: number, places: number) =>
      `${label}, ${nOf(count, places)}. Стрелками влево и вправо можно переставить`,
    topicNameAria: "Название темы",
    removeAria: (label: string) => `Убрать ${label}`,
    removeTooltip: "Убрать интерес",
    hintAria: (label: string) => `Что относится к теме «${label}»`,
    hintPlaceholder: "через запятую: что сюда относится",
    hintHelp: "Чем точнее, тем меньше лишнего в выпуске",
    sharedNote:
      "Тема общая — её описание одно на всех, кто её взял. Конкретные имена и продукты —",
    sharedLink: (section: string) => `в «${section}»`,
    lessAria: "На одну новость меньше",
    lessTooltip: "Меньше новостей по этой теме",
    moreAria: "На одну новость больше",
    moreTooltip: "Больше новостей по этой теме. Место возьмётся у самой крупной",
    newTopicAria: "Новый интерес",
    newTopicPlaceholder: "Энергетика и уран",
    add: "Добавить",
    topicLimitReached: (planLabel: string, maxTopics: number, word: string) =>
      `На тарифе «${planLabel}» можно ${maxTopics} ${word}. Убери один, чтобы добавить новый`,
  },

  topicBudgetBar: {
    boundaryAria: (a: string, b: string) => `Граница: ${a} и ${b}`,
    ofTotalSuffix: (total: number) => ` из ${total}`,
  },

  unsavedGuard: {
    title: "Сохранить изменения?",
    description: "Настройки на этой странице сохраняются кнопкой. Если уйти сейчас, правки пропадут.",
    discard: "Не сохранять",
  },

  delivery: {
    telegram: {
      description: "Каждое утро в твой Telegram приходит выпуск: подзаголовок, все заголовки по темам и ссылка на каждую статью.",
      connected: (username: string | null) => `Подключён${username ? ` как @${username}` : ""}.`,
      notConnected: "Не подключён — напиши боту /start, и он свяжет этот аккаунт.",
      podcast: "Отправлять аудио-подкаст",
      podcastHint: "Выпуск выжимки в виде аудиозаписи, приходит вместе с ссылкой.",
      podcastSaved: "Сохранил",
      timezone: "Часовой пояс",
      timezoneSaved: "Пояс сохранён",
    },
    kindle: {
      descriptionDone: "Выпуск уходит книгой на читалку.",
      descriptionSetup: "Ты можешь автоматически получать выпуск на свой Kindle. Это 2 шага.",
      step: (now: number, of: number) => `Шаг ${now} из ${of}`,
      step1Title: "Возьми адрес читалки в Amazon",
      openAmazon: "Открой",
      amazonLinkLabel: "«Manage Your Content and Devices»",
      afterAmazonLink:
        "→ Preferences → Personal Document Settings. Там лежит адрес вида имя@kindle.com — вставь его сюда.",
      addressLabel: "Адрес читалки",
      addressPlaceholder: "имя@kindle.com",
      addressHint: "Заканчивается на @kindle.com",
      next: "Дальше",
      step2Title: "Разреши наш адрес отправителя",
      approvedListIntro: "В том же разделе Amazon есть «Approved Personal Document E-mail List». Добавь туда",
      approvedListOutro: "— без этого письмо отбрасывается молча, без единой ошибки.",
      connectTelegramFirst: "Сначала привяжи Telegram",
      beforeStartCommand: "Пока Telegram не привязан, отправитель собран из номера читателя. Напиши боту",
      afterStartCommand:
        "— адрес пересоберётся из твоего username, и в Amazon его будет видно глазами. После подтверждения он замораживается: менять его потом значит потерять доставку молча.",
      addedDone: "Добавил, готово",
      back: "Назад",
      senderLabel: "Отправитель",
      notSet: "не задан",
      approvedSuffix: "разрешён в Amazon.",
      sendToKindle: "Присылать выпуск на читалку",
      sendToKindleHint: (on: boolean, period: "daily" | "weekly"): string =>
        !on
          ? "Выключено — адрес остаётся для отправки отдельных статей."
          : period === "weekly"
            // Что именно внутри книги, сказано словами: «раз в неделю»
            // читается и как «неделя целиком», и как «один выпуск из семи»,
            // а разница между ними — шесть выпусков.
            ? "Каждую субботу — все выпуски недели одной книгой."
            : "Каждое утро — выпуск этого дня книгой.",
      periodLabel: "Как часто присылать",
      period: { daily: "Каждый день", weekly: "По субботам" },
      resetLink: "Настроить заново",
      resetTooltip: "Стереть адрес читалки и пройти настройку с начала",
      copyAddress: "Скопировать адрес",
      addressCopied: "Адрес скопирован",
      copyFailed: "Браузер не дал скопировать — выдели адрес вручную",
      addressSaved: "Адрес сохранён",
      allSet: "Настроено",
      saved: "Сохранено",
      setupReset: "Настройка сброшена",
    },
  },
};
