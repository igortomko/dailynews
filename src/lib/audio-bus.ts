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

/** Скорости по кругу. Замыкается на единице: с ×2 возвращаются чаще. */
export const RATES = [1, 1.25, 1.5, 2] as const;
export type Rate = (typeof RATES)[number];

const RATE_KEY = "reporta:audio-rate";

const isRate = (value: unknown): value is Rate => RATES.includes(value as Rate);

/**
 * Что играет прямо сейчас. Модульная переменная, а не состояние: её
 * читают из обработчика нажатия, и перерисовка для этого не нужна.
 */
let playing: HTMLAudioElement | null = null;

let rate: Rate = 1;
let loaded = false;
const listeners = new Set<(next: Rate) => void>();

/** Приватное окно и запрещённые куки отвечают исключением, а не пустотой. */
function read(): Rate {
  try {
    const saved = Number(localStorage.getItem(RATE_KEY));
    return isRate(saved) ? saved : 1;
  } catch {
    return 1;
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
