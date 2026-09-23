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
  // Подпись сети — не здесь: она видна глазу, и живёт в словаре интерфейса
  // (`onboarding.networks`), а не в этой таблице бизнес-логики и промптов.
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
    tab: true,
    // Две длины, а не одна средняя: на чужом материале пост короче 300 знаков
    // попадает в верхний тир каналов так же часто, как длинный (36% против
    // 33%), и берёт реакциями, а 900–1 500 — пересылками (41%). Хуже всех
    // 300–900, где стоял прежний предел. Замер — `news-take`, 304 поста.
    limit: 1500,
    handle: "@канал или t.me/канал",
    readable: true,
    rule: `telegram: как он пишет в канал. Первый вариант — реакция до 300 символов:
первая строка — вердикт, с которым можно поспорить (не «вау»), вторая — факт
из материала, дальше ссылка. Второй вариант — разбор на 900–1500 символов.
Середины 300–900 не бывает. Абзацы пустой строкой. Разметка и место ссылки —
как у него: если он ставит ссылку последней строкой, ставь последней строкой.`,
    intent: (text, url) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  x: {
    id: "x",
    tab: true,
    limit: 280,
    handle: "@ник",
    readable: true,
    // Открытый код ленты X ранжирует ответ и репост в десятки раз выше лайка,
    // а пост со ссылкой наружу показывает реже: X теряет читателя на переходе.
    rule: `x: до 280 символов вместе со ссылкой, и ссылка считается за 23 символа,
какой бы длины она ни была. Вердикт одной мыслью, на который хочется ответить;
пересказ не нужен. Ссылка последней строкой — автор унесёт её ответом к посту.
Без «тред» и без нумерации. Хэштеги — только если он сам их ставит.`,
    intent: (text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
  },
  linkedin: {
    id: "linkedin",
    tab: true,
    limit: 1300,
    // Ленту LinkedIn наружу не отдаёт вовсе: ни фида, ни публичной страницы
    // постов. Ник спрашивать незачем — читать по нему всё равно нечего.
    handle: null,
    readable: false,
    // LinkedIn сильнее всего мерит время чтения и комментарии, а ссылка
    // в теле режет охват (медиана −18.8% на 1,3 млн постов). Реакций-возгласов
    // здесь не бывает: короткий пост без пользы читается шумом.
    rule: `linkedin: 700–1300 символов, оба варианта — разбор. Первые 140 символов
видны до «ещё» — в них вывод, а не повод: «Нанимать в ЕС станет дороже на 12%.
Вот почему.» Дальше абзацы по одно-два предложения. Источник назван словами,
ссылка — в самом конце. Последняя строка — конкретный вопрос к узкому кругу:
«Кто нанимал в Польше в этом году — вилка выросла?», а не «что думаете?».
Списки и эмодзи-маркеры — только если он сам так пишет.`,
    intent: (text) =>
      `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`,
  },
  threads: {
    id: "threads",
    tab: true,
    limit: 500,
    handle: null,
    readable: false,
    // Ответы весят сильнее лайков, первые полчаса решают, покажут ли пост
    // дальше подписчиков (Mosseri и вендорские замеры, своих нет).
    rule: `threads: до 500 символов, разговорнее всех — как сказал бы вслух.
Первый вариант — реакция, второй — «меня задело». Последняя строка — вопрос,
на который отвечают одним словом или своим примером. Ссылку ставь в конце
отдельной строкой.`,
    intent: (text) => `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`,
  },
  blog: {
    id: "blog",
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

/**
 * Сети, отмеченные «публикую здесь».
 *
 * Строка площадки без отметки — это адрес, который мы читаем ради голоса,
 * а не таб в черновике: два разных ответа с тех пор, как снятая галочка
 * перестала уносить адрес с собой (0058).
 */
export const publishedIn = (channels: { network: string; publishes: boolean }[]): string[] =>
  channels.filter((channel) => channel.publishes).map((channel) => channel.network);

/**
 * Язык постов по сетям — из строк площадок. Пустой язык не попадает
 * в ответ: он означает «как в стиле», и называть его в промпте нечем.
 */
export const languagesOf = (
  channels: { network: string; language?: string | null }[],
): Partial<Record<NetworkId, string>> =>
  Object.fromEntries(
    channels
      .filter((channel) => channel.language && NETWORK_IDS.includes(channel.network as NetworkId))
      .map((channel) => [channel.network, channel.language as string]),
  );

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
