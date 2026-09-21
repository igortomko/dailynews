/** Строки области «sources». Английский задаёт форму, русский её повторяет. */
export const sources = {
  /** Статус источника под его строкой — troubleOf/yieldOf в manager.tsx. */
  health: {
    added: "added, first stories arrive tonight",
    noNews: "no stories in 30 days",
    notInDigest: "no story reached a digest in 30 days",
    summary: (items: number, inDigests: number) =>
      `in 30 days: ${items} → ${inDigests} in digests`,
    opened: (n: number) => `${n} opened`,
    score: (value: number) => `score ${value}`,
    duplicatesPercent: (percent: number) => `${percent}% duplicates`,
  },
  /** Баннеры сломанных и молчащих источников наверху страницы. */
  banners: {
    errorTitle: (n: number) => `Sources with errors: ${n}`,
    quietTitle: (n: number) => `Quiet but alive: ${n}`,
    andMore: (n: number) => `and ${n} more`,
    quietDays: (n: number) => `${n}d`,
    quietExplain: (days: number) =>
      `the source is alive and responding, but hasn't posted anything new for ${days} days straight. Usually means it's been abandoned.`,
  },
  /** Карточка «Добавить источник» — поле ссылки до разбора. */
  addForm: {
    title: "Add a source",
    linkLabel: "Link to a source",
    placeholder: "https://www.youtube.com/@channel",
    hint: "Paste a link to a site, blog, YouTube channel, or Telegram channel",
    checking: "Checking…",
    add: "Add",
  },
  /** Карточка разобранного источника — подтверждение перед добавлением. */
  found: {
    nameLabel: "Source name",
    stats: (via: string, fresh: number, entries: number) =>
      `${via} · ${fresh} fresh out of ${entries}`,
    lastEntry: (sample: string) => `latest entry: ${sample}`,
    stale: "There are stories, but they're all old. Looks like this source was abandoned.",
    add: "Add",
    cancel: "Cancel",
  },
  /** Предупреждение, когда разобранный источник — X не по тарифу. */
  paywall: {
    xTitle: (planLabel: string) => `X posts are only on the ${planLabel} plan`,
    xBody: (label: string) =>
      `Found: ${label}. X charges for access to posts, so it's Pro only.`,
  },
  /** Карточка «Что убрать». */
  cleanup: {
    title: "What to remove",
    description: "These sources sat idle for a month.",
    remove: "Remove",
    removeAria: (label: string) => `Remove ${label} from the feed`,
    itemsPerMonth: (n: number) => `${n} ${n === 1 ? "story" : "stories"} this month`,
    shownOpened: (shown: number, opened: number) => `${shown} shown, ${opened} opened`,
    mostlyDuplicates: (n: number) => `${n} ${n === 1 ? "duplicate" : "duplicates"}`,
  },
  /** Основной список источников. */
  list: {
    title: "Sources",
    count: (used: number, max: number, planLabel: string) =>
      `${used} of ${max} on the ${planLabel} plan`,
    emptyTitle: "No sources yet",
    emptyDescription:
      "Paste a link above: a blog, channel, or newsletter. With no sources, there's nothing to build a digest from.",
    removeAria: (label: string) => `Remove ${label} from the feed`,
    removeTooltip: "Remove from the feed, you can undo it",
    error: "error",
    quietBadge: (n: number) => `quiet ${n}d`,
    quietTooltip: (days: number) =>
      `Responding, but hasn't posted anything new for ${days} days straight`,
    lastCountAria: (n: number) => `Stories that arrived last night: ${n}`,
    lastCountTooltip: (yieldText: string) => `Arrived last night · ${yieldText}`,
  },
  toast: {
    removed: (label: string) => `${label} removed from the feed`,
    undo: "Undo",
    added: "Source added",
    alreadyAdded: "This source was already in the list",
  },
  /** src/lib/sources.ts: denyForKind/addByLink — предел по числу и пустой ввод. */
  tooManySources: (planLabel: string, max: number) =>
    `The ${planLabel} plan checks ${max} sources — remove one first`,
  emptyLink: "Empty message",
};
