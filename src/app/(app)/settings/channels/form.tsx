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
import { useT } from "@/components/i18n-provider";
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
  const t = useT();
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
      toast.success(t.onboarding.channels.added(result.label), {
        description: t.onboarding.channels.rebuildHint,
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
    toast.success(t.onboarding.channels.builtToast(result.built_from), {
      description: result.ranked
        ? t.onboarding.channels.builtWithViews
        : t.onboarding.channels.builtWithoutStats,
    });
    if (result.failed.length) toast.warning(result.failed.join("; "));
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{onboarding ? t.onboarding.channels.lastStepTitle : t.nav.channels}</CardTitle>
          <CardDescription>{t.onboarding.channels.description}</CardDescription>
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
                placeholder={t.onboarding.channels.addPlaceholder}
                disabled={busy}
              />
              <Button onClick={add} disabled={busy || !input.trim()}>
                <PlusIcon />
                {t.onboarding.channels.add}
              </Button>
            </div>
            <FieldDescription>{t.onboarding.channels.addDescription}</FieldDescription>
          </Field>

          <FieldGroup>
            {NETWORK_IDS.filter((id) => NETWORKS[id].tab).map((id) => {
              const network = NETWORKS[id];
              const mine = byNetwork.get(id);
              return (
                <div key={id} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {t.onboarding.networks[id]}
                      {mine?.handle ? (
                        <Badge variant="secondary">{t.onboarding.channels.readableBadge}</Badge>
                      ) : network.readable ? null : (
                        <Badge variant="outline">{t.onboarding.channels.pasteOnlyBadge}</Badge>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {mine?.input_url || mine?.label || t.onboarding.channels.charLimit(network.limit)}
                    </span>
                  </div>
                  <Switch
                    checked={Boolean(mine)}
                    onCheckedChange={(on) => toggle(id, on)}
                    disabled={busy}
                    aria-label={t.onboarding.channels.publishingIn(t.onboarding.networks[id])}
                  />
                </div>
              );
            })}
          </FieldGroup>

          {byNetwork.get("blog") ? (
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{t.onboarding.channels.blogLabel}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {byNetwork.get("blog")?.input_url ?? byNetwork.get("blog")?.handle}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t.onboarding.channels.removeBlog}
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
          {t.onboarding.channels.toFeed}
        </Button>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t.onboarding.channels.voiceTitle}</CardTitle>
          <CardDescription>{t.onboarding.channels.voiceDescription}</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Button onClick={build} disabled={building}>
              {building ? <Spinner /> : <RefreshCwIcon />}
              {t.onboarding.channels.rebuildVoice}
            </Button>
            <span className="text-xs text-muted-foreground">
              {card && builtAt
                ? t.onboarding.channels.builtSummary(
                    relativeTime(new Date(builtAt), t.feed.time),
                    card.built_from,
                    card.ranked,
                    Boolean(card.structure?.length),
                  )
                : t.onboarding.channels.notBuiltYet}
            </span>
          </div>

          {card?.voice?.length ? (
            <div className="flex flex-col gap-3 text-sm">
              {/* Форма впереди голоса: пост выдаёт себя чужой формой раньше,
                  чем чужими словами, и проверять глазами надо сначала её. */}
              {card.structure?.length ? (
                <CardList title={t.onboarding.channels.structureTitle} lines={card.structure} />
              ) : null}
              {card.hooks?.length ? (
                <CardList title={t.onboarding.channels.hooksTitle} lines={card.hooks} />
              ) : null}
              <CardList title={t.onboarding.channels.voiceListTitle} lines={card.voice} />
              {card.frame.length ? (
                <CardList title={t.onboarding.channels.frameTitle} lines={card.frame} />
              ) : (
                <Alert>
                  <AlertTitle>{t.onboarding.channels.noFrameTitle}</AlertTitle>
                  <AlertDescription>{t.onboarding.channels.noFrameDescription}</AlertDescription>
                </Alert>
              )}
              {card.taboo.length ? (
                <CardList title={t.onboarding.channels.tabooTitle} lines={card.taboo} />
              ) : null}
            </div>
          ) : null}

          <Field>
            <Textarea
              name="sample"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={8}
              placeholder={t.onboarding.channels.samplePlaceholder}
            />
            <FieldDescription>{t.onboarding.channels.sampleDescription}</FieldDescription>
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
                  else
                    toast.success(t.onboarding.channels.saved, {
                      description: t.onboarding.channels.savedDescription,
                    });
                })
              }
            >
              {t.onboarding.channels.save}
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
