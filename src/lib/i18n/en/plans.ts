/** Строки области «plans». Английский задаёт форму, русский её повторяет. */
import type { FeatureId, PlanId } from "@/lib/plans";
import type { Source } from "@/lib/types";

export const plans = {
  /**
   * Имя тарифа. Plus и Pro не переводятся — это имена; free — обычное
   * слово («Free»/«Бесплатный»), и вот оно переводится.
   */
  label: {
    free: "Free",
    plus: "Plus",
    pro: "Pro",
  } satisfies Record<PlanId, string>,

  tagline: {
    free: "Try the feed",
    plus: "Read every day",
    pro: "Read and write",
  } satisfies Record<PlanId, string>,

  kindName: {
    rss: "Sites and blogs",
    hackernews: "Hacker News",
    telegram: "Telegram channels",
    email: "Email newsletters",
    reddit: "Reddit",
    x: "Posts from X",
  } satisfies Record<Source["kind"], string>,

  /** Отказ по виду источника: собирается в `kindDenial` из lib/plans.ts. */
  // Двоеточие, а не глагол: четыре имени вида из шести — множественного
  // числа («Sites and blogs», «Posts from X»), а два — имена собственные
  // («Hacker News»). Любая связка верна ровно для половины: «Posts from X
  // is only on the Pro plan» читатель видел на проде. Двоеточие числа
  // не спрашивает, поэтому имя вида остаётся в строке — читатель мог
  // вставить ссылку, не зная, чем она окажется.
  kindOnlyOn: (kind: string, planNames: string[]) =>
    `${kind}: only on the ${planNames.join(" or ")} plan`,
  kindUnavailable: (kind: string) => `${kind}: not available right now`,

  feature: {
    personalization: {
      title: "Language and voice",
      what: "The digest's language and how it's written: plain or expert, dry or lively. Included on every plan.",
    },
    language: {
      title: "Translation",
      what: "The digest arrives in your language. On Free, titles and summaries stay in the source language.",
    },
    delivery: {
      title: "Send to e-reader",
      what: "The digest arrives as a book on Kindle — read on e-ink, no phone needed.",
    },
    posts: {
      title: "Your own take",
      what: "A ready post in your voice from any story in the digest: the feed reads your channels, learns how you write, and drafts one for each of your networks.",
    },
    audio: {
      title: "Article audio",
      what: (minutes: number) =>
        `Any article from your issue is read aloud and arrives in Telegram — listen while driving or walking. ${minutes} ${minutes === 1 ? "minute" : "minutes"} a day.`,
    },
    x: {
      title: "Posts from X",
      what: "Tweets show up alongside site stories. X charges for access, so this is Pro only.",
    },
    topics: {
      title: "Interests",
      what: "What you want to read about — AI, design, whatever it is. The digest splits across interests so one doesn't take over.",
    },
    cadence: {
      title: "How often it arrives",
      what: "Paid plans get a digest every night. Free gets one every other night.",
    },
    digest: {
      title: "Reading time",
      what: "How long the digest takes: based on the length of our own summaries, not the linked articles. Five minutes is a coffee break, forty-five replaces a social feed.",
    },
    sources: {
      title: "Sources",
      what: "Sites, blogs, and channels the feed checks every day. More sources means a wider pick for the digest.",
    },
  } satisfies Record<
    FeatureId,
    // `what` бывает функцией: у озвучки в описании стоит квота, а она
    // живёт в plans.ts — числом в словаре она разъехалась бы с настоящим
    // пределом молча. Разворачивает это `featureWhat`.
    { title: string; what: string | ((minutes: number) => string) }
  >,

  /** «1 interest», «5 interests» — нужна и в отказе, и в заглушке. */
  topicsWord: (n: number): string => (n === 1 ? "interest" : "interests"),

  /** «Move to Plus» — общая кнопка сравнения тарифов и заглушки. */
  moveTo: (label: string) => `Move to ${label}`,

  table: {
    title: "Subscription",
    description:
      "Your plan sets how many sources the feed follows, how many interests you have, and how many minutes of reading the digest holds.",
    yourPlan: "Your plan",
    perMonth: "per month",
    manage: "Manage plan",
    checkoutNotReady: "Checkout isn't set up yet. Message the bot",
    changesAfterPeriod: "Takes effect after the paid period ends",
    belowYours: "Below yours",
    audioPerDay: (minutes: number) => `${minutes} min a day`,
    dailyCadence: "every day",
    everyOtherCadence: "every other day",
    upToMinutes: (n: number) => `up to ${n} min`,
    hasFeature: "included",
    noFeature: "not included",
    techLimit: (items: string) =>
      `Reading time is based on the length of our own summaries, not the linked articles. The digest's technical ceiling is ${items} stories respectively: if a day has less that matters, the digest is shorter than ordered, and the feed says so directly.`,
    cancelledUntil: (label: string, date: string) => `Subscription cancelled, the ${label} plan works through ${date}.`,
    pastDue: "Payment didn't go through. We'll try charging again",
    renews: (date: string) => `Renews ${date}`,
    manageElsewhere: "Change card, cancel, or view invoices on the management page",
  },

  paywall: {
    choose: "Choose",
    perMonthShort: "/mo",
    offerSummary: (sources: number, topics: number, topicsWord: string, minutes: number) =>
      `${sources} sources · ${topics} ${topicsWord} · up to ${minutes} min read`,
    currentPlanNote: (label: string) => `You're on ${label} now. Full comparison is in Subscription.`,
    notNow: "Not now",
    paidFeatureAria: (title: string) => `${title} — on a paid plan`,
  },

  gate: {
    titleWithPlan: (title: string, planLabel: string) => `${title} — on the ${planLabel} plan`,
    nowOn: (label: string, topics: number, topicsWord: string, sources: number, minutes: number) =>
      `You're on ${label} now: ${topics} ${topicsWord}, ${sources} sources, up to ${minutes} minutes of reading in the digest.`,
    upgradeTo: (
      label: string, topics: number, topicsWord: string, sources: number, minutes: number, price: number,
    ) => `${label} gets you ${topics} ${topicsWord}, ${sources} sources, and up to ${minutes} minutes, $${price} a month.`,
  },

  about: {
    heroTitle: "Only what's worth reading",
    newsWord: (n: number): string => (n === 1 ? "story" : "stories"),
    minutesWord: (n: number): string => (n === 1 ? "minute" : "minutes"),
    // Фраза целиком, а не куски под полужирные числа: подпись из трёх
    // выделенных вставок читается набором акцентов, а не утверждением.
    // Акценты стоят ниже, в легенде, где числа и так голые.
    //
    // Число приходит уже со своим словом («89 stories»): по-русски оно
    // стоит после глагола, по-английски — в начале, и склейка на стороне
    // страницы держала бы один порядок на оба языка.
    flowSaved: (saved: string): string => `We saved you ${saved} over the last day.`,
    flowBasis: (collected: string, stream: string, minutes: string): string =>
      `${collected} came in from your sources — skimming it all is ${stream}. Your digest is ${minutes}.`,
    // Пустые сутки — не ноль в той же фразе: «came in 0 stories, keeps ~18»
    // обещает выпуск из того, чего нет.
    flowLeadEmpty: (kept: string, minutes: string): string =>
      `Nothing came in from your sources over the last day. When it does, we keep ~${kept} — your ${minutes}.`,
    flowKept: "kept for you",
    flowDropped: "dropped",
    flowTune: "Change reading time",
    stepsTitle: "How it lands on exactly that much",
    steps: [
      {
        title: "We read everything",
        text: "Every site, blog, and channel on your list, in full, nothing skipped. Popular and trending aren't part of the pick — you build the lists.",
      },
      {
        title: "We ask the same questions about every story",
        text: "Is it news or a rehash of something old. Does it have numbers and a named source. Will it matter later. Is the headline honest. Every story gets the same questions, so the answers can be compared.",
      },
      {
        title: "We split the digest across your interests",
        text: "We take the best from each interest, then the second-best from each — until the ordered time is filled. Otherwise the loudest topic would take the whole digest: energy once took 8 of 12 slots. A quiet day doesn't get padded with weak stories — the digest is just shorter.",
      },
      {
        title: "We retell it in your language",
        text: "The title names what changed; the summary picks up where the title left off. Language, complexity, and tone are whatever you chose.",
      },
    ],
    upgradeTitle: (label: string) => `What changes on ${label}`,
    currentSummary: (label: string, sources: number, topics: number, topicsWord: string, minutes: number) =>
      `You're on ${label} now: ${sources} sources, ${topics} ${topicsWord}, up to ${minutes} minutes of reading in the digest.`,
    compareRows: [
      { label: "Sources", why: "a wider pick for the digest to draw from" },
      { label: "Interests", why: "more topics for the digest to split across" },
      { label: "Reading minutes", why: "how long the digest takes" },
    ],
    xOnlyHere: "access is paid, so this is the only plan that has it",
    viewPlans: "View plans",
    priceLine: (label: string, price: number) => `${label}, $${price} a month`,
  },

  calibration: {
    empty: "Nothing to show yet",
    emptyDescription: "The first digest hasn't arrived yet",
    openedOf: (opened: number, shown: number, days: number) =>
      `Opened ${opened} of ${shown} over ${days} ${days === 1 ? "digest" : "digests"}`,
    openedHint:
      "What matters isn't the number itself, but whether it rises top to bottom. If high-scoring stories don't get opened more often, the pick is still guessing.",
    lowData: "Not much data yet",
    lowDataDescription: (shown: number, minSample: number) =>
      `Shown ${shown} ${shown === 1 ? "story" : "stories"}. Numbers get reliable starting around ${minSample}.`,
    quality: {
      title: "Summary quality",
      hint: "The feed scores its own writing. Look at the trend across days, not one number.",
      day: "day",
      mean: "mean",
      repeats: "repeats",
      relevant: "relevant",
      scores: "scores",
    },
    outOf: (x: number, y: number) => `${x} of ${y}`,
    score: {
      title: "Score and opens",
      hint: "The higher the score, the more often it should get opened",
      bucket: (bucket: string) => `score ${bucket}`,
    },
    confidence: {
      title: "How confident the feed was",
      hint: "If confidence doesn't line up with opens, the feed is looking at the wrong thing",
      bucket: (bucket: string) => `confidence ${bucket}`,
    },
    axis: {
      hint: "Showing what came up at least three times",
      kind: {
        fact: "fact",
        forecast: "forecast",
        opinion: "opinion",
        announcement: "announcement",
        reprint: "reprint",
      } as Record<string, string>,
      horizon: {
        years: "years",
        months: "months",
        noise: "noise",
      } as Record<string, string>,
      other: "other",
    },
  },
};
