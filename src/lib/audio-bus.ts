/**
 * Один звук на страницу и одна скорость на все карточки.
 *
 * Плеер живёт в каждой карточке, а слух у читателя один. Без общего места
 * два элемента играют одновременно и перекрикивают друг друга — и хуже
 * того, второй запускают не нарочно: нажали на соседнюю карточку, думая,
 * что первая остановится сама.
 *
 * Скорость тоже общая, и по той же причине. Она хранится у читателя
 * в браузере, но хранилище читается один раз при монтировании: карточка,
 * уже стоящая на экране, о смене скорости на соседней не узнала бы
 * до перезагрузки. Поэтому значение живёт здесь, а хранилище — только
 * его след между заходами.
 */

/**
 * Скорости по кругу. Первая — она же и по умолчанию.
 *
 * 1,05, а не 1: голос Edge TTS сам по себе медленнее живой речи, а шага
 * ускорения в синтезе нет — ни ffmpeg, ни параметра скорости у движка,
 * так что из базы звук приходит ровно таким, каким его произнесли.
 * Пять процентов слышны как «нормальный темп», а не как ускоренная запись,
 * и берутся плеером: `playbackRate` держит высоту голоса и применяется
 * к уже нарезанным файлам, не требуя их переозвучивать.
 */
export const RATES = [1.05, 1.25, 1.5, 2] as const;
export type Rate = (typeof RATES)[number];
/** Умолчание — первая в круге, а не константа: разъехались бы молча. */
const DEFAULT: Rate = RATES[0];

const RATE_KEY = "reporta:audio-rate";

const isRate = (value: unknown): value is Rate => RATES.includes(value as Rate);

/**
 * Что играет прямо сейчас. Модульная переменная, а не состояние: её
 * читают из обработчика нажатия, и перерисовка для этого не нужна.
 */
let playing: HTMLAudioElement | null = null;

let rate: Rate = DEFAULT;
let loaded = false;
const listeners = new Set<(next: Rate) => void>();

/** Приватное окно и запрещённые куки отвечают исключением, а не пустотой. */
function read(): Rate {
  try {
    const saved = Number(localStorage.getItem(RATE_KEY));
    // Сохранённая скорость прежнего круга (была единица) не в списке —
    // читается как «не задано» и заменяется умолчанием, а не остаётся
    // значением, которого кнопка больше не выдаёт.
    return isRate(saved) ? saved : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** Скорость сейчас. Первое обращение поднимает её из хранилища. */
export function currentRate(): Rate {
  if (!loaded && typeof window !== "undefined") {
    rate = read();
    loaded = true;
  }
  return rate;
}

/** Следующая по кругу — и сразу всем, кто слушает. */
export function nextRate(): Rate {
  const next = RATES[(RATES.indexOf(currentRate()) + 1) % RATES.length];
  rate = next;
  loaded = true;
  try {
    localStorage.setItem(RATE_KEY, String(next));
  } catch {
    // Не сохранилось — скорость всё равно применена к текущему звуку
    // и к соседним карточкам: между заходами она просто не переживёт.
  }
  // Играющий звук ускоряется сразу, а не со следующего запуска.
  if (playing) playing.playbackRate = next;
  for (const listener of listeners) listener(next);
  return next;
}

/** Подписка карточки на общую скорость. Возвращает отписку. */
export function onRate(listener: (next: Rate) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Запустить этот звук, остановив всё остальное.
 *
 * Прошлый именно ставится на паузу, а не сбрасывается: вернувшись
 * к карточке, читатель продолжает с того места, где его прервали, —
 * перемотка в начало наказывала бы за нажатие на соседнюю.
 *
 * Карточка узнаёт об остановке из события `pause` своего же элемента,
 * поэтому отдельно сообщать ей ничего не нужно.
 */
export function playOnly(element: HTMLAudioElement): void {
  if (playing && playing !== element) playing.pause();
  playing = element;
  element.playbackRate = currentRate();
  void element.play().catch(() => {});
}

/** Остановить этот звук, если играет именно он. */
export function pauseIfPlaying(element: HTMLAudioElement): void {
  element.pause();
  if (playing === element) playing = null;
}

/** Карточка ушла с экрана — её звук больше не наш. */
export function forget(element: HTMLAudioElement | null): void {
  if (element && playing === element) playing = null;
}
