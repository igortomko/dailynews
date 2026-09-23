/** Строки области «settings». Английский задаёт форму, русский её повторяет. */

// Подписи и подсказки шкал из `@/lib/voice`: ключи те же, что и `VoiceOption.key`
// там (`"1"`..`"5"` и названия манер), а сам `instruction` для модели остаётся
// в voice.ts и не переводится — это часть измеренного промпта, а не текст
// для читателя.
const complexity: Record<string, { label: string; hint: string }> = {
  "1": { label: "Very simple", hint: "We explain every new term and keep sentences short" },
  "2": { label: "Simple", hint: "We explain as we go and split up long sentences" },
  "3": { label: "Explain terms", hint: "We explain only the rare words, familiar ones stay as is" },
  "4": { label: "To the point", hint: "We skip explaining what you already know" },
  "5": { label: "Expert", hint: "We write like to a colleague, no hand-holding" },
};

const styles: Record<string, { label: string; hint: string }> = {
  "нейтральный": { label: "Neutral", hint: "Even-toned, no opinions" },
  "разговорный": { label: "Like a friend", hint: "Lively, with explanations" },
  "телеграфный": { label: "Concise", hint: "Short and to the point" },
  "аналитический": { label: "Analysis", hint: "More detail, with causes and conclusions" },
};

// LANGUAGES в voice.ts хранит предложный падеж («русском»), потому что строка
// уезжает в промпт как есть. Для английского интерфейса это неверная форма
// показа, и значение брать нельзя — только показывать через отдельное имя.
// Ключ — сырое значение из LANGUAGES, значение — то, что видит читатель.
const languageNames: Record<string, string> = {
  "языке источника": "Source language",
  "русском": "Russian",
  "английском": "English",
  "португальском (бразильский)": "Portuguese (Brazilian)",
  "испанском": "Spanish",
  "немецком": "German",
  "французском": "French",
  "итальянском": "Italian",
  "нидерландском": "Dutch",
  "польском": "Polish",
  "украинском": "Ukrainian",
  "турецком": "Turkish",
  "японском": "Japanese",
  "китайском": "Chinese",
  "корейском": "Korean",
  "арабском": "Arabic",
};

/** «12 of 40» — общий вид для чипа темы, счётчика тем и полосы. */
const nOf = (n: number, total: number) => `${n} of ${total}`;

export const settings = {
  // Слова, повторяющиеся в нескольких формах настроек: «Сохранить» одной
  // кнопкой висит и в личных настройках, и в стороже несохранённого ухода.
  common: {
    save: "Save",
    saveError: "Couldn't save — try again",
  },

  personalization: {
    firstTitle: "Set up your feed",
    firstDescription: "Tell us what language to write the news in and how. You'll pick interests next.",
    // Заголовок обычного экрана не заводится отдельно: он совпадает
    // с nav.personalization, и это тот же самый текст, а не совпадение.
    description: "The language and style your digest is written in. What it covers is set in Interests.",
    languageLabel: "Translate into",
    translatedHint: "Sources stay in their original language — we translate and adapt.",
    notTranslatedHint: "The digest arrives in the source language. Translation is available on Plus and Pro.",
    complexityLabel: "Language complexity",
    styleLabel: "Style",
    aboutLabel: "About you and what matters",
    aboutPlaceholder: "What you do, your product, where you live, and which news matters most to you",
    aboutHint: "The more detail you give, the more precisely we can explain why a story matters to you.",
    next: "Next: post drafts",
    done: "Done",
  },

  voice: { complexity, styles, languageNames },

  interests: {
    description: "What to collect news about. Drag the boundaries: the bigger a topic's share, the more stories it gets.",
  },

  topicChips: {
    minutesLabel: "Reading time in the digest",
    /** «20 minutes» — число и слово вместе, для aria-подписи кнопки размера. */
    minutes: (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`,
    /** «20 min» — видимый текст на самой кнопке, короче ради ширины ряда. */
    minutesShort: (n: number) => `${n} min`,
    onPaidPlan: "on a paid plan",
    /** Слово одно, без числа: число рядом уже стоит отдельным элементом. */
    storiesWord: (n: number): string => (n === 1 ? "story" : "stories"),
    capReached: (planLabel: string, maxItems: number, minutesText: string) =>
      `On the ${planLabel} plan, you'll get no more than ${maxItems} ${maxItems === 1 ? "story" : "stories"}: that's ${minutesText}.`,
    upToMinutes: (planLabel: string, maxMinutes: number) =>
      `On the ${planLabel} plan, up to ${maxMinutes} minutes. Read longer`,
    onPlans: (planLabels: string[]) => `on ${planLabels.join(" and ")}`,
    distributionLabel: "Stories per topic",
    yourTopics: "Your topics",
    ofTotal: nOf,
    chipAria: (label: string, count: number, places: number) =>
      `${label}, ${nOf(count, places)}. Use left and right arrow keys to reorder`,
    topicNameAria: "Topic name",
    removeAria: (label: string) => `Remove ${label}`,
    removeTooltip: "Remove topic",
    hintAria: (label: string) => `What belongs in ${label}`,
    hintPlaceholder: "comma-separated: what belongs here",
    hintHelp: "The more precise, the less clutter in the digest",
    // У общей темы вместо поля подсказки: ссылка на слежение стоит после.
    sharedNote:
      "A shared topic: its description is the same for everyone who picked it. Specific names and products go",
    // Заголовок раздела приходит из словаря `rules`: написанный здесь руками,
    // он разошёлся бы с настоящим при первом переименовании.
    sharedLink: (section: string) => `to “${section}”`,
    lessAria: "One less story",
    lessTooltip: "Fewer stories for this topic",
    moreAria: "One more story",
    moreTooltip: "One more story for this topic — taken from the largest one",
    newTopicAria: "New topic",
    newTopicPlaceholder: "Energy and uranium",
    add: "Add",
    topicLimitReached: (planLabel: string, maxTopics: number, word: string) =>
      `On the ${planLabel} plan you can have ${maxTopics} ${word}. Remove one to add a new one.`,
  },

  topicBudgetBar: {
    boundaryAria: (a: string, b: string) => `Boundary: ${a} and ${b}`,
    /** Ведущий пробел нужен: текст приклеивается к видимому числу для чтения с экрана. */
    ofTotalSuffix: (total: number) => ` of ${total}`,
  },

  unsavedGuard: {
    title: "Save changes?",
    description: "Settings on this page are saved with a button. If you leave now, your changes will be lost.",
    discard: "Don't save",
  },

  delivery: {
    telegram: {
      description: "Every morning your digest arrives in Telegram: a subtitle, every headline by topic, and a link to each story.",
      connected: (username: string | null) => `Connected${username ? ` as @${username}` : ""}.`,
      notConnected: "Not connected — message the bot /start, and it'll link this account.",
      podcast: "Send an audio podcast",
      podcastHint: "The digest as an audio recording, arrives together with the link.",
      podcastSaved: "Saved",
      timezone: "Time zone",
      timezoneSaved: "Time zone saved",
    },
    kindle: {
      descriptionDone: "The digest arrives as a book on your e-reader.",
      descriptionSetup: "You can get the digest on your Kindle automatically. It's 2 steps.",
      step: (now: number, of: number) => `Step ${now} of ${of}`,
      step1Title: "Get your Kindle address from Amazon",
      openAmazon: "Open",
      amazonLinkLabel: "Manage Your Content and Devices",
      afterAmazonLink:
        "→ Preferences → Personal Document Settings. You'll find an address like name@kindle.com there — paste it in below.",
      addressLabel: "Kindle address",
      addressPlaceholder: "name@kindle.com",
      addressHint: "Ends with @kindle.com",
      next: "Next",
      step2Title: "Approve our sender address",
      approvedListIntro: "In the same Amazon section, there's an Approved Personal Document E-mail List. Add",
      approvedListOutro: "— without it, the email is silently dropped, with no error at all.",
      connectTelegramFirst: "Connect Telegram first",
      beforeStartCommand: "Until Telegram is connected, the sender address is built from your reader number. Message the bot",
      afterStartCommand:
        "— the address will be rebuilt from your username, so you can recognize it in Amazon. Once approved, it's frozen: changing it later means losing delivery silently.",
      addedDone: "Added it, done",
      back: "Back",
      senderLabel: "Sender",
      notSet: "not set",
      approvedSuffix: "is approved on Amazon.",
      sendToKindle: "Send the digest to my Kindle",
      sendToKindleHint: (on: boolean, period: "daily" | "weekly"): string =>
        !on
          ? "Off — the address still works for sending individual articles."
          : period === "weekly"
            ? "Every Saturday — the whole week in one book."
            : "Every morning — that day's digest as a book.",
      periodLabel: "How often to send",
      period: { daily: "Daily", weekly: "Saturdays" },
      resetLink: "Start over",
      resetTooltip: "Erase the Kindle address and set it up again",
      copyAddress: "Copy address",
      addressCopied: "Address copied",
      copyFailed: "Your browser blocked copying — select the address manually",
      addressSaved: "Address saved",
      allSet: "All set",
      saved: "Saved",
      setupReset: "Setup reset",
    },
  },
};
