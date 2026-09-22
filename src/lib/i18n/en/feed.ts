const MONTH = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

/** Строки области «feed». Английский задаёт форму, русский её повторяет. */

const story = (n: number) => `${n} ${n === 1 ? "story" : "stories"}`;
const digest = (n: number) => `${n} ${n === 1 ? "digest" : "digests"}`;

export const feed = {
  /** src/app/(app)/page.tsx — пока не готов ни один выпуск. */
  page: {
    empty: {
      title: "First digest arrives tonight",
      body: "The feed is put together once a day, at night. For now, you can",
      or: "or",
      fixInterests: "adjust your interests",
      addSources: "add sources",
      collectNow: "Collect right now:",
    },
    settingsHint: "Settings: interests, sources, delivery",
  },

  /** src/components/date-nav.tsx */
  dateNav: {
    previous: "Previous digest",
    next: "Next digest",
    pickDate: "Pick a date",
  },

  /** src/components/feed-tabs.tsx */
  tabs: {
    all: "All",
    other: "Other",
    toTopAria: "Back to top",
    toTopTooltip: "Back to top — dates and tabs",
    emptyTitle: "Nothing here yet",
    emptyDescription: "Nothing from this topic made it into today's digest",
    showAll: "Show full digest",
    readUpToHere: "You've read up to here",
    kbdAnd: "and",
    kbdBetween: "between stories",
    kbdOpen: "open",
    kbdOverview: "add to overview",
    kbdListen: "listen",
    kbdSearch: "search digests",
  },

  /** Личные правила поверх готового выпуска: feed-tabs.tsx и item-card.tsx */
  rules: {
    hiddenBefore: (n: number) => `${n} ${n === 1 ? "card" : "cards"} hidden by your`,
    hiddenLink: "exclusions",
    allHiddenTitle: "Everything is hidden by exclusions",
    allHiddenDescription: (n: number) =>
      `The digest has ${n} ${n === 1 ? "card" : "cards"}, and each mentions something from your list. The digest isn't rebuilt — freed slots aren't refilled.`,
    fixExclusions: "Adjust exclusions",
    followedTitle: "From your “What to follow” list",
  },

  overview: {
    add: (title: string) => `Add to overview: ${title}`,
    remove: (title: string) => `Remove from overview: ${title}`,
    tooltipAdd: "Add to overview",
    tooltipRemove: "Remove from overview",
    podcast: "Record podcast",
    podcastWorking: "Building the podcast…",
    podcastQueued: (n: number) => `Podcast of ${n} ${n === 1 ? "story" : "stories"} is on its way`,
    podcastQueuedNote: "It will arrive in Telegram as one file",
    podcastPartial: (done: number, asked: number) => `Podcast of ${done} stories instead of ${asked}`,
    toolbarLabel: "Selected stories",
    selected: (n: number) => `${n} selected`,
    clearAria: "Clear selection",
    clearTooltip: "Clear selection",
    build: "Build overview",
    dialogTitle: "Overview for your team",
    defaultTitle: (date: string) => `Overview for ${date}`,
    titleLabel: "Title",
    introLabel: "Introduction",
    introPlaceholder: "A few words from you, if you like",
    empty: "Nothing here yet — tick stories in the feed and they'll show up here",
    up: "Move up",
    down: "Move down",
    removeBlock: "Remove",
    blockTitleLabel: "Title",
    blockSummaryLabel: "Text",
    fallbackLabel: "Overview text",
    copyMarkdown: "Copy as Markdown",
    copy: "Copy",
    copied: "Copied",
    copiedHint: "Paste it into a chat or an email",
    clipboardDeniedTitle: "Couldn't copy",
    clipboardDeniedDescription: "The text is selected below — press ⌘C or Ctrl+C",
  },

  /** src/components/item-card.tsx */
  /** src/components/upgrade-note.tsx — the line under the digest. */
  upgrade: {
    // What happened to his feed, never what to buy: every number here can be
    // checked by eye on the same screen. The plan being offered is named once,
    // in `offer`, next to its price — said twice, a sentence and the button
    // under it read as the same line printed by mistake.
    cadence: "No digest today: on Free it arrives every other day.",
    sources: (now: number, plan: string) =>
      `The feed watches ${now} sources — that is all of ${plan}.`,
    topics: (now: number, plan: string) =>
      `${now} ${now === 1 ? "interest" : "interests"} — that is all of ${plan}.`,
    minutes: (collected: number, kept: number, now: number) =>
      `Your sources published ${collected} ${collected === 1 ? "story" : "stories"} in the last day; ${kept} made the digest — that is what fits in ${now} ${now === 1 ? "minute" : "minutes"}.`,
    /** What the other plan gives — the same unit the sentence above counts in. */
    gain: {
      cadence: "Every morning",
      sources: (up: number) => `${up} sources`,
      topics: (up: number) => `${up} interests`,
      minutes: (up: number) => `${up} minutes of digest`,
    },
    offer: (gain: string, to: string, price: number) => `${gain} on ${to} — $${price}`,
  },

  item: {
    hidden: (title: string) => `Hidden: ${title}`,
    undo: "Undo",
    clickbait: "clickbait",
    actionsLabel: "More actions",
    opinion: "My take",
    opinionAria: "My take: a ready post in your voice",
    opinionTooltipReady: "A post in your voice for your networks",
    opinionTooltipLocked: (plan: string) => `My take — on the ${plan} plan`,
    pickNetworksFirst: "First, pick where you publish",
    kindleSending: "Sending…",
    kindleSent: "Already on your Kindle",
    kindleSend: "Send to Kindle",
    kindleAria: "Send to Kindle",
    kindleTooltip: "Send the article to your Kindle",
    kindleTooltipLocked: (plan: string) => `Kindle is on the ${plan} plan`,
    share: "Share",
    shareAria: "Share a link to the article",
    shareTooltip: "Send a link to the article",
    shareCopied: "Link copied",
    shareCopiedDescription: "Paste it into a chat or an email",
    shareFailed: "Couldn't copy",
    shareFailedDescription: "Open the article from its headline and copy the address there",
    kindleToastTitle: "Sent to your Kindle",
    kindleToastDescription: "Arrives in about a minute",
    kindleError: "Couldn't send to Kindle — try again",
    audioSpeak: "Listen",
    audioWorking: "Reading aloud…",
    audioSent: "Already in Telegram",
    audioPlay: "Play",
    audioPause: "Pause",
    audioPlayError: "Playback failed — the audio is in Telegram",
    audioRateTooltip: "Speed: tap to change",
    audioRateAria: "Playback speed",
    audioAria: "Read this article aloud",
    audioTooltipReady: "Listen to the article in Telegram",
    audioTooltipLocked: (plan: string) => `Audio is on the ${plan} plan`,
    audioStart: "Getting the audio ready…",
    audioQueued: "In the queue…",
    audioTranslating: "Translating the article…",
    audioSpeaking: "Reading it aloud…",
    audioSending: "Sending to Telegram…",
    audioDoneTitle: "Audio is in Telegram",
    audioDoneDescription: (minutes: number) => `${minutes} min — open the chat with the bot`,
    audioSlowTitle: "Still working on the audio",
    audioSlowDescription: "It will arrive in Telegram when it is ready",
    audioError: "Could not read it aloud — try again",
    upvoteLabel: "More like this",
    upvoteTooltip: "More like this in future digests",
    downvoteLabel: "Hide and show less like this",
    thisCard: "this card",
    summaryUnavailable: "The summary is not available yet. Open the original using the headline link.",
  },

  /** Поле и кнопка поиска: src/components/feed-search.tsx, search-form.tsx, search-memory.tsx */
  search: {
    label: "Search digests",
    submit: "Search",
    openHint: "Search past digests",
    fieldPlaceholder: "Search past digests: uranium data centers",
    close: "Close search",
    recent: "recent",
  },

  /** src/app/(app)/search/page.tsx */
  searchPage: {
    backToFeedAria: "Back to feed",
    placeholder: "Try: uranium data centers",
    digestOf: (date: string) => `Digest of ${date}`,
    emptyArchiveTitle: "Nothing to search yet",
    emptyArchiveBody: "Search covers your digests. Your first one hasn't arrived yet —",
    backToFeedLink: "back to the feed",
    noQueryTitle: "Search your digests",
    noQueryBody:
      "This isn't a search across the internet: only what the feed has already sent you —",
    over: "over",
    matchExplainer:
      "Words are matched in both the digest's own wording and the original headline, so search works across languages too.",
    noResultsTitle: "Nothing found",
    noResultsBody: (query: string) =>
      `Nothing turned up for "${query}" in your digests. If the feed never sent you something, it won't be here — search covered`,
    storiesCount: story,
    storiesSearchedCount: story,
    digestsCount: digest,
    looseNote: " — nothing matched every word, so this is by any of them",
  },

  /** src/components/collect-now.tsx */
  collectNow: {
    noNews: "No fresh news yet",
    added: (n: number) => `Added ${n}`,
    error: "Couldn't collect the digest — try again",
    collecting: "Collecting…",
    collect: "Collect now",
    takesAMinute: "Takes a couple of minutes",
  },

  /** src/components/rebuild-queue.tsx */
  rebuild: {
    stillUpdatingTitle: "Saved — the digest is still updating",
    stillUpdatingDescription: `Press "Save" again once we're done`,
    savedNoChangeTitle: "Settings saved",
    savedNoChangeDescription: "They'll take effect from your next digest",
    countdownTitle: "Updating today's digest shortly",
    countdownDescription: (seconds: number) => `Starting in ${seconds}s — you can still cancel`,
    cancelAction: "Cancel",
    cancelledToast: "Cancelled. Today's digest is unchanged",
    workingTitle: "Updating today's digest…",
    workingDescription: "Takes 1–2 minutes — keep reading meanwhile",
    added: (n: number) => `added ${n}`,
    rewrote: (n: number) => `rewrote ${n}`,
    partiallyRewritten: (updated: number, retained: number) => `Updated ${updated}; ${retained} kept their previous summaries because processing did not finish`,
    noChangeTodayTitle: "Today's digest is already like this",
    noChangeTodayDescription: "Future digests will come with the new settings",
    updated: (summary: string) => `Updated today's digest: ${summary}`,
    updatedDescription: "Future digests will be built with the new settings",
    failed: "Couldn't update the digest",
  },

  /** src/lib/relative-time.ts */
  story: {
    discussion: "discussion",
    discussionPoints: (points: number): string => `discussion: ${points} points`,
    original: "first to publish",
    sameTime: "at the same time",
    laterMinutes: (n: number): string => `${n} ${n === 1 ? "minute" : "minutes"} later`,
    laterHours: (n: number): string => `${n} ${n === 1 ? "hour" : "hours"} later`,
    laterDays: (n: number): string => `${n} ${n === 1 ? "day" : "days"} later`,
    alsoLine: (n: number): string => `${n} more ${n === 1 ? "source" : "sources"}`,
    storyTitle: (n: number): string => `One story, ${n} ${n === 1 ? "publication" : "publications"}`,
  },
  reading: {
    equals: "equals", then: "then", step: "Step", stage: "Stage",
    claimed: "commonly believed", reality: "in fact", more: "More",
    planned: "planned", done: "completed", current: "current", unspecified: "",
  },
  time: {
    summaryMinute: "min", summarySecond: "s",
    now: "now",
    minutesAgo: (n: number) => `${n}m`,
    hoursAgo: (n: number) => `${n}h`,
    daysAgo: (n: number) => `${n}d`,
    readingMinutes: (n: number) => `~${n} min`,
    // Дальше недели — дата. Форматтер свой у каждого языка: месяц называется
    // словом, и «сент.» рядом с английским текстом читается как опечатка,
    // а не как перевод, которого не хватило.
    minutesLong: (n: number): string => `~${n} ${n === 1 ? "minute" : "minutes"}`,
    hoursLong: (h: number, m: number): string =>
      m > 0
        ? `~${h} ${h === 1 ? "hour" : "hours"} ${m} ${m === 1 ? "minute" : "minutes"}`
        : `~${h} ${h === 1 ? "hour" : "hours"}`,
    shortfall: (have: string, target: number): string =>
      `${have} of ${target}: there is nothing more that really matters today`,
    monthDay: (date: Date): string => MONTH.format(date),
  },
};
