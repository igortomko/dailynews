import { useId, useMemo, useState } from "react";
import { Copy, Link2, Plus, Trash2 } from "lucide-react";
import { Button } from "@launch-kit/components/ui/button";
import { Input } from "@launch-kit/components/ui/input";
import { Badge } from "@launch-kit/components/ui/badge";
import { Panel, Empty } from "./dashboard-widgets";
import { buildCampaignLink, linkSuggestions, type LinkFields } from "@launch-kit/lib/links";
interface SavedLink {
  url: string;
  source: string;
  campaign: string;
}
export function LinkBuilder({
  product,
  enabledViews,
}: {
  product: string;
  enabledViews: string[];
}) {
  const key = `launchkit-links:${product}`;
  const suggestionId = useId();
  const [fields, setFields] = useState<LinkFields>({
    url: "https://example.com/",
    source: "",
    medium: "social",
    campaign: "",
    content: "",
    term: "",
    ref: "",
  });
  const [links, setLinks] = useState<SavedLink[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(value)
        ? value
            .filter(
              (item): item is SavedLink =>
                typeof item === "object" &&
                item !== null &&
                typeof item.url === "string" &&
                typeof item.source === "string" &&
                typeof item.campaign === "string" &&
                item.url.startsWith("https://"),
            )
            .slice(0, 50)
        : [];
    } catch {
      return [];
    }
  });
  const [status, setStatus] = useState("");
  const savedUrls = useMemo(() => links.map((link) => link.url), [links]);
  let result = "";
  let error = "";
  try {
    result = buildCampaignLink(fields);
  } catch (err) {
    error = err instanceof Error ? err.message : "Проверьте ссылку.";
  }
  function saveLinks(value: SavedLink[]) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      setLinks(value);
      setStatus("Сохранено только в этом браузере.");
    } catch {
      setStatus("Браузер не разрешил сохранить ссылки.");
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Ссылка скопирована.");
    } catch {
      setStatus("Копирование недоступно. Выделите ссылку в поле вручную.");
    }
  }
  const labels: [keyof LinkFields, string, string][] = [
    ["url", "Адрес продукта", "https://example.com/"],
    ["source", "Источник · utm_source", "telegram"],
    ["medium", "Тип канала · utm_medium", "social"],
    ["campaign", "Кампания · utm_campaign", "launch-september"],
    ["content", "Размещение · utm_content", "post-01"],
    ["term", "Ключ · utm_term", "productivity"],
    ["ref", "Простой ref", "partner-name"],
  ];
  const visible = labels.filter(([name]) =>
    name === "url" || name === "ref"
      ? name === "url" || enabledViews.includes("simple_ref")
      : enabledViews.includes("utm_builder"),
  );
  return (
    <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
      <Panel
        title="Одна ссылка — один источник"
        description="Источник сохраняется при первом входе. Метка не подтверждает личность пользователя."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (result) void copy(result);
          }}
          className="space-y-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {visible.map(([name, title, placeholder]) => (
              <label
                key={name}
                className={`space-y-2 text-xs ${name === "url" ? "sm:col-span-2" : ""}`}
              >
                <span className="font-medium">{title}</span>
                {name !== "url" && (
                  <datalist id={`${suggestionId}-${name}`}>
                    {linkSuggestions(name, savedUrls).map((value) => (
                      <option key={value} value={value} />
                    ))}
                  </datalist>
                )}
                <Input
                  value={fields[name]}
                  onChange={(e) =>
                    setFields({ ...fields, [name]: e.target.value })
                  }
                  placeholder={placeholder}
                  maxLength={name === "url" ? 500 : 100}
                  list={name === "url" ? undefined : `${suggestionId}-${name}`}
                  aria-describedby={
                    name === "url" ? undefined : `${suggestionId}-${name}-hint`
                  }
                />
                {name !== "url" && (
                  <span
                    id={`${suggestionId}-${name}-hint`}
                    className="block text-[11px] leading-4 text-muted-foreground"
                  >
                    {name === "source" || name === "medium"
                      ? "Выберите готовый вариант или введите свой."
                      : "Подсказки — только из сохранённых ссылок этого браузера."}
                  </span>
                )}
              </label>
            ))}
          </div>
          <div className="rounded-lg bg-muted p-4">
            <p className="mb-2 text-xs text-muted-foreground">Готовая ссылка</p>
            <textarea
              aria-label="Готовая ссылка"
              readOnly
              className="min-h-20 w-full resize-none bg-transparent text-sm outline-none"
              value={result || error}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!result}>
              <Copy className="size-4" />
              Копировать
            </Button>
            {enabledViews.includes("saved_links") && (
              <Button
                type="button"
                variant="outline"
                disabled={
                  !result ||
                  links.some((link) => link.url === result) ||
                  links.length >= 50
                }
                onClick={() =>
                  saveLinks([
                    {
                      url: result,
                      source: fields.source || fields.ref,
                      campaign: fields.campaign,
                    },
                    ...links,
                  ])
                }
              >
                <Plus className="size-4" />
                Сохранить
              </Button>
            )}
          </div>
          <p role="status" className="min-h-4 text-xs text-muted-foreground">
            {status}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            Готовые источники и типы каналов встроены в Launch Kit. Сохранённые
            ссылки и их подсказки хранятся только в localStorage этого браузера,
            отдельно для каждого продукта; в экспорт и базу они не попадают.
          </p>
        </form>
      </Panel>
      <div className="space-y-5">
        <Panel
          title="Как использовать"
          description="Для постов, email, партнёров и рекламы"
        >
          <ol className="space-y-5 text-sm">
            {[
              "Создайте отдельную ссылку для каждого размещения.",
              "Добавьте её в пост или письмо. Это действие вы делаете отдельно.",
              "Передайте разрешённые метки из URL в первое событие продукта.",
              "Сравните результат кампаний в разделе «Привлечение».",
            ].map((text, index) => (
              <li key={text} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">
                  {index + 1}
                </span>
                <span className="leading-6">{text}</span>
              </li>
            ))}
          </ol>
        </Panel>
        {enabledViews.includes("saved_links") && (
          <Panel
            title="Сохранённые ссылки"
            action={<Badge variant="secondary">{links.length} / 50</Badge>}
          >
            {links.length === 0 ? (
              <Empty title="Первая кампания впереди">
                Ссылки хранятся в этом браузере и не входят в экспорт Launch
                Kit.
              </Empty>
            ) : (
              <div className="max-h-80 space-y-3 overflow-auto">
                {links.map((link) => (
                  <div
                    key={link.url}
                    className="flex items-center gap-2 rounded-lg border p-3"
                  >
                    <Link2 className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {link.campaign || link.source}
                      </p>
                      <p
                        className="truncate text-[11px] text-muted-foreground"
                        title={link.url}
                      >
                        {link.url}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Копировать ${link.campaign || link.source}`}
                      onClick={() => void copy(link.url)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Удалить ${link.campaign || link.source}`}
                      onClick={() =>
                        saveLinks(links.filter((item) => item.url !== link.url))
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
