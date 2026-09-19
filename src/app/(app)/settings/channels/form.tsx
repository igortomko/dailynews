"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, RefreshCwIcon, TrashIcon } from "lucide-react";
import { addChannel, rebuildVoice, saveSample, toggleChannel } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup } from "@/components/ui/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { NETWORK_IDS, NETWORKS } from "@/lib/networks";
import { relativeTime } from "@/lib/relative-time";
import type { ReaderChannel, VoiceCardRow } from "@/lib/types";

/**
 * Мои площадки.
 *
 * Две разные вещи в одном списке, и путать их нельзя: откуда берётся голос
 * (читаемое — канал Telegram, блог по RSS, твиты) и куда он публикует
 * (там же плюс LinkedIn и Threads, которые наружу не отдают ничего).
 * Поэтому у сети две отметки: переключатель «публикую здесь» даёт таб
 * в мотатке, а ссылка рядом — то, по чему собран голос.
 *
 * Карточка автора показывается как есть. Скрыть её было бы удобнее на вид
 * и хуже по делу: пост пишется по этим строкам, и если голос описан
 * неправильно, увидеть это можно только прочитав их.
 */
export function ChannelsForm({
  channels,
  card,
  builtAt,
  sample,
  onboarding = false,
}: {
  channels: ReaderChannel[];
  card: VoiceCardRow | null;
  builtAt: string | null;
  sample: string;
  /** Последний шаг настройки: нужна подпись и выход в ленту. */
  onboarding?: boolean;
}) {
  const [input, setInput] = useState("");
  const [text, setText] = useState(sample);
  const [busy, startTransition] = useTransition();
  const [building, setBuilding] = useState(false);
  // Карточка приходит с сервера, а форма клиентская: без обновления она
  // осталась бы с прежними пропсами, и собранный голос выглядел бы
  // как несобранный — тот самый отказ, похожий на успех.
  const router = useRouter();

  const byNetwork = new Map(channels.map((channel) => [channel.network, channel]));

  const add = () => {
    const value = input.trim();
    if (!value) return;
    startTransition(async () => {
      const result = await addChannel(value);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setInput("");
      toast.success(`Добавлено: ${result.label}`, {
        description: "Собери голос заново, чтобы лента прочитала посты",
      });
      router.refresh();
    });
  };

  const toggle = (network: string, on: boolean) => {
    startTransition(async () => {
      const result = await toggleChannel(network, on);
      if ("error" in result) toast.error(result.error);
      else router.refresh();
    });
  };

  const build = async () => {
    setBuilding(true);
    const result = await rebuildVoice();
    setBuilding(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    router.refresh();
    toast.success(`Голос собран по ${result.built_from} постам`, {
      description: result.ranked
        ? "Просмотры посчитаны: каркас удачных постов взят из них"
        : "Статистики у постов нет — собран только голос, без каркаса",
    });
    if (result.failed.length) toast.warning(result.failed.join("; "));
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{onboarding ? "Последний шаг: твои площадки" : "Мои площадки"}</CardTitle>
          <CardDescription>
            Где ты публикуешь — столько табов будет в «Своём мнении». Откуда лента может
            прочитать твои посты — оттуда берётся голос: публичный канал Telegram, блог
            по RSS и аккаунт X. LinkedIn и Threads наружу не отдают ничего, для них
            вставь несколько постов ниже.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <Field>
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    add();
                  }
                }}
                placeholder="t.me/канал, x.com/ник или адрес блога"
                disabled={busy}
              />
              <Button onClick={add} disabled={busy || !input.trim()}>
                <PlusIcon />
                Добавить
              </Button>
            </div>
            <FieldDescription>
              Адрес разбирается той же проверкой, что и источники: сохраняется только то,
              что ответило хотя бы одним постом.
            </FieldDescription>
          </Field>

          <FieldGroup>
            {NETWORK_IDS.filter((id) => NETWORKS[id].tab).map((id) => {
              const network = NETWORKS[id];
              const mine = byNetwork.get(id);
              return (
                <div key={id} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {network.label}
                      {mine?.handle ? (
                        <Badge variant="secondary">голос читается</Badge>
                      ) : network.readable ? null : (
                        <Badge variant="outline">только вставкой</Badge>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {mine?.input_url || mine?.label || `до ${network.limit} символов`}
                    </span>
                  </div>
                  <Switch
                    checked={Boolean(mine)}
                    onCheckedChange={(on) => toggle(id, on)}
                    disabled={busy}
                    aria-label={`Публикую в ${network.label}`}
                  />
                </div>
              );
            })}
          </FieldGroup>

          {byNetwork.get("blog") ? (
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">Блог</span>
                <span className="truncate text-xs text-muted-foreground">
                  {byNetwork.get("blog")?.input_url ?? byNetwork.get("blog")?.handle}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Убрать блог"
                onClick={() => toggle("blog", false)}
                disabled={busy}
              >
                <TrashIcon />
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {onboarding ? (
        <Button variant="outline" className="self-start" render={<Link href="/" />}>
          В ленту
        </Button>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Мой голос</CardTitle>
          <CardDescription>
            Форма — из каких блоков собран твой пост и чем ты его открываешь; голос —
            ритм, лицо, длина, эмодзи, место ссылки. Форма важнее: пост твоими словами,
            но собранный новостной заметкой, читается как чужой с первой строки.
            Два-три твоих поста уходят в промпт целиком — как образец, а не как факты.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Button onClick={build} disabled={building}>
              {building ? <Spinner /> : <RefreshCwIcon />}
              Собрать голос заново
            </Button>
            <span className="text-xs text-muted-foreground">
              {card && builtAt
                ? `Собран ${relativeTime(new Date(builtAt))} по ${card.built_from} постам${
                    card.ranked ? " с просмотрами" : " без статистики"
                  }${card.structure?.length ? "" : " — без формы, собери заново"}`
                : "Ещё не собран: посты пишутся настройками подачи"}
            </span>
          </div>

          {card?.voice?.length ? (
            <div className="flex flex-col gap-3 text-sm">
              {/* Форма впереди голоса: пост выдаёт себя чужой формой раньше,
                  чем чужими словами, и проверять глазами надо сначала её. */}
              {card.structure?.length ? <CardList title="Форма поста" lines={card.structure} /> : null}
              {card.hooks?.length ? <CardList title="Чем открываешь" lines={card.hooks} /> : null}
              <CardList title="Голос" lines={card.voice} />
              {card.frame.length ? (
                <CardList title="Каркас удачных постов" lines={card.frame} />
              ) : (
                <Alert>
                  <AlertTitle>Каркаса нет</AlertTitle>
                  <AlertDescription>
                    Статистики у прочитанных постов не нашлось, поэтому чем твои удачные
                    посты отличаются от средних — неизвестно, и выдумывать это лента
                    не станет. Добавь публичный канал Telegram или аккаунт X: просмотры
                    там видны.
                  </AlertDescription>
                </Alert>
              )}
              {card.taboo.length ? <CardList title="Чего у тебя не бывает" lines={card.taboo} /> : null}
            </div>
          ) : null}

          <Field>
            <Textarea
              name="sample"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={8}
              placeholder={"Вставь три своих поста, разделяя пустой строкой.\n\nНужно для LinkedIn и Threads: оттуда прочитать посты нельзя."}
            />
            <FieldDescription>
              Посты разделяются пустой строкой. Просмотров у вставленного нет, поэтому
              из него берётся голос, но не каркас.
            </FieldDescription>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={busy || text === sample}
              onClick={() =>
                startTransition(async () => {
                  const form = new FormData();
                  form.set("sample", text);
                  const result = await saveSample(form);
                  if ("error" in result) toast.error(result.error);
                  else toast.success("Сохранено", { description: "Собери голос заново" });
                })
              }
            >
              Сохранить
            </Button>
          </Field>
        </CardContent>
      </Card>
    </div>
  );
}

function CardList({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </span>
      <ul className="flex flex-col gap-1">
        {lines.map((line) => (
          <li key={line} className="flex gap-2 text-foreground/80">
            <span className="text-muted-foreground/60">—</span>
            <span className="text-pretty">{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
