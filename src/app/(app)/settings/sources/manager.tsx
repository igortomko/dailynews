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
import type { Source } from "@/lib/types";

const KINDS = [
  { value: "rss", label: "RSS", placeholder: "https://example.com/feed", hint: "Адрес фида. Через RSS ходят блоги, YouTube, arXiv, Substack." },
  { value: "reddit", label: "Reddit", placeholder: "LocalLLaMA", hint: "Имя сабреддита без r/. Нужны REDDIT_CLIENT_ID и REDDIT_CLIENT_SECRET." },
  { value: "x", label: "X", placeholder: "from:karpathy OR from:sama", hint: "Поисковый запрос X. Нужен X_API_KEY. Платно, около $0.15 за 1000 постов." },
  { value: "hackernews", label: "Hacker News", placeholder: "topstories", hint: "topstories, newstories или beststories." },
] as const;

/**
 * Каталог общий на всех читателей, поэтому правит его владелец: удаление
 * источника уносит каскадом собранные материалы, и у такой кнопки не должно
 * быть ста рук. Остальным он виден целиком — знать, откуда берётся лента,
 * полезно и без права её менять.
 */
export function SourcesManager({
  sources,
  editable,
}: { sources: Source[]; editable: boolean }) {
  const [kind, setKind] = useState<string>("rss");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = KINDS.find((entry) => entry.value === kind)!;

  const dead = sources.filter((source) => source.active && source.last_error);
  const silent = sources.filter(
    (source) => source.active && !source.last_error && source.last_count === 0,
  );

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
          <AlertTitle>Отвечают, но ничего свежего: {silent.length}</AlertTitle>
          <AlertDescription>
            {silent.map((source) => source.label).join(", ")} — источник жив, но за окно свежести
            не дал ни одного материала. Обычно это значит, что фид заброшен.
          </AlertDescription>
        </Alert>
      ) : null}

      {editable ? (
      <Card>
        <CardHeader>
          <CardTitle>Добавить источник</CardTitle>
          <CardDescription>RSS проверяется живым запросом до сохранения.</CardDescription>
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
                toast.success("Источник добавлен");
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
                <Input id="label" name="label" placeholder="как показывать в ленте" />
              </Field>

              <Button type="submit" disabled={pending} className="self-start">
                <PlusIcon data-icon="inline-start" />
                Добавить
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Источники</CardTitle>
          <CardDescription>{sources.filter((s) => s.active).length} включено из {sources.length}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {sources.map((source, index) => (
            <div key={source.id}>
              {index > 0 ? <Separator className="my-1" /> : null}
              <div className="flex items-center gap-3 py-1.5">
                <Switch
                  checked={source.active}
                  disabled={!editable}
                  onCheckedChange={(checked: boolean) =>
                    startTransition(() => setSourceActive(source.id, checked))
                  }
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{source.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{source.url}</span>
                </div>
                <Badge variant="outline">{source.kind}</Badge>
                {source.last_error ? (
                  <Badge variant="destructive">ошибка</Badge>
                ) : source.last_count !== null ? (
                  <Badge variant="secondary">{source.last_count}</Badge>
                ) : null}
                {editable ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Удалить ${source.label}`}
                    onClick={() => startTransition(() => deleteSource(source.id))}
                  >
                    <TrashIcon />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
