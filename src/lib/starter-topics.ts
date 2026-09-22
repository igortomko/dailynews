/**
 * С чего начинает новый читатель: интересы и первые источники под них.
 *
 * Файл, а не таблица: это предложение продукта, а не настройка читателя, —
 * тот же довод, по которому в коде живут тарифы. Выбранный интерес уезжает
 * в общий справочник `topics` и дальше живёт там; здесь остаётся только
 * витрина, с которой его выбрали.
 *
 * Пустой экран — худшее, что можно показать человеку, который только что
 * согласился что-то настроить: «добавьте интересы» ничего не говорит о том,
 * какие интересы бывают и сколько их брать. Поэтому на первом шаге лежит
 * готовый набор, а не поле ввода.
 *
 * `related` — почему набор копится быстро. Выбрал «ИИ» — рядом всплывают
 * «Разработка» и «Железо»: пять интересов набираются пятью нажатиями,
 * а не пятью попытками вспомнить, что тебе вообще интересно.
 *
 * Слаги совпадают с теми, что уже лежат в справочнике (0003): второй
 * читатель не заводит «AI-инфру» двойником и не переписывает чужую
 * подсказку — этим он менял бы критерий классификации всем сразу.
 *
 * Все фиды проверены живым запросом 19 сентября 2026 тем же `discover()`,
 * которым продукт заводит источник по ссылке. Не ответившие хотя бы одной
 * свежей записью сюда не попали: источник, принятый пустым, через неделю
 * неотличим от заброшенного.
 */
import type { ReaderTopic, Source } from "./types";
import { toSlug } from "./slug";

export type StarterFeed = { kind: Source["kind"]; url: string; label: string };

export type StarterTopic = {
  slug: string;
  label: string;
  /** Уходит в `topics.hint`, а оттуда — в criteria вопроса Jev о теме. */
  hint: string;
  /** Что предложить следующим, когда этот интерес выбран. */
  related: string[];
  /** С чего читать по этой теме. Первые — самые общие. */
  feeds: StarterFeed[];
};

const HN: StarterFeed = { kind: "hackernews", url: "topstories", label: "Hacker News" };

export const STARTER_TOPICS: StarterTopic[] = [
  {
    slug: "ai-infra",
    label: "AI-инфра",
    hint: "модели, чипы, дата-центры, инференс, обучение, агенты, инструменты разработки с LLM",
    related: ["programming", "hardware", "startups", "security"],
    feeds: [
      HN,
      { kind: "rss", url: "https://simonwillison.net/atom/everything/", label: "Simon Willison" },
      { kind: "rss", url: "https://www.latent.space/feed", label: "Latent Space" },
      { kind: "rss", url: "https://openai.com/news/rss.xml", label: "OpenAI" },
      { kind: "rss", url: "https://deepmind.google/blog/rss.xml", label: "Google DeepMind" },
      { kind: "rss", url: "https://huggingface.co/blog/feed.xml", label: "Hugging Face" },
    ],
  },
  {
    slug: "programming",
    label: "Разработка",
    hint: "языки и рантаймы, архитектура, релизы библиотек, инженерные практики, инфраструктура, открытый код",
    related: ["ai-infra", "security", "hardware", "design"],
    feeds: [
      HN,
      { kind: "rss", url: "https://www.infoq.com/feed/", label: "InfoQ" },
      { kind: "rss", url: "https://github.blog/feed/", label: "GitHub Blog" },
      { kind: "rss", url: "https://martinfowler.com/feed.atom", label: "Martin Fowler" },
      { kind: "rss", url: "https://lwn.net/headlines/rss", label: "LWN" },
      { kind: "rss", url: "https://overreacted.io/rss.xml", label: "Overreacted" },
    ],
  },
  {
    slug: "design",
    label: "Дизайн и продукт",
    hint: "продуктовый дизайн, исследования пользователей, интерфейсы, продуктовый менеджмент, рост продукта",
    related: ["programming", "startups", "media"],
    feeds: [
      { kind: "rss", url: "https://www.nngroup.com/feed/rss/", label: "Nielsen Norman Group" },
      { kind: "rss", url: "https://uxdesign.cc/feed", label: "UX Collective" },
      { kind: "rss", url: "https://www.lennysnewsletter.com/feed", label: "Lenny's Newsletter" },
      { kind: "rss", url: "https://stratechery.com/feed/", label: "Stratechery" },
    ],
  },
  {
    slug: "startups",
    label: "Стартапы и венчур",
    hint: "раунды, оценки, выходы, фонды, найм и увольнения в компаниях, бизнес-модели молодых компаний",
    related: ["ai-infra", "economy", "design", "media"],
    feeds: [
      { kind: "rss", url: "https://techcrunch.com/feed/", label: "TechCrunch" },
      { kind: "rss", url: "https://news.crunchbase.com/feed/", label: "Crunchbase News" },
      { kind: "rss", url: "https://sifted.eu/feed", label: "Sifted" },
      { kind: "rss", url: "https://www.saastr.com/feed/", label: "SaaStr" },
      { kind: "rss", url: "https://tomtunguz.com/index.xml", label: "Tomasz Tunguz" },
    ],
  },
  {
    slug: "energy",
    label: "Энергетика и уран",
    hint: "атомная энергетика, уран и его добыча, электросети, спрос на энергию под дата-центры, нефть и газ",
    related: ["climate", "transport", "economy", "demography"],
    feeds: [
      { kind: "rss", url: "https://world-nuclear-news.org/rss", label: "World Nuclear News" },
      { kind: "rss", url: "https://www.utilitydive.com/feeds/news/", label: "Utility Dive" },
      { kind: "rss", url: "https://oilprice.com/rss/main", label: "OilPrice" },
    ],
  },
  {
    slug: "climate",
    label: "Климат",
    hint: "выбросы, потепление, климатическая политика, адаптация, погодные аномалии, углеродные рынки",
    related: ["energy", "science", "demography", "transport"],
    feeds: [
      { kind: "rss", url: "https://www.carbonbrief.org/feed/", label: "Carbon Brief" },
      { kind: "rss", url: "https://grist.org/feed/", label: "Grist" },
    ],
  },
  {
    slug: "blockchain",
    label: "Блокчейн",
    hint: "криптовалюты, DeFi, стейблкоины, ончейн-инфраструктура, регулирование",
    related: ["economy", "security", "startups"],
    feeds: [
      { kind: "rss", url: "https://cointelegraph.com/rss", label: "Cointelegraph" },
      { kind: "rss", url: "https://decrypt.co/feed", label: "Decrypt" },
      { kind: "rss", url: "https://a16zcrypto.com/feed/", label: "a16z crypto" },
    ],
  },
  {
    slug: "economy",
    label: "Экономика и рынки",
    hint: "ставки и инфляция, рынки труда и жилья, торговля и пошлины, макроэкономические данные, разборы экономистов",
    related: ["demography", "politics", "startups", "blockchain"],
    feeds: [
      { kind: "rss", url: "https://www.economist.com/finance-and-economics/rss.xml", label: "The Economist: экономика" },
      { kind: "rss", url: "https://marginalrevolution.com/feed", label: "Marginal Revolution" },
      { kind: "rss", url: "https://www.noahpinion.blog/feed", label: "Noahpinion" },
    ],
  },
  {
    slug: "science",
    label: "Наука",
    hint: "физика, математика, химия, исследования и препринты, научные приборы и эксперименты",
    related: ["space", "biotech", "climate", "health"],
    feeds: [
      { kind: "rss", url: "https://www.quantamagazine.org/feed/", label: "Quanta Magazine" },
      { kind: "rss", url: "https://phys.org/rss-feed/", label: "Phys.org" },
      { kind: "rss", url: "https://www.nature.com/nature.rss", label: "Nature" },
    ],
  },
  {
    slug: "space",
    label: "Космос",
    hint: "запуски и ракеты, спутники и созвездия, межпланетные миссии, космические телескопы, космическая отрасль",
    related: ["science", "hardware", "transport"],
    feeds: [
      { kind: "rss", url: "https://spacenews.com/feed/", label: "SpaceNews" },
      { kind: "rss", url: "https://arstechnica.com/space/feed/", label: "Ars Technica: космос" },
    ],
  },
  {
    slug: "biotech",
    label: "Биотех и лекарства",
    hint: "клинические испытания, одобрения лекарств, геномика, фарма как отрасль, биотехнологические компании",
    related: ["science", "health", "mental-health"],
    feeds: [
      { kind: "rss", url: "https://www.statnews.com/feed/", label: "STAT" },
      { kind: "rss", url: "https://www.nature.com/nbt.rss", label: "Nature Biotechnology" },
    ],
  },
  {
    slug: "mental-health",
    label: "Психотерапия и mental health",
    hint: "доказательная психотерапия, клинические исследования, психиатрия, инструменты для терапевтов, выгорание",
    related: ["health", "science", "demography"],
    feeds: [
      { kind: "rss", url: "https://www.psypost.org/feed", label: "PsyPost" },
      { kind: "rss", url: "https://www.sciencedaily.com/rss/mind_brain/psychology.xml", label: "ScienceDaily: психология" },
    ],
  },
  {
    slug: "health",
    label: "Здоровье и долголетие",
    hint: "питание, сон, физическая нагрузка, доказательная медицина для обычного человека, старение и продление жизни",
    related: ["biotech", "mental-health", "food", "sport"],
    feeds: [
      { kind: "rss", url: "https://peterattiamd.com/feed/", label: "Peter Attia" },
      { kind: "rss", url: "https://www.medpagetoday.com/rss/headlines.xml", label: "MedPage Today" },
    ],
  },
  {
    slug: "security",
    label: "Безопасность",
    hint: "утечки и взломы, уязвимости, приватность и слежка, криптография, безопасность цепочки поставок",
    related: ["programming", "ai-infra", "politics"],
    feeds: [
      { kind: "rss", url: "https://krebsonsecurity.com/feed/", label: "Krebs on Security" },
      { kind: "rss", url: "https://www.schneier.com/feed/atom/", label: "Schneier on Security" },
      { kind: "rss", url: "https://thehackernews.com/feeds/posts/default", label: "The Hacker News" },
    ],
  },
  {
    slug: "hardware",
    label: "Железо и гаджеты",
    hint: "процессоры и видеокарты, телефоны и ноутбуки, носимые устройства, производство чипов, обзоры техники",
    related: ["ai-infra", "games", "transport", "programming"],
    feeds: [
      { kind: "rss", url: "https://www.theverge.com/rss/index.xml", label: "The Verge" },
      { kind: "rss", url: "https://arstechnica.com/feed/", label: "Ars Technica" },
      { kind: "rss", url: "https://www.tomshardware.com/feeds/all", label: "Tom's Hardware" },
    ],
  },
  {
    slug: "games",
    label: "Игры",
    hint: "релизы и обновления игр, игровые студии и их бизнес, геймдев, консоли, киберспорт",
    related: ["hardware", "cinema", "programming"],
    feeds: [
      { kind: "rss", url: "https://www.rockpapershotgun.com/feed", label: "Rock Paper Shotgun" },
      { kind: "rss", url: "https://www.polygon.com/rss/index.xml", label: "Polygon" },
      { kind: "rss", url: "https://www.gamedeveloper.com/rss.xml", label: "Game Developer" },
    ],
  },
  {
    slug: "cinema",
    label: "Кино и сериалы",
    hint: "премьеры и трейлеры, стриминговые платформы, киностудии и сборы, фестивали и награды, рецензии",
    related: ["music", "books", "media"],
    feeds: [
      { kind: "rss", url: "https://variety.com/feed/", label: "Variety" },
      { kind: "rss", url: "https://www.hollywoodreporter.com/feed/", label: "The Hollywood Reporter" },
      { kind: "rss", url: "https://www.indiewire.com/feed/", label: "IndieWire" },
    ],
  },
  {
    slug: "music",
    label: "Музыка",
    hint: "релизы альбомов, музыканты и лейблы, стриминг и его экономика, туры и фестивали, рецензии",
    related: ["cinema", "books", "media"],
    feeds: [
      { kind: "rss", url: "https://pitchfork.com/feed/feed-news/rss", label: "Pitchfork" },
      { kind: "rss", url: "https://www.stereogum.com/feed/", label: "Stereogum" },
      { kind: "rss", url: "https://www.brooklynvegan.com/feed/", label: "BrooklynVegan" },
    ],
  },
  {
    slug: "books",
    label: "Книги",
    hint: "выход книг, издательства, писатели и премии, рецензии и эссе о прочитанном, история идей",
    related: ["cinema", "science", "demography"],
    feeds: [
      { kind: "rss", url: "https://lithub.com/feed/", label: "Lit Hub" },
      { kind: "rss", url: "https://www.themarginalian.org/feed/", label: "The Marginalian" },
      { kind: "rss", url: "https://www.theparisreview.org/blog/feed/", label: "The Paris Review" },
    ],
  },
  {
    slug: "sport",
    label: "Спорт",
    hint: "матчи и турниры, переходы игроков, спортивная наука и травмы, деньги в спорте",
    related: ["health", "media", "travel"],
    feeds: [
      { kind: "rss", url: "https://www.espn.com/espn/rss/news", label: "ESPN" },
      { kind: "rss", url: "https://feeds.bbci.co.uk/sport/rss.xml", label: "BBC Sport" },
    ],
  },
  {
    slug: "food",
    label: "Еда",
    hint: "рецепты и техника готовки, рестораны и шефы, продукты и их производство, гастрономическая культура, напитки",
    related: ["travel", "health", "demography"],
    feeds: [
      { kind: "rss", url: "https://www.eater.com/rss/index.xml", label: "Eater" },
      { kind: "rss", url: "https://www.kingarthurbaking.com/blog/feed", label: "King Arthur Baking" },
    ],
  },
  {
    slug: "travel",
    label: "Путешествия",
    hint: "авиакомпании и мили, отели, визы и правила въезда, направления и маршруты",
    related: ["food", "transport", "sport"],
    feeds: [
      { kind: "rss", url: "https://thepointsguy.com/feed/", label: "The Points Guy" },
      { kind: "rss", url: "https://viewfromthewing.com/feed/", label: "View from the Wing" },
    ],
  },
  {
    slug: "demography",
    label: "Демография",
    hint: "рождаемость, старение, миграция, население стран, долгосрочные социальные сдвиги",
    related: ["economy", "politics", "education", "science"],
    feeds: [
      { kind: "rss", url: "https://ourworldindata.org/atom.xml", label: "Our World in Data" },
      { kind: "rss", url: "https://www.pewresearch.org/feed/", label: "Pew Research Center" },
      { kind: "rss", url: "https://www.worksinprogress.news/feed", label: "Works in Progress" },
    ],
  },
  {
    slug: "politics",
    label: "Мир и политика",
    hint: "международные отношения, выборы и правительства, конфликты, санкции и торговые войны, регулирование технологий",
    related: ["demography", "economy", "security", "media"],
    feeds: [
      { kind: "rss", url: "https://www.economist.com/international/rss.xml", label: "The Economist: мир" },
      { kind: "rss", url: "https://foreignpolicy.com/feed/", label: "Foreign Policy" },
    ],
  },
  {
    slug: "education",
    label: "Образование",
    hint: "школа и университеты, онлайн-обучение, ИИ в учёбе, исследования об обучении, образовательная политика",
    related: ["demography", "science", "ai-infra"],
    feeds: [
      { kind: "rss", url: "https://www.edsurge.com/articles_rss", label: "EdSurge" },
      { kind: "rss", url: "https://hechingerreport.org/feed/", label: "The Hechinger Report" },
    ],
  },
  {
    slug: "transport",
    label: "Транспорт и электромобили",
    hint: "электромобили и зарядная сеть, автопилот, поезда и городской транспорт, авиация, логистика",
    related: ["energy", "hardware", "travel"],
    feeds: [
      { kind: "rss", url: "https://electrek.co/feed/", label: "Electrek" },
      { kind: "rss", url: "https://insideevs.com/rss/articles/all/", label: "InsideEVs" },
      { kind: "rss", url: "https://www.railwaygazette.com/rss", label: "Railway Gazette" },
    ],
  },
  {
    slug: "media",
    label: "Медиа",
    hint: "издания и их экономика, соцсети и платформы, журналистика, реклама, ИИ в производстве контента",
    related: ["politics", "demography", "cinema", "startups"],
    feeds: [
      { kind: "rss", url: "https://www.niemanlab.org/feed/", label: "Nieman Lab" },
      { kind: "rss", url: "https://pressgazette.co.uk/feed/", label: "Press Gazette" },
      { kind: "rss", url: "https://www.platformer.news/rss/", label: "Platformer" },
    ],
  },
];

export const starterBySlug = new Map(STARTER_TOPICS.map((topic) => [topic.slug, topic]));

/**
 * Пределы имени и подсказки темы. Оба уходят в общий справочник и в вопрос
 * Jev на каждом материале потока — длина здесь стоит денег всем читателям.
 * Поле режет по `maxLength`, сервер — по этим же числам (`saveInterests`,
 * `saveOnboardingInterests`): форму рисует браузер.
 */
export const TOPIC_LIMITS = { label: 60, hint: 200 } as const;

/**
 * Имя или подсказка по пределу: обрезается, а не отвергается — поле дальше
 * и не пускает, длиннее приходит только мимо формы. Нестроковое — пусто.
 */
export const clampTopicText = (text: unknown, limit: number): string =>
  String(text ?? "").trim().slice(0, limit);

/**
 * Каталожная ли тема: её имя и подсказка — критерий классификации для всех,
 * и править их читателю нельзя. Одно правило на сервер (`upsertTopic`
 * через `writeTopics`), страницу интересов и форму чипов: три копии
 * условия разошлись бы молча, и форма показывала бы поле, чью правку
 * сервер отбросит. Проверяется в `npm test`.
 */
export const catalogTopic = (slug: string): StarterTopic | undefined => starterBySlug.get(slug);
export const catalogSlug = (slug: string): boolean => catalogTopic(slug) !== undefined;

/**
 * Своя ли тема по имени, набранному руками: имя, сводящееся к каталожному
 * слагу («AI-инфра» → `ai-infra`), — уже не своя. Слаг из имени выводится
 * тем же `toSlug`, что и на сервере при записи.
 */
export const ownLabel = (label: string): boolean => !catalogSlug(toSlug(label));

/**
 * Тема читателя в том виде, в каком её рисует форма интересов: цель как
 * число, признак «своя» — по тому же правилу, что и на сервере. Одна
 * функция на страницу и на ответ действия после записи: форма после
 * сохранения пересеивается тем, что сервер записал на самом деле.
 */
export const formChipOf = (topic: ReaderTopic) => ({
  slug: topic.slug,
  label: topic.label,
  hint: topic.hint,
  count: topic.weight,
  own: !catalogSlug(topic.slug) && !topic.shared,
});

/**
 * Порядок показа: сначала то, что уже выбрано соседями по выбору, потом
 * остальное. Выбранный интерес уходит со сцены — он уже в наборе, и держать
 * его в списке предложений значит предлагать то, что нельзя нажать.
 *
 * Чистая функция: у неё есть проверка, а у экрана — только глаза.
 */
export function suggestOrder(picked: string[], ranked: string[] = []): string[] {
  const chosen = new Set(picked);
  // Соседи выбранного — в том порядке, в каком выбирали: последний выбор
  // ближе к пальцу, чем первый, и отвечает на «а что ещё такого же».
  const near: string[] = [];
  for (const slug of [...picked].reverse()) {
    for (const related of starterBySlug.get(slug)?.related ?? []) {
      if (!chosen.has(related) && !near.includes(related)) near.push(related);
    }
  }
  // Ранжирование по описанию из Telegram — второй очередью: оно про человека
  // вообще, а соседи — про то, что он только что нажал.
  const rest = [...ranked, ...STARTER_TOPICS.map((topic) => topic.slug)].filter(
    (slug, index, all) =>
      starterBySlug.has(slug) && !chosen.has(slug) && !near.includes(slug) &&
      all.indexOf(slug) === index,
  );
  return [...near, ...rest];
}
