"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { TrashIcon, PlusIcon } from "lucide-react";
import { addSource, deleteSource, setSourceActive } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SILENT_DAYS, type Source, type SourceHealth } from "@/lib/types";

const KINDS = [
  {
    value: "auto",
    label: "Ссылка",
    placeholder: "https://simonwillison.net",
    hint: "Вставь любую ссылку: блог, канал YouTube, репозиторий, сабреддит, профиль X. Тип и адрес фида определятся сами.",
  },
  { value: "rss", label: "RSS", placeholder: "https://example.com/feed", hint: "Точный адрес фида, без определения." },
  { value: "reddit", label: "Reddit", placeholder: "LocalLLaMA", hint: "Имя сабреддита без r/. Нужны REDDIT_CLIENT_ID и REDDIT_CLIENT_SECRET." },
  { value: "x", label: "X", placeholder: "from:karpathy OR from:sama", hint: "Поисковый запрос X. Нужен X_API_KEY. Платно, около $0.15 за 1000 постов." },
  { value: "hackernews", label: "Hacker News", placeholder: "topstories", hint: "topstories, newstories или beststories." },
  { value: "telegram", label: "Telegram", placeholder: "durov", hint: "Имя публичного канала. Закрытые каналы веб-просмотр не отдаёт, ключей не нужно." },
] as const;

export function SourcesManager({
  sources,
  health,
}: {
  sources: Source[];
  health: SourceHealth[];
}) {
  // По строке: bigint приходит из драйвера строкой, и Map по числу
  // не находит ничего — молча, на каждой строке списка.
  const healthById = new Map(health.map((row) => [row.source_id, row]));
  const [kind, setKind] = useState<string>("auto");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = KINDS.find((entry) => entry.value === kind)!;

  const dead = sources.filter((source) => source.active && source.last_error);
  // Тишина считается по дате последнего материала, а не по последнему
  // прогону: источник, который отвечает 200 и отдаёт ноль, ошибки
  // не показывает — дайджест просто приходит без него.
  const silent = sources.filter((source) => {
    if (!source.active || source.last_error) return false;
    return (healthById.get(String(source.id))?.silent_days ?? 0) >= SILENT_DAYS;
  });

  return (
    <div className="flex flex-col gap-6">
      {dead.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Источники с ошибкой: {dead.length}</AlertTitle>
          <AlertDescription>
            {dead.map((source) => `${source.label}: ${source.last_error}`).join(" · ")}
          </AlertDescription>
        </Alert>
      ) : null}

      {silent.length > 0 ? (
        <Alert>
          <AlertTitle>Молчат {SILENT_DAYS}+ дней: {silent.length}</AlertTitle>
          <AlertDescription>
            {silent
              .map((source) => {
                const row = healthById.get(String(source.id));
                return `${source.label} (${row?.ever ? `${row.silent_days} дн.` : "ни разу"})`;
              })
              .join(", ")}{" "}
            — отвечают, но материалов не дают. Обычно это заброшенный фид или переехавший канал.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Добавить источник</CardTitle>
          <CardDescription>
            Любой источник проверяется живым запросом до сохранения: непроверенный
            адрес — это молча пустая вкладка через неделю.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={(formData) =>
              startTransition(async () => {
                const result = await addSource(formData);
                if (result?.error) {
                  setError(result.error);
                  return;
                }
                setError(null);
                const found = result?.found;
                toast.success(found ? found.label : "Источник добавлен", {
                  description: found
                    ? `${found.kind} · свежих ${found.fresh} из ${found.count}${found.sample ? ` · ${found.sample}` : ""}`
                    : undefined,
                });
              })
            }
          >
            <FieldGroup>
              <Field>
                <FieldLabel>Тип</FieldLabel>
                <ToggleGroup
                  value={[kind]}
                  onValueChange={(value: string[]) => value[0] && setKind(value[0])}
                  variant="outline"
                >
                  {KINDS.map((entry) => (
                    <ToggleGroupItem key={entry.value} value={entry.value}>
                      {entry.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <input type="hidden" name="kind" value={kind} />
              </Field>

              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="url">Адрес или запрос</FieldLabel>
                <Input id="url" name="url" placeholder={active.placeholder} aria-invalid={error ? true : undefined} />
                <FieldDescription>{error ?? active.hint}</FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="label">Название</FieldLabel>
                <Input
                  id="label"
                  name="label"
                  placeholder={kind === "auto" ? "необязательно: возьмём из фида" : "как показывать в ленте"}
                />
              </Field>

              <Button type="submit" disabled={pending} className="self-start">
                <PlusIcon data-icon="inline-start" />
                Добавить
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Источники</CardTitle>
          <CardDescription>{sources.filter((s) => s.active).length} включено из {sources.length}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {sources.map((source, index) => {
            const row = healthById.get(String(source.id));
            return (
            <div key={source.id}>
              {index > 0 ? <Separator className="my-1" /> : null}
              <div className="flex items-center gap-3 py-1.5">
                <Switch
                  checked={source.active}
                  onCheckedChange={(checked: boolean) =>
                    startTransition(() => setSourceActive(source.id, checked))
                  }
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{source.label}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {delivery(row) ?? source.url}
                  </span>
                </div>
                <Badge variant="outline">{source.kind}</Badge>
                {statusBadge(source, row)}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Удалить ${source.label}`}
                  onClick={() => startTransition(() => deleteSource(source.id))}
                >
                  <TrashIcon />
                </Button>
              </div>
            </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}


/**
 * Отдача одной строкой: сколько материалов источник дал за месяц, сколько
 * из них дошло до дайджеста, какой у них средний скор. «Сорок в день и ни
 * одного в дайджест» — повод выключить, а не гадать.
 */
function delivery(row: SourceHealth | undefined): string | null {
  if (!row || row.collected === 0) return null;
  const parts = [`${row.collected} за месяц → ${row.digested} в дайджест`];
  if (row.mean_score !== null) parts.push(`скор ${Math.round(row.mean_score)}`);
  if (row.duplicates > 0) parts.push(`дублей ${row.duplicates}`);
  return parts.join(" · ");
}

/**
 * Состояние источника одной меткой, по убыванию важности: ошибка, затем
 * тишина, затем сколько дал последний прогон. Молчанием считается срок
 * без материалов — у нового источника он идёт от даты заведения, иначе
 * тревога срабатывает раньше первого прогона, на источнике, который
 * только что проверили живым запросом.
 */
function statusBadge(source: Source, row: SourceHealth | undefined) {
  if (source.last_error) return <Badge variant="destructive">ошибка</Badge>;
  if (source.active && row && row.silent_days >= SILENT_DAYS) {
    return (
      <Badge variant="outline">
        {row.ever ? `молчит ${row.silent_days} дн.` : "ни разу не дал материала"}
      </Badge>
    );
  }
  if (source.last_count !== null) return <Badge variant="secondary">{source.last_count}</Badge>;
  return null;
}
