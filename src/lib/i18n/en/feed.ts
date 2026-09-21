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
    tooltipAdd: "Add to an overview for colleagues",
    tooltipRemove: "Remove from overview",
    toolbarLabel: "Selected stories",
    selected: (n: number) => `Selected: ${n}`,
    clearAria: "Clear selection",
    clearTooltip: "Unselect all cards",
    build: "Build overview",
    dialogTitle: "Build overview",
    issueOf: (date: string, n: number) => `Digest of ${date} · ${story(n)}`,
    defaultTitle: (date: string) => `Overview for ${date}`,
    titleLabel: "Overview title",
    introLabel: "Introduction",
    introPlaceholder: "Introduction — optional",
    empty: "No stories left in the overview — tick cards in the feed.",
    up: "Move up",
    down: "Move down",
    removeBlock: "Remove from overview",
    blockTitleLabel: "Story title",
    blockSummaryLabel: "Summary",
    fallbackLabel: "Overview text to copy by hand",
    copyMarkdown: "Copy Markdown",
    copy: "Copy overview",
    copied: "Overview copied",
    clipboardDeniedTitle: "The browser denied clipboard access",
    clipboardDeniedDescription: "The text below is selected — press Ctrl+C or ⌘C",
  },

  /** src/components/item-card.tsx */
  item: {
    hidden: (title: string) => `Hidden: ${title}`,
    undo: "Undo",
    clickbait: "clickbait",
    actionsLabel: "More actions",
    opinion: "My take",
    opinionAria: "My take: a ready post in your voice",
    opinionTooltipReady: "A post in your voice for your networks",
    opinionTooltipLocked: "My take — on the Pro plan",
    pickNetworksFirst: "First, pick where you publish",
    kindleSending: "Sending…",
    kindleSent: "Already on your Kindle",
    kindleSend: "Send to Kindle",
    kindleAria: "Send to Kindle",
    kindleTooltip: "Send the article to your Kindle",
    kindleToastTitle: "Sent to your Kindle",
    kindleToastDescription: "Arrives in about a minute",
    kindleError: "Couldn't send to Kindle — try again",
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
    openHint: "Search past digests — press /",
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
    shortfall: (have: string, target: number): string =>
      `${have} of ${target}: there is nothing more that really matters today`,
    monthDay: (date: Date): string => MONTH.format(date),
  },
};
