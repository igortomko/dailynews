/**
 * Бюджет внимания: сколько новостей в день отдано каждой теме.
 *
 * Хранится в `topics.weight` — там же, где раньше лежал множитель скора.
 * Число теперь означает буквально: цель по количеству материалов. Отбор
 * делит номер материала внутри темы на это число (pipeline/select.ts),
 * и при сумме целей, равной числу мест, каждая тема получает ровно свою
 * цель. Это единственная причина, по которой интерфейс может показывать
 * штуки, а не проценты.
 *
 * Мест столько, сколько уложится в заказанное время: заказ читателя —
 * минуты, а перевод в штуки делает `itemsForMinutes` по длине его же
 * описаний. Сумма целей приводится к этому числу на каждом входе.
 *
 * Цель — не обещание. Если материалов по теме за день меньше цели, место
 * уходит следующему по оценке, в том числе материалу вне тем. Обратное
 * было бы хуже: дайджест из десяти пустых мест ради ровного столбика.
 */

/** Меньше одной новости тема получить не может: ноль — это убрать тему. */
export const MIN_PER_TOPIC = 1;

/**
 * Цвета тем. Восемь фиксированных, по порядку: добавленная тема берёт
 * следующий, а уже заведённые свой не меняют. Равномерный разброс по кругу
 * пересчитывался бы при каждом добавлении, и все темы меняли бы цвет разом.
 */
export const TOPIC_COLORS = [
  "oklch(0.65 0.20 25)",
  "oklch(0.72 0.17 60)",
  "oklch(0.80 0.15 95)",
  "oklch(0.70 0.16 145)",
  "oklch(0.72 0.12 195)",
  "oklch(0.65 0.16 250)",
  "oklch(0.62 0.18 300)",
  "oklch(0.68 0.18 350)",
];

export const colorAt = (index: number) => TOPIC_COLORS[index % TOPIC_COLORS.length];

/**
 * Приводит цели к сумме, равной размеру дайджеста.
 *
 * Нужна на каждом входе, а не только при перетаскивании: темы добавляют
 * и убирают, размер дайджеста меняют, а в базе лежат цели от прошлого
 * набора. Без приведения сумма разъезжается с размером, и «10 из 20»
 * на экране означало бы не то, что получит читатель.
 *
 * Метод наибольших остатков: раздаём целые части пропорции, остаток —
 * по величине дробного хвоста. Простое округление каждой доли даёт сумму
 * то на единицу больше, то на единицу меньше.
 */
export function normalize(counts: number[], total: number): number[] {
  const n = counts.length;
  if (n === 0) return [];
  // Мест меньше, чем тем: у всех по одному. Сумма целей выйдет больше
  // размера дайджеста, и это не поломка — отбор всё равно режет по размеру,
  // а деление мест возвращается к прежнему ровному кругу. Показать кому-то
  // ноль было бы враньём: место он получить всё ещё может.
  if (total <= n) return counts.map(() => MIN_PER_TOPIC);

  const sum = counts.reduce((a, b) => a + b, 0);
  const shares = sum > 0 ? counts.map((c) => (c / sum) * total) : counts.map(() => total / n);

  const floors = shares.map((share) => Math.max(MIN_PER_TOPIC, Math.floor(share)));
  let left = total - floors.reduce((a, b) => a + b, 0);

  // Остаток раздаём по убыванию дробной части; нехватку снимаем с самых
  // больших, не опуская никого ниже минимума.
  const order = shares
    .map((share, index) => ({ index, frac: share - Math.floor(share) }))
    .sort((a, b) => b.frac - a.frac);

  for (let i = 0; left > 0 && i < order.length; i = (i + 1) % order.length) {
    floors[order[i].index]++;
    left--;
  }
  while (left < 0) {
    const biggest = floors.indexOf(Math.max(...floors));
    if (floors[biggest] <= MIN_PER_TOPIC) break;
    floors[biggest]--;
    left++;
  }
  return floors;
}

/**
 * Двигает границу между соседями: сколько ушло слева, столько пришло справа.
 * Сумма не меняется — значит, размер дайджеста не поедет от перетаскивания.
 */
export function moveBoundary(counts: number[], boundary: number, cumulative: number): number[] {
  const next = [...counts];
  const before = next.slice(0, boundary).reduce((a, b) => a + b, 0);
  const pair = next[boundary] + next[boundary + 1];
  const target = Math.min(
    before + pair - MIN_PER_TOPIC,
    Math.max(before + MIN_PER_TOPIC, Math.round(cumulative)),
  );
  next[boundary] = target - before;
  next[boundary + 1] = pair - next[boundary];
  return next;
}

/** Зазор между кусками полосы, px. Совпадает с `gap-1` в разметке. */
export const BAR_GAP = 4;

/**
 * Где стоит ручка границы, в CSS-выражении.
 *
 * Куски выложены флексом с зазором, поэтому цветная часть уже полосы
 * на суммарную ширину зазоров. Доля «сколько новостей слева» отсчитывается
 * от цветной части, а не от всей ширины, и к ней добавляются зазоры,
 * пройденные слева. Считать долей от полной ширины — значит промахиваться
 * тем сильнее, чем правее граница: на последних кусках ручка уезжает
 * на соседний сегмент и выглядит его ручкой.
 */
export function handleLeft(counts: number[], boundary: number, gap = BAR_GAP): string {
  const total = counts.reduce((sum, count) => sum + count, 0) || 1;
  const left = counts.slice(0, boundary + 1).reduce((sum, count) => sum + count, 0);
  const gapsBefore = gap * boundary + gap / 2;
  return `calc((100% - ${gap * (counts.length - 1)}px) * ${left / total} + ${gapsBefore}px)`;
}
