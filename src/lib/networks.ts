/**
 * Площадки блогера: куда он публикует и откуда мы читаем его текст.
 *
 * Данными, а не ветками в коде. Таб в мотатке, предел длины, требование
 * в промпте и ссылка «открыть в сети» обязаны брать сеть из одного места:
 * разъедутся — появится таб, для которого промпт не писал ничего отдельного,
 * и в X уедет текст телеграмной длины. Отказ при этом будет выглядеть как
 * успех: пост есть, он даже хороший, просто не влезает.
 *
 * Читать можно не всё, и это свойство сети, а не настройка. Публичный канал
 * в Telegram и RSS блога отдаются кому угодно, твиты — за деньги через
 * twitterapi.io, а LinkedIn и Threads наружу не отдают ничего: оттуда голос
 * берётся только вставленным текстом.
 */

export const NETWORK_IDS = ["telegram", "x", "linkedin", "threads", "blog"] as const;
export type NetworkId = (typeof NETWORK_IDS)[number];

export type Network = {
  id: NetworkId;
  label: string;
  /**
   * Есть ли таб в мотатке. У блога его нет: блог — источник голоса,
   * а не сеть, куда жмут «поделиться».
   */
  tab: boolean;
  /** Сколько символов влезает в пост. */
  limit: number;
  /** Что вписывает читатель. Пусто — вписывать нечего, сеть только для таба. */
  handle: string | null;
  /** Читаем ли оттуда его тексты для карточки автора. */
  readable: boolean;
  /** Требование к тексту для этой сети. Уходит в промпт как есть. */
  rule: string;
  /**
   * Куда ведёт «открыть в сети». Не у всех это подставляет текст: LinkedIn
   * подставляет не всегда, Threads обрезает. Поэтому главное действие
   * в мотатке — «скопировать», а ссылка стоит рядом второй.
   */
  intent: ((text: string, url: string) => string) | null;
};

export const NETWORKS: Record<NetworkId, Network> = {
  telegram: {
    id: "telegram",
    label: "Telegram",
    tab: true,
    limit: 900,
    handle: "@канал или t.me/канал",
    readable: true,
    rule: `telegram: как он пишет в канал, 400–900 символов. Абзацы пустой строкой.
Разметка и место ссылки — как у него: если он ставит ссылку последней строкой,
ставь последней строкой.`,
    intent: (text, url) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  x: {
    id: "x",
    label: "X",
    tab: true,
    limit: 280,
    handle: "@ник",
    readable: true,
    rule: `x: до 280 символов вместе со ссылкой, и ссылка считается за 23 символа,
какой бы длины она ни была. Одна мысль, без «тред» и без нумерации. Хэштеги —
только если он сам их ставит.`,
    intent: (text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    tab: true,
    limit: 1300,
    // Ленту LinkedIn наружу не отдаёт вовсе: ни фида, ни публичной страницы
    // постов. Ник спрашивать незачем — читать по нему всё равно нечего.
    handle: null,
    readable: false,
    rule: `linkedin: 700–1300 символов. Первые 140 символов видны до «ещё» —
в них должно попасть то, ради чего пост открывают. Дальше абзацы по 2–3
предложения. Списки и эмодзи-маркеры — только если он сам так пишет.`,
    intent: (text) =>
      `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`,
  },
  threads: {
    id: "threads",
    label: "Threads",
    tab: true,
    limit: 500,
    handle: null,
    readable: false,
    rule: `threads: до 500 символов, разговорнее, чем в остальных сетях.
Ссылку ставь в конце отдельной строкой.`,
    intent: (text) => `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`,
  },
  blog: {
    id: "blog",
    label: "Блог",
    tab: false,
    limit: 0,
    handle: "адрес RSS или сайта",
    readable: true,
    rule: "",
    intent: null,
  },
};

export const networkOf = (id: string): Network | null =>
  NETWORKS[id as NetworkId] ?? null;

/** Табы в мотатке: сети, которые читатель добавил, в порядке справочника. */
export const tabsOf = (added: string[]): Network[] =>
  NETWORK_IDS.map((id) => NETWORKS[id]).filter(
    (network) => network.tab && added.includes(network.id),
  );

/** Откуда можно прочитать его тексты: только добавленное и только читаемое. */
export const readableOf = (added: string[]): Network[] =>
  NETWORK_IDS.map((id) => NETWORKS[id]).filter(
    (network) => network.readable && added.includes(network.id),
  );

/**
 * Ссылка в X съедает 23 символа независимо от длины (t.co), поэтому длина
 * считается не `text.length`. Считать её честной длиной — значит отдать
 * читателю пост, который X откажется принять, и узнает он об этом сам.
 */
export function postLength(network: Network, text: string): number {
  if (network.id !== "x") return text.length;
  return text.replace(/https?:\/\/\S+/g, "х".repeat(23)).length;
}

export const overLimit = (network: Network, text: string): boolean =>
  network.limit > 0 && postLength(network, text) > network.limit;
