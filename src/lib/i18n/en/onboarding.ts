/**
 * Строки области «onboarding»: мастер первого захода, вход, «Мои площадки»
 * и «Своё мнение». Английский задаёт форму, русский её повторяет.
 */
/** Сколько сборка занимает обычно: замер, а не осторожная оценка.
 *  По нему решается, повторять ли обещание, которое уже не сбылось. */
const USUAL_SECONDS = 40;

export const onboarding = {
  wizard: {
    sourceWhyItems: (n: number): string => `${n} ${n === 1 ? "story" : "stories"} a month`,
    steps: ["Interests", "Sources", "Feed"],
    counter: (picked: number, limit: number) => `${picked} of ${limit}`,
    // Кнопка называет, куда ведёт: «Next» трижды подряд не говорит ничего,
    // а читается она отдельно от заголовка, уже забытого.
    toSources: "To sources",
    toFeed: "To the feed",
    saveError: "Your setup didn't save. Try again.",
    interests: {
      title: "What to follow",
      lead: (maxTopics: number) =>
        `Pick up to ${maxTopics} — that's what I'll collect by. Change your mind any day.`,
      customLabel: "Custom interest",
      customPlaceholder: "In your own words: e.g. fintech in Brazil",
      add: "Add",
      more: (n: number) => `${n} more ${n === 1 ? "interest" : "interests"}`,
      full: (planLabel: string, maxTopics: number) =>
        `${maxTopics} is the whole ${planLabel} set. More interests are in Subscription.`,
    },
    sources: {
      title: "Where to read from",
      lead: (topics: string[]) =>
        `Picked for your ${topics.length > 1 ? "interests" : "interest"}: ${topics.join(", ")}. Remove what you don't need, add your own — paste a link above.`,
      full: (planLabel: string, maxSources: number) =>
        `I read ${maxSources} ${maxSources === 1 ? "source" : "sources"} — that's the whole ${planLabel} plan. Remove one to add another.`,
      addPlaceholder: "Link to a blog, channel or newsletter",
      add: "Add",
      checking: "Checking the link…",
      addedWhy: (fresh: number) => `${fresh} fresh ${fresh === 1 ? "entry" : "entries"}`,
      displaced: (label: string) => `Unchecked “${label}” to make room for yours`,
    },
    ready: {
      buildingTitle: "Building your first digest",
      readyTitle: (added: number) => `${added} ${added === 1 ? "story" : "stories"} for today`,
      emptyTitle: "Your feed is set up",
      buildingLead: "Picking from what came in overnight and writing the summaries.",
      readyLead: (everyOtherDay: boolean) =>
        `From now on, your digest arrives ${everyOtherDay ? "every other day" : "every night"}; the link is in the bot.`,
      openFeed: "Open feed",
      dontClose: "Don't close this tab.",
      elapsed: (seconds: number) =>
        seconds > USUAL_SECONDS ? `${seconds}s. Longer than usual, still going.` : `${seconds}s. Usually under forty.`,
      noFreshItems: "No fresh stories for your topics yet — I'll build one tonight.",
      buildFailed: "Couldn't build the first digest — I'll try again tonight.",
      byTopics: (topics: number) =>
        `Picked across your ${topics} ${topics === 1 ? "interest" : "interests"} from everything that came in overnight.`,
    },
  },
  login: {
    linkExpired: "The link has expired — ask the bot for a new one",
    tagline: "The bot sends you a link — and news every morning",
    viaTelegram: "Sign in with Telegram",
    botHintBefore: "Message the bot ",
    botHintAfter: " — it'll send you a feed link. It's valid for 10 minutes.",
    passwordLabel: "Password",
    signIn: "Sign in",
    signInWithPassword: "Sign in with a password",
  },
  channels: {
    lastStepTitle: "Last step: social networks",
    // Две разные вещи, и раньше они стояли в одном списке: где он публикует
    // (галочка даёт таб в черновике) и откуда мы читаем его тексты (ссылка
    // или вставленные посты). Теперь это два блока, и каждый назван тем,
    // на что отвечает, — «мои площадки» не отвечало ни на один из вопросов.
    postingTitle: "Social networks",
    postingDescription:
      "Tick the networks you post to. Each one gets its own tab in a draft, written to its own length and shape.",
    charLimit: (limit: number) => `up to ${limit} characters`,
    publishingIn: (network: string) => `Posting to ${network}`,
    sourcesTitle: "Let us read your posts",
    sourcesDescription:
      "A draft sounds like you once the feed has read a dozen of your posts. A public Telegram channel, an RSS blog and an X account are read from a link. LinkedIn and Threads expose nothing — paste posts from there as text. The ticks above don't affect reading: they say where you post.",
    addPlaceholder: "t.me/channel, x.com/handle, or your blog's address",
    add: "Add",
    addDescription:
      "The address goes through the same check as sources: only something that answered with at least one post gets saved.",
    readingFrom: "Read from",
    pasteTitle: "Or paste posts as text",
    stopReading: (network: string) => `Stop reading ${network}`,
    toFeed: "Go to feed",
    voiceTitle: "How you write",
    voiceDescription:
      "Structure is which blocks your post is built from and how you open it; then rhythm, person, length, emoji, where the link goes. Structure matters more: a post in your words but built like a news brief reads as someone else's from the first line. Two or three of your posts go into the prompt whole — as a sample, not as facts.",
    rebuildVoice: "Read my posts again",
    added: (label: string) => `Added: ${label}`,
    rebuildHint: "Read your posts again so the feed takes them in",
    builtToast: (builtFrom: number) => `Read ${builtFrom} ${builtFrom === 1 ? "post" : "posts"}`,
    builtWithViews: "View counts included: your best-post frame comes from them",
    builtWithoutStats: "No stats for these posts. We got how you write, but no frame",
    builtSummary: (ago: string, builtFrom: number, ranked: boolean, hasStructure: boolean) =>
      `Read ${builtFrom} ${builtFrom === 1 ? "post" : "posts"} ${ranked ? "with view counts" : "without stats"} · ${ago}${hasStructure ? "" : " — no structure yet, read again"}`,
    notBuiltYet: "Nothing read yet: drafts are written from your delivery settings",
    noFrameTitle: "No frame yet",
    noFrameDescription:
      "There's no view data for the posts we read, so we don't know what makes your best posts different from the rest — and the feed won't make that up. Add a public Telegram channel or an X account: view counts are visible there.",
    structureTitle: "Post structure",
    hooksTitle: "How you open",
    voiceListTitle: "Tone and rhythm",
    frameTitle: "Frame of your best posts",
    tabooTitle: "What you never do",
    samplePlaceholder:
      "Paste 3 of your posts, separated by a blank line.\n\nNeeded for LinkedIn and Threads: we can't read posts from there.",
    sampleDescription:
      "Posts are separated by a blank line. Pasted posts have no view counts, so they show how you write but not which posts worked.",
    save: "Save",
    saved: "Saved",
    savedDescription: "Read your posts again",
  },
  opinionDialog: {
    title: "Your take",
    hook: (text: string) => `Hook: ${text}`,
    writing: "Writing in your voice — this takes a few seconds",
    failedTitle: "Couldn't write it",
    voiceNotBuiltTitle: "We haven't read your posts yet",
    voiceNotBuiltDescription:
      "This was written from your delivery settings, not from your posts. Let us read your posts under Post drafts — then the draft will sound like you.",
    checkBeforePublishTitle: "Check before you publish",
    addedBeyondSource: "Added beyond the source:",
    variant1: "Variant 1",
    variant2: "Variant 2",
    noDraftForNetwork: "The model didn't return anything for this network — try again.",
    unverifiedTitle: "Numbers not in the source",
    unverifiedDescription: (list: string) => `${list} — check them against the source or remove them.`,
    counter: (length: number, limit: number) => `${length} of ${limit}`,
    xLinkNote: " (a link counts as 23)",
    openIn: (network: string) => `Open in ${network}`,
    copy: "Copy",
    copied: "Copied",
    clipboardDenied: "Browser blocked clipboard access",
    clipboardDeniedDescription: "Text is selected — press ⌘C",
  },
  networks: {
    telegram: "Telegram",
    x: "X",
    linkedin: "LinkedIn",
    threads: "Threads",
    blog: "Blog",
  },
  /**
   * Витрина стартовых интересов (`src/lib/starter-topics.ts`): слаги там же
   * общие, а label и hint — то, что видит глаз, и это единственное, что
   * переводится. Ключ здесь — тот же slug.
   */
  starterTopics: {
    "ai-infra": {
      label: "Artificial intelligence",
      hint: "models, chips, data centers, inference, training, agents, LLM developer tools",
    },
    programming: {
      label: "Engineering",
      hint: "languages and runtimes, architecture, library releases, engineering practices, infrastructure, open source",
    },
    design: {
      label: "Design and product",
      hint: "product design, user research, interfaces, product management, product growth",
    },
    startups: {
      label: "Startups and VC",
      hint: "funding rounds, valuations, exits, funds, hiring and layoffs, young companies' business models",
    },
    energy: {
      label: "Energy",
      hint: "nuclear power, uranium and its mining, power grids, energy demand from data centers, oil and gas",
    },
    climate: {
      label: "Climate",
      hint: "emissions, warming, climate policy, adaptation, weather anomalies, carbon markets",
    },
    blockchain: {
      label: "Blockchain",
      hint: "cryptocurrencies, DeFi, stablecoins, on-chain infrastructure, regulation",
    },
    economy: {
      label: "Economy and markets",
      hint: "rates and inflation, labor and housing markets, trade and tariffs, macroeconomic data, economists' analysis",
    },
    science: {
      label: "Science",
      hint: "physics, math, chemistry, research and preprints, scientific instruments and experiments",
    },
    space: {
      label: "Space",
      hint: "launches and rockets, satellites and constellations, interplanetary missions, space telescopes, the space industry",
    },
    biotech: {
      label: "Biotech",
      hint: "clinical trials, drug approvals, genomics, pharma as an industry, biotech companies",
    },
    "mental-health": {
      label: "Therapy",
      hint: "evidence-based therapy, clinical research, psychiatry, tools for therapists, burnout",
    },
    health: {
      label: "Health",
      hint: "nutrition, sleep, exercise, evidence-based medicine for everyday life, aging and lifespan extension",
    },
    security: {
      label: "Security",
      hint: "breaches and hacks, vulnerabilities, privacy and surveillance, cryptography, supply chain security",
    },
    hardware: {
      label: "Gadgets",
      hint: "CPUs and GPUs, phones and laptops, wearables, chip manufacturing, hardware reviews",
    },
    games: {
      label: "Games",
      hint: "game releases and updates, studios and their business, game development, consoles, esports",
    },
    cinema: {
      label: "Film and TV",
      hint: "premieres and trailers, streaming platforms, studios and box office, festivals and awards, reviews",
    },
    music: {
      label: "Music",
      hint: "album releases, artists and labels, streaming economics, tours and festivals, reviews",
    },
    books: {
      label: "Books",
      hint: "new releases, publishers, writers and awards, reviews and essays, the history of ideas",
    },
    sport: {
      label: "Sport",
      hint: "matches and tournaments, player transfers, sports science and injuries, money in sport",
    },
    food: {
      label: "Food",
      hint: "recipes and cooking technique, restaurants and chefs, food production, food culture, drinks",
    },
    travel: {
      label: "Travel",
      hint: "airlines and miles, hotels, visas and entry rules, destinations and routes",
    },
    demography: {
      label: "Society",
      hint: "birth rates, aging, migration, country populations, long-term social shifts",
    },
    politics: {
      label: "Politics",
      hint: "international relations, elections and governments, conflicts, sanctions and trade wars, tech regulation",
    },
    education: {
      label: "Education",
      hint: "school and university, online learning, AI in education, learning research, education policy",
    },
    transport: {
      label: "Transport",
      hint: "EVs and charging networks, self-driving, trains and transit, aviation, logistics",
    },
    media: {
      label: "Media",
      hint: "publishers and their economics, social platforms, journalism, advertising, AI in content production",
    },
    career: {
      label: "Career",
      hint: "hiring and layoffs, salaries and levels, interviews, remote work, burnout, the job market in an industry",
    },
    money: {
      label: "Personal finance",
      hint: "saving and investing for yourself, mortgages and loans, taxes, retirement, household budget",
    },
    parenting: {
      label: "Parenting",
      hint: "pregnancy and birth, child development, school and daycare, teenagers, research on raising kids",
    },
    cars: {
      label: "Cars",
      hint: "new models and road tests, carmakers and their plants, prices and the market, motorsport",
    },
  } as Record<string, { label: string; hint: string }>,
};
