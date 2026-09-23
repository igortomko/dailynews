/**
 * Личные правила отбора: за чем следить и что исключать.
 *
 * Читатель выбирает широкие интересы, а здесь называет конкретное: Figma,
 * Framer, Webflow — или, наоборот, имя, которого видеть не хочет. Правило —
 * список написаний одного и того же («Figma», «Фигма»): первое показывается,
 * по всем ищется. Ищется буквально, в уже имеющемся тексте — заголовке,
 * описании из фида и тексте статьи. Ни перевода, ни морфологии, ни «модель
 * поймёт, что имелось в виду»: совпадение означает упоминание, и только его.
 * Обещать больше значило бы обещать мониторинг, которого здесь нет.
 *
 * Модуль чистый: ни базы, ни сети, ни `server-only`. Его читают и отбор
 * в прогоне, и лента, и редактор списка в браузере, а проверяется он
 * в `npm test` — граница слова для кириллицы, Apple против Pineapple,
 * пользовательский текст, который нельзя исполнять как regex.
 */

import type { rules as EnWords } from "./i18n/en/rules";
import { rules as ruWords } from "./i18n/ru/rules";

/** Написания одного и того же. Первое показывается, по всем ищется. */
export type Names = string[];
export type RuleKind = "follow" | "exclude";
export type Rules = Record<RuleKind, Names[]>;

/**
 * Якорь блока списка на странице. Одна функция на того, кто его ставит
 * (`name-rules.tsx`), и на того, кто на него ссылается (`topic-chips.tsx`):
 * строка, написанная в двух местах руками, разошлась бы молча — ссылка
 * вела бы в никуда, и ни тип, ни тест этого не заметили бы.
 */
export const rulesAnchor = (kind: RuleKind) => `rules-${kind}`;

/**
 * Слова отказов. Необязательный довод с русским по умолчанию, как у всех
 * общих утилит: прогон и тесты словаря не выбирают, а форма и действия
 * отдают словарь читателя.
 */
export type Words = typeof EnWords;

/**
 * Пределы ввода. Одни на все тарифы, а не новые тарифные границы:
 * это защита от списка в тысячу строк, а не то, за что предлагается платить.
 */
export const RULE_LIMITS = {
  rules: { follow: 20, exclude: 50 },
  /** Написаний на одно правило. */
  names: 5,
  /** Знаков в одном написании. */
  chars: 80,
} as const;

/** Окно, по которому «Интересы» считают упоминания у правил (`mentionPool`). */
export const MENTION_DAYS = 30;

/**
 * Одна форма для сравнения: NFKC (полноширинные буквы и лигатуры сходятся
 * к обычным), без регистра, «ё» как «е», один пробел вместо любого пробельного.
 */
export const fold = (text: string): string =>
  text.normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** Написание как ввёл человек, только без лишних пробелов. */
const tidy = (name: string): string => name.replace(/\s+/g, " ").trim();

/**
 * Разбить ввод на названия: через запятую, точку с запятой или перевод
 * строки. NFKC до разбиения: полноширинная запятая из японской или китайской
 * раскладки — тоже запятая, и после свёртки она обычная. Пустое и повторы
 * (без регистра) выбрасываются — «Figma, figma, » это одно.
 */
export function splitNames(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.normalize("NFKC").split(/[,;、\n]/)) {
    const name = tidy(raw);
    if (!name || seen.has(fold(name))) continue;
    seen.add(fold(name));
    out.push(name);
  }
  return out;
}

/**
 * Привести присланное к правилам или назвать, что не так.
 *
 * Серверная проверка, а не только форма: форму рисует браузер. Принимает
 * и массив строк (каждая — правило из одного написания), и массив массивов.
 * Повтор одного написания в двух правилах — не ошибка, а слияние: второе
 * молча теряет повтор, и одно упоминание не занимает два правила.
 */
export function cleanRules(
  kind: RuleKind,
  raw: unknown,
  words: Words = ruWords,
): { rules: Names[] } | { error: string } {
  if (raw === undefined || raw === null) return { rules: [] };
  if (!Array.isArray(raw)) return { error: words.badList };
  const seen = new Set<string>();
  const rules: Names[] = [];
  for (const entry of raw) {
    const names: string[] = [];
    for (const value of Array.isArray(entry) ? entry : [entry]) {
      if (typeof value !== "string") return { error: words.badList };
      const name = tidy(value);
      if (!name) continue;
      if (name.length > RULE_LIMITS.chars) {
        return { error: words.tooLong(name.slice(0, 24), RULE_LIMITS.chars) };
      }
      if (seen.has(fold(name))) continue;
      seen.add(fold(name));
      names.push(name);
    }
    if (names.length === 0) continue;
    if (names.length > RULE_LIMITS.names) {
      return { error: words.tooManyVariants(RULE_LIMITS.names) };
    }
    rules.push(names);
  }
  const max = RULE_LIMITS.rules[kind];
  if (rules.length > max) return { error: words[kind].limit(max) };
  return { rules };
}

/** Правила из колонки jsonb. Строка вместо массива (урок 0005) читается, а не роняет ленту. */
export function asNames(raw: unknown): Names[] {
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (Array.isArray(entry) ? entry : [entry]).filter((n): n is string => typeof n === "string" && n.trim() !== ""))
    .filter((names) => names.length > 0);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Скомпилированный список: есть ли упоминание и какое.
 *
 * `empty` — правил нет, и текст можно не собирать вовсе: отбор проверяет
 * сотни материалов с полным текстом статьи, и без правил ему незачем
 * снимать разметку с каждого.
 */
export type Matcher = {
  empty: boolean;
  test: (text: string) => boolean;
  /** Показываемое написание первого сработавшего правила. */
  find: (text: string) => string | null;
};

export const NO_MATCH: Matcher = { empty: true, test: () => false, find: () => null };

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Знак, из которого состоят слова: буква, цифра или подчёркивание. */
const WORD = "\\p{L}\\p{N}_";

/** Пробел или дефис между двумя словесными знаками внутри написания. */
const JOINT = new RegExp(`(?<=[${WORD}])[ \\-‐–]+(?=[${WORD}])`, "gu");
/** Чем он ищется: любой разрыв из пробелов и дефисов или никакого. */
const SEPARATOR = "[\\s\\-‐–]*";
/** Ключ написания без необязательных разрывов: «open ai» и «OpenAI» — одно. */
const squash = (text: string) => fold(text).replace(JOINT, "");

/**
 * Одно выражение на все написания.
 *
 * Граница слова — «рядом нет буквы, цифры и подчёркивания», а не `\b`:
 * тот знает только латиницу и на кириллице ловит середину слова (урок
 * из lexicon.ts). Так «Apple» не находится в «Pineapple», «Go» — в «Google»
 * и в «go_router». Граница ставится только с той стороны написания, где
 * оно само кончается словесным знаком: у «.NET» слева точка, и «ASP.NET»
 * его содержит; у «C++» справа плюс, и «C++17» тоже находится. Иначе
 * оба искались бы только между пробелами — а читатель ждёт «как написано».
 * Текст читателя экранируется целиком: «a.*b» — это буквы и звёздочка,
 * а не выражение.
 *
 * Пробел или дефис между буквами внутри написания необязателен и ловит
 * любой такой разрыв: «open ai» находит «OpenAI», «Open-AI» и «Hacker\nNews»
 * у «Hacker News». Слитное пишут чаще, чем набирают, — «open ai» в «За чем
 * следить» не находил ничего. Границы по краям при этом те же: однословное
 * написание не меняется, и «Go» по-прежнему не находится в «Google».
 */
export function compile(rules: Names[]): Matcher {
  const shown = new Map<string, string>();
  for (const names of rules) {
    for (const name of names) {
      const key = fold(name);
      if (key && !shown.has(squash(key))) shown.set(squash(key), names[0]);
    }
  }
  if (shown.size === 0) return NO_MATCH;
  const keys = new Set(rules.flat().map(fold).filter(Boolean));
  const alternation = [...keys]
    // Длинное написание первым: у альтернатив побеждает первая совпавшая,
    // и «Figma» назвала бы себя в «Figma Design», хотя правило про второе.
    .sort((a, b) => b.length - a.length)
    .map((key) => {
      const body = escapeRegex(key).replace(JOINT, SEPARATOR);
      const lead = new RegExp(`^[${WORD}]`, "u").test(key) ? `(?<![${WORD}])` : "";
      const trail = new RegExp(`[${WORD}]$`, "u").test(key) ? `(?![${WORD}])` : "";
      return `${lead}${body}${trail}`;
    })
    .join("|");
  const pattern = new RegExp(`(?:${alternation})`, "u");
  return {
    empty: false,
    test: (text) => pattern.test(fold(text)),
    find: (text) => {
      const hit = pattern.exec(fold(text));
      return hit ? (shown.get(squash(hit[0])) ?? null) : null;
    },
  };
}

/**
 * Слить набранное в список: каждое название — своё правило.
 *
 * Возвращает тот же массив, если добавить было нечего, первую причину
 * отказа словами и непринятое целиком — поле оставляет его на месте, чтобы
 * поправить, а не набирать заново. Одна функция на кнопку «Добавить»,
 * на скрытое поле формы и на то, что уходит родителю: иначе набранное
 * проходило бы в форму мимо проверок, которые видит кнопка.
 */
export function mergeDraft(
  rules: Names[],
  draft: string,
  limit: number,
  words: Words = ruWords,
): { next: Names[]; stopped: string | null; rejected: string[] } {
  const next = [...rules];
  const rejected: string[] = [];
  let added = false;
  let stopped: string | null = null;
  for (const candidate of splitNames(draft)) {
    if (candidate.length > RULE_LIMITS.chars) {
      stopped ??= words.tooLong(candidate.slice(0, 24), RULE_LIMITS.chars);
      rejected.push(candidate);
      continue;
    }
    if (next.some((known) => known.some((n) => fold(n) === fold(candidate)))) {
      stopped ??= words.exists(candidate);
      rejected.push(candidate);
      continue;
    }
    if (next.length >= limit) {
      stopped ??= words.limitReached(limit);
      rejected.push(candidate);
      continue;
    }
    next.push([candidate]);
    added = true;
  }
  return { next: added ? next : rules, stopped, rejected };
}

/**
 * Написания раскрытого правила из поля: первое остаётся именем, остальные —
 * из ввода через запятую. Отказ — целиком, с причиной: написание из другого
 * правила ничего не добавляет, а человек думал бы, что добавил.
 */
export function withVariants(
  rules: Names[],
  index: number,
  input: string,
  words: Words = ruWords,
): { next: Names[]; stopped: string | null } {
  const shown = rules[index]?.[0];
  if (shown === undefined) return { next: rules, stopped: null };
  const others = splitNames(input).filter((name) => fold(name) !== fold(shown));
  const taken = others.find((name) =>
    rules.some((names, i) => i !== index && names.some((known) => fold(known) === fold(name))),
  );
  if (taken) return { next: rules, stopped: words.existsElsewhere(taken) };
  const long = others.find((name) => name.length > RULE_LIMITS.chars);
  if (long) return { next: rules, stopped: words.tooLong(long.slice(0, 24), RULE_LIMITS.chars) };
  if (others.length + 1 > RULE_LIMITS.names) {
    return { next: rules, stopped: words.tooManyVariants(RULE_LIMITS.names) };
  }
  const names = [shown, ...others];
  if (names.join("\n") === rules[index].join("\n")) return { next: rules, stopped: null };
  return { next: rules.map((entry, i) => (i === index ? names : entry)), stopped: null };
}

/**
 * Сколько текстов упоминает каждое правило — тем же сопоставителем, что
 * и отбор. Ноль у правила — почти всегда не то написание, а не тишина
 * вокруг названия: без числа это правило работало бы молча, не работая.
 */
export function countHits(rules: Names[], texts: string[]): number[] {
  return rules.map((names) => {
    const matcher = compile([names]);
    return matcher.empty ? 0 : texts.filter((text) => matcher.test(text)).length;
  });
}

/** Правила читателя в том виде, в каком их применяет отбор и лента. */
export type ReaderRules = { follow: Matcher; exclude: Matcher };

export const NO_RULES: ReaderRules = { follow: NO_MATCH, exclude: NO_MATCH };

export const rulesOf = (reader: { follow_rules: unknown; exclude_rules: unknown }): ReaderRules => ({
  follow: compile(asNames(reader.follow_rules)),
  exclude: compile(asNames(reader.exclude_rules)),
});

/**
 * Текст, в котором ищется упоминание: всё доступное разом. Один сборщик
 * на отбор и ленту — чтобы «ищется в заголовке, описании и тексте» было
 * одним утверждением, а не двумя, которые разъедутся.
 */
export const mentionText = (...parts: (string | null | undefined)[]): string =>
  parts.filter((part): part is string => typeof part === "string" && part !== "").join("\n");

/** Карточка готового выпуска: исходный текст и написанный языком читателя. */
export type Card = {
  title: string;
  excerpt: string;
  title_ru: string | null;
  summary: string | null;
};

/**
 * Правила поверх готового выпуска.
 *
 * Исключение прячет карточку без пересборки: выпуск написан, платить
 * за него второй раз незачем, а снятое правило возвращает карточку как
 * была. Проверяются заголовок и описание из фида плюс написанное языком
 * читателя: исключение на языке выпуска работает и на уже готовом тексте.
 *
 * Текста статьи здесь нет, и это отличие от отбора принято осознанно:
 * сорок статей на каждый показ — мегабайты ради проверки, которую отбор
 * уже сделал. Цена: правило, добавленное после сборки, не спрячет карточку,
 * где название стоит только в теле статьи, — до следующего отбора, который
 * такой материал уже не возьмёт. Понадобится точнее — читать тело только
 * тем карточкам, где короткий текст не совпал.
 *
 * Слежение здесь только называет себя (`followed`): порядок решён при
 * отборе, а без пометки читателю неоткуда узнать, что правило сработало.
 */
export function applyRules<T extends Card>(
  cards: T[],
  rules: ReaderRules,
): { visible: (T & { followed: string | null })[]; hidden: number } {
  const visible: (T & { followed: string | null })[] = [];
  for (const card of cards) {
    const text = mentionText(card.title, card.excerpt, card.title_ru, card.summary);
    if (rules.exclude.test(text)) continue;
    visible.push({ ...card, followed: rules.follow.find(text) });
  }
  return { visible, hidden: cards.length - visible.length };
}
