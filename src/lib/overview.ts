/**
 * Обзор для коллег: несколько новостей выпуска, собранных в один текст.
 *
 * Здесь нет ни одного вызова модели и ни одного запроса: заголовки
 * и описания уже написаны для этого читателя его языком, ссылки уже лежат
 * в карточках. Обзор — это выбор из готового и порядок, а не новый текст,
 * поэтому кнопка называется «Собрать», а не «Написать».
 *
 * Чистые функции и отдельный файл, а не половина компонента: их проверяет
 * `npm test`, а он не должен тянуть за собой React ради склейки строк.
 */
export type OverviewBlock = {
  /** items.id — тот же, по которому карточка отмечена в ленте. */
  id: number;
  title: string;
  summary: string;
  source: string;
  url: string;
};

export type Overview = {
  title: string;
  intro: string;
  blocks: OverviewBlock[];
};

/**
 * Блок из карточки. Берётся персональный заголовок выпуска, а не исходный:
 * читатель видит в ленте его и коллегам перешлёт то, что видел.
 */
export const blockOf = (item: {
  id: number;
  title: string;
  title_ru: string | null;
  summary: string | null;
  source_label: string;
  url: string;
}): OverviewBlock => ({
  id: item.id,
  title: item.title_ru || item.title,
  summary: item.summary ?? "",
  source: item.source_label,
  url: item.url,
});

/**
 * Сводит черновик с выбором в ленте.
 *
 * Оставшиеся блоки — в прежнем порядке и со своими правками: человек уже
 * переставил и переписал их, и новый выбор не должен этого стирать.
 * Снятые уходят, новые встают в конец в том порядке, в каком пришли
 * (лента отдаёт их порядком выпуска, а не порядком нажатий). Повтор
 * одного id невозможен по построению: второй экземпляр отсеивается.
 */
export function reconcile(blocks: OverviewBlock[], selected: OverviewBlock[]): OverviewBlock[] {
  const wanted = new Set(selected.map((block) => block.id));
  const kept: OverviewBlock[] = [];
  const have = new Set<number>();
  for (const block of blocks) {
    if (!wanted.has(block.id) || have.has(block.id)) continue;
    have.add(block.id);
    kept.push(block);
  }
  for (const block of selected) {
    if (have.has(block.id)) continue;
    have.add(block.id);
    kept.push(block);
  }
  return kept;
}

/** Переставляет элемент; за край списка не двигает и отдаёт тот же массив. */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Заголовок блока в тексте: номер и заголовок. Стёртый заголовок заменяется
 * названием источника — строка с одним номером читалась бы как обрыв.
 */
const heading = (block: OverviewBlock, index: number) =>
  `${index + 1}. ${block.title.trim() || block.source}`;

/**
 * Обычный текст: абзацы через пустую строку, ссылка голая и последней
 * в блоке — так её подхватывают и Telegram, и Slack, и почта. Пустое
 * вступление не оставляет за собой пустого абзаца.
 */
export function overviewText({ title, intro, blocks }: Overview): string {
  const head = [title.trim(), intro.trim()].filter(Boolean);
  const body = blocks.map((block, index) =>
    [heading(block, index), block.summary.trim(), `${block.source}: ${block.url}`]
      .filter(Boolean)
      .join("\n"),
  );
  return [...head, ...body].join("\n\n");
}

/**
 * Ссылка в Markdown ломается изнутри: скобка в адресе закрывает её раньше
 * времени, квадратная скобка в названии источника — обрывает текст ссылки.
 * Название приходит из каталога, адрес — из фида, и ни тому, ни другому
 * здесь верить нельзя.
 */
const MD_URL: Record<string, string> = { "(": "%28", ")": "%29", "<": "%3C", ">": "%3E", " ": "%20" };
const mdUrl = (url: string) => url.replace(/[()<> ]/g, (char) => MD_URL[char]);
const mdText = (text: string) => text.replace(/[[\]\\]/g, "\\$&");

/** Markdown из тех же данных: заголовки, абзацы, ссылка на источник словами. */
export function overviewMarkdown({ title, intro, blocks }: Overview): string {
  const head = [title.trim() ? `# ${title.trim()}` : "", intro.trim()].filter(Boolean);
  const body = blocks.map((block, index) =>
    [`## ${heading(block, index)}`, block.summary.trim(), `[${mdText(block.source)}](${mdUrl(block.url)})`]
      .filter(Boolean)
      .join("\n\n"),
  );
  return [...head, ...body].join("\n\n");
}
