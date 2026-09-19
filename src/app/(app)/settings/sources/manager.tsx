"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { TrashIcon, PlusIcon, SearchIcon } from "lucide-react";
import { addSource, deleteSource, discoverSource, setSourceActive } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { SourceHealth } from "@/lib/queries";
import type { Plan } from "@/lib/plans";
import type { Found } from "../../../../../pipeline/discover";

/**
 * Отдача источника за тридцать дней. Само по себе «дал 124 материала» ничего
 * не значит: важно, сколько из них дошло до выпусков и не перепечатки ли это.
 */
function yieldOf(source: SourceHealth): string {
  if (source.items === 0) return "за 30 дней — ни одного материала";
  const parts = [`за 30 дней: ${source.items} → ${source.in_digest} в выпусках`];
  if (source.mean_score !== null) parts.push(`скор ${source.mean_score}`);
  if (source.duplicates > 0) {
    parts.push(`дублей ${Math.round((source.duplicates / source.items) * 100)}%`);
  }
  return parts.join(" · ");
}

/**
 * Каталог общий на всех читателей, поэтому правит его владелец: удаление
 * источника уносит каскадом собранные материалы, и у такой кнопки не должно
 * быть ста рук. Остальным он виден целиком — знать, откуда берётся лента,
 * полезно и без права её менять.
 */
export function SourcesManager({
  sources,
  editable,
}: { sources: SourceHealth[]; plan: Plan; editable: boolean }) {
  const [pending, startTransition] = useTransition();
  const [input, setInput] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dead = sources.filter((source) => source.active && source.last_error);
  const silent = sources.filter(
    (source) => source.active && !source.last_error && (source.silent_days ?? 0) >= 1,
  );

  const parse = () =>
    startTransition(async () => {
      setFound(null);
      setError(null);
      const result = await discoverSource(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFound(result.found);
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
          <AlertTitle>Отвечают, но молчат: {silent.length}</AlertTitle>
          <AlertDescription>
            {silent.map((source) => `${source.label} (${source.silent_days} дн.)`).join(", ")} —
            источник жив и отвечает, но за окно свежести не дал ни одного материала.
            День-другой — обычное дело; неделя означает, что фид заброшен.
          </AlertDescription>
        </Alert>
      ) : null}

      {editable ? (
      <Card>
        <CardHeader>
          <CardTitle>Добавить источник</CardTitle>
          <CardDescription>
            Вставь ссылку — тип, адрес фида и название определятся сами. Сохраняется только то,
            что ответило хотя бы одной записью.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="input">Ссылка</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      parse();
                    }
                  }}
                  placeholder="https://www.youtube.com/@канал"
                  aria-invalid={error ? true : undefined}
                />
                <Button type="button" onClick={parse} disabled={pending || !input.trim()}>
                  <SearchIcon data-icon="inline-start" />
                  Разобрать
                </Button>
              </div>
              <FieldDescription>
                {error ??
                  "YouTube, GitHub, Substack, arXiv, Hacker News, аккаунт X, канал Telegram, " +
                    "любой блог. Адрес отправителя — рассылка из выделенного ящика. " +
                    "Без ссылки — поисковый запрос X."}
              </FieldDescription>
              {error ? null : (
                <FieldDescription>
                  Telegram — только публичные каналы с открытым веб-просмотром: закрытые
                  не читает ни бот, ни веб-страница. Почта — только выделенный ящик
                  из IMAP_URL, и только на чтение.
                </FieldDescription>
              )}
            </Field>

            {found && !plan.kinds.includes(found.kind) ? (
              <Alert>
                <AlertTitle>Тариф «{plan.label}» не берёт источники вида {found.kind}</AlertTitle>
                <AlertDescription>
                  Ссылка разобралась: {found.label}. Чтобы её добавить, нужен тариф,
                  который этот вид опрашивает.
                </AlertDescription>
              </Alert>
            ) : null}

            {found && plan.kinds.includes(found.kind) ? (
              <form
                action={(formData) =>
                  startTransition(async () => {
                    const result = await addSource(formData);
                    if (result?.error) {
                      setError(result.error);
                      return;
                    }
                    setError(null);
                    setFound(null);
                    setInput("");
                    toast.success("Источник добавлен");
                  })
                }
              >
                <input type="hidden" name="kind" value={found.kind} />
                <input type="hidden" name="url" value={found.url} />
                <input type="hidden" name="input_url" value={found.input_url} />

                <FieldGroup>
                  <div className="flex flex-col gap-1.5 rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{found.kind}</Badge>
                      <span className="text-muted-foreground">{found.via}</span>
                      <Badge variant="secondary">
                        свежих {found.fresh} из {found.entries}
                      </Badge>
                    </div>
                    <span className="text-muted-foreground truncate">{found.url}</span>
                    {found.input_url !== found.url ? (
                      <span className="text-muted-foreground truncate text-xs">
                        вставлено: {found.input_url}
                      </span>
                    ) : null}
                    <span className="truncate">{found.sample}</span>
                    {found.fresh === 0 ? (
                      <span className="text-muted-foreground text-xs">
                        Записи есть, но ни одной за окно свежести — фид, похоже, заброшен.
                      </span>
                    ) : null}
                  </div>

                  <Field>
                    <FieldLabel htmlFor="label">Название</FieldLabel>
                    <Input id="label" name="label" defaultValue={found.label} key={found.url} />
                    <FieldDescription>Взято из фида, можно переписать.</FieldDescription>
                  </Field>

                  <Button type="submit" disabled={pending} className="self-start">
                    <PlusIcon data-icon="inline-start" />
                    Добавить
                  </Button>
                </FieldGroup>
              </form>
            ) : null}
          </FieldGroup>
        </CardContent>
      </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Источники</CardTitle>
          <CardDescription>
            {sources.filter((s) => s.active).length} включено из {sources.length} · тариф
            «{plan.label}» опрашивает {plan.maxSources}
          </CardDescription>
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
                    startTransition(async () => {
                      const result = await setSourceActive(source.id, checked);
                      if (result && "error" in result) toast.error(result.error);
                    })
                  }
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{source.label}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {source.url}
                    {source.input_url && source.input_url !== source.url
                      ? ` ← ${source.input_url}`
                      : ""}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{yieldOf(source)}</span>
                </div>
                <Badge variant="outline">{source.kind}</Badge>
                {source.last_error ? (
                  <Badge variant="destructive" title={source.last_error}>ошибка</Badge>
                ) : (source.silent_days ?? 0) >= 1 ? (
                  <Badge variant="destructive">молчит {source.silent_days} дн.</Badge>
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
