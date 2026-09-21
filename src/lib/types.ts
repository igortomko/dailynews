import type { Names } from "./rules";

/** Общий справочник: по нему Jev классифицирует поток один раз на всех. */
export type Topic = {
  id: number;
  slug: string;
  label: string;
  hint: string;
  /** Цель по умолчанию для читателя, который добавляет тему из каталога. */
  weight: number;
  position: number;
  active: boolean;
};

/** Тема в ленте конкретного читателя: вес здесь — его цель по числу новостей. */
export type ReaderTopic = {
  id: number;
  slug: string;
  label: string;
  hint: string;
  weight: number;
  position: number;
};

export type Source = {
  id: number;
  kind: "rss" | "hackernews" | "reddit" | "x" | "telegram" | "email";
  label: string;
  url: string;
  config: Record<string, unknown>;
  active: boolean;
  /** Что вставил человек, до разбора. url — уже разрешённый адрес фида. */
  input_url: string | null;
  last_ok_at: string | null;
  last_count: number | null;
  last_error: string | null;
  /** С какого момента источник отвечает и не даёт ни одной свежей записи. */
  silent_since: string | null;
  /** Убран из ленты. История остаётся, отмена возвращает как было. */
  deleted_at: string | null;
};

/** Сырой материал до скоринга. */
export type RawItem = {
  url: string;
  /**
   * Чем дедупить, если адрес для этого не годится. У письма «посмотреть
   * в браузере» одинаков во всех выпусках рассылки, а Message-ID уникален
   * по RFC. Пусто — канонизируется адрес, как у всех остальных.
   */
  canon?: string;
  title: string;
  excerpt: string;
  /**
   * Полный текст, если фид его отдал (content:encoded у Substack
   * и WordPress). HTML как есть: чистит его тот же defuddle, что и
   * скачанную страницу. Пусто — статью придётся забирать по ссылке.
   */
  body?: string;
  points: number | null;
  comments: number | null;
  /**
   * Просмотры, если площадка их показывает. Читает это только карточка
   * автора: ей нужно отличить его удачный пост от среднего, и просмотры —
   * единственное число, которое `t.me/s/` отдаёт бесплатно.
   *
   * В скоринг не уходит: там про материал спрашивают `points`, и подмена
   * смысла колонки поменяла бы вопрос Jev для всех telegram-источников
   * сразу, а числа до и после такой правки несравнимы.
   */
  views?: number | null;
  published_at: Date | null;
};

export const KINDS = ["fact", "forecast", "opinion", "announcement", "reprint"] as const;
export type Kind = (typeof KINDS)[number];

export const HORIZONS = ["noise", "months", "years"] as const;
export type Horizon = (typeof HORIZONS)[number];

/**
 * С какой вероятности кликбейта карточка получает метку. Это правило
 * классификации, а не оформление: ниже метка горела бы на каждой второй
 * карточке и перестала бы что-либо значить. Лежит рядом с осями, а не
 * в странице, чтобы вторая метка по той же оси не завела второй порог.
 */
export const CLICKBAIT_LABEL_NOUL = 0.6;

/** Ответы Jev по одному материалу, как они ложатся в scores.axes. */
export type Axes = {
  topic: { choice: string; confidence: number; probabilities: Record<string, number> };
  kind: { choice: Kind; confidence: number; probabilities: Record<string, number> };
  horizon: { choice: Horizon; confidence: number; probabilities: Record<string, number> };
  novelty: { score: number; max: number; confidence: number };
  specifics: { score: number; max: number; confidence: number };
  depth: { score: number; max: number; confidence: number };
  actionable: { noul: number };
  clickbait: { noul: number };
};

export type Weights = {
  topic: number;
  novelty: number;
  specifics: number;
  actionable: number;
  horizon: number;
  kind: number;
  clickbait: number;
  depth: number;
};

/**
 * Веса по умолчанию. Обязаны совпадать с jsonb-дефолтом readers.weights:
 * расхождение проверяет npm run verify:db. Ими же считается scores.total —
 * скор каталога, от которого персональный отличается ровно весами.
 */
export const DEFAULT_WEIGHTS: Weights = {
  topic: 40, novelty: 20, specifics: 20, actionable: 10,
  horizon: 10, kind: 25, clickbait: -30, depth: 15,
};

export type Reader = {
  id: number;
  /** Приходит из драйвера строкой: bigint. Сравнивать только в SQL. */
  telegram_id: string | null;
  username: string | null;
  owner: boolean;
  reader_context: string;
  reading_v2_enabled: boolean;
  /**
   * Сколько минут чтения заказано. Карточек столько, сколько уложится
   * в это время: перевод делает `itemsForMinutes` по длине уже написанных
   * описаний этого читателя.
   */
  digest_minutes: number;
  language: string;
  /** Язык интерфейса: `en` или `ru`. Отдельно от языка выпуска. */
  ui_language: string;
  /** 1 — объясняй с нуля, 5 — пиши как специалисту. Уходит в промпт дайджеста. */
  complexity: number;
  /** Манера письма. Незнакомое значение читается как «нейтральный». */
  style: string;
  weights: Weights;
  /** Адрес @kindle.com. Пусто — на читалку не уходит ничего. */
  kindle_address: string | null;
  /**
   * Слать ли на читалку сам выпуск. Адресом пользуется и ручная отправка
   * отдельной статьи, поэтому «не присылай выпуск» — это переключатель,
   * а не стёртый адрес.
   */
  kindle_digest: boolean;
  /**
   * Читатель подтвердил, что добавил наш обратный адрес в список одобренных
   * Amazon. Снаружи это не проверяется ничем: неодобренное письмо
   * отбрасывается молча. Пока false — обратный адрес ещё можно менять.
   */
  kindle_approved: boolean;
  /** Локальная часть обратного адреса. Выдаётся один раз и заморожена. */
  kindle_sender: string | null;
  /** Тариф: пределы по источникам, интересам и размеру выпуска (src/lib/plans.ts).
   *  Персонален, как и всё остальное здесь: у каждого читателя свой. */
  plan: string;
  daily_cap_usd: number;
  /** Подписка Lemon Squeezy. Пусто — читатель никогда не платил. */
  subscription_id: string | null;
  /** Их статус: active, on_trial, paused, past_due, cancelled, expired. */
  subscription_status: string | null;
  plan_renews_at: string | null;
  /** Докуда работает отменённая подписка. Оплаченный месяц дочитывается. */
  plan_ends_at: string | null;
  /** Их страница управления: смена карты, отмена, возобновление. */
  portal_url: string | null;
  /** Пусто — лента идёт. Время — с какого момента выпуск не пишется. */
  paused_at: string | null;
  /** Когда спросили «продолжать?»: без отметки вопрос уходил бы каждую ночь. */
  sleep_asked_at: string | null;
  /** Читатель попросил вернуть ленту с этого числа: отпуск, а не уход. */
  resume_at: string | null;
  /** Описание из профиля Telegram. Только для порядка стартовых интересов. */
  bio: string | null;
  /** Стартовые интересы по убыванию близости к bio. Пусто — обычный порядок. */
  suggested_topics: string[];
  /** Когда прошёл проверку подписки на канал. Пусто — ещё не проходил. */
  channel_checked_at: string | null;
  onboarded_at: string | null;
  /**
   * Карточка автора: голос, каркас удачных постов, табу. Пусто — ни одного
   * его текста ещё не читали, и пост пишется настройками подачи.
   */
  voice_card: VoiceCardRow | null;
  voice_built_at: string | null;
  /** Посты, вставленные руками: LinkedIn и Threads наружу не отдают ничего. */
  voice_sample: string;
  /**
   * За чем следить: написания одного объекта на правило (`src/lib/rules.ts`).
   * Личное и дешёвое: применяется в отборе как порядок внутри очереди темы,
   * в вопрос Jev не уходит, справочник тем не расширяет.
   */
  follow_rules: Names[];
  /**
   * Что исключать: совпадение снимает материал с отбора и с показа.
   * Сильнее слежения: материал с упомянутым и исключённым разом не показывается.
   */
  exclude_rules: Names[];
};

/**
 * Карточка автора так, как она лежит в jsonb. Полная форма и её сборка —
 * в `pipeline/voice-card.ts`; здесь только то, что читает интерфейс.
 */
export type VoiceCardRow = {
  voice: string[];
  /** Из каких блоков собран его пост и в каком порядке. */
  structure: string[];
  /** Чем он открывает пост — его набор приёмов с примерами. */
  hooks: string[];
  /** Два-три его поста целиком: образец формы для промпта. */
  samples: string[];
  frame: string[];
  taboo: string[];
  built_from: number;
  sources: string[];
  ranked: boolean;
};

/** Площадка читателя: откуда читаем его текст и куда он публикует. */
export type ReaderChannel = {
  network: string;
  /** Пусто у сетей, которые наружу ничего не отдают. */
  handle: string | null;
  /** Что вставил человек: в списке показывается это, а не адрес фида. */
  input_url: string | null;
  label: string | null;
  created_at: string;
};
