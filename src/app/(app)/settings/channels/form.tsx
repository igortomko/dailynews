"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, RefreshCwIcon, TrashIcon } from "lucide-react";
import { addChannel, forgetChannel, rebuildVoice, saveSample, toggleChannel } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { SourceIcon } from "@/components/source-icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { NETWORK_IDS, NETWORKS, type NetworkId } from "@/lib/networks";
import { relativeTime } from "@/lib/relative-time";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import type { ReaderChannel, VoiceCardRow } from "@/lib/types";

/**
 * Черновики постов: три блока, и каждый назван вопросом, на который отвечает.
 *
 * «Мои площадки» не отвечали ни на один. В одном списке стояли две разные
 * вещи: где он публикует (отметка даёт таб в черновике) и откуда мы читаем
 * его тексты, — а вторая половина того же дела, вставленные руками посты,
 * лежала вообще в другой карточке под заголовком «Мой голос». Ссылка
 * на канал и вставленный текст делают одно: дают ленте почитать его посты.
 * Теперь они рядом, а отметки сетей остались отдельно и легли в ряд —
 * четыре одинаковых плитки читаются взглядом, а не построчно.
 *
 * Карточка автора показывается как есть. Скрыть её было бы удобнее на вид
 * и хуже по делу: пост пишется по этим строкам, и если разобрано
 * неправильно, увидеть это можно только прочитав их.
 */
/**
 * Откуда берётся значок площадки. Telegram рисуется своим знаком, у X
 * значок зашит в сам `SourceIcon`, остальным нужен домен — favicon берётся
 * с него же, а не через чужой сервис.
 */
const ICON_KIND: Record<NetworkId, "telegram" | "x" | "rss"> = {
  telegram: "telegram",
  x: "x",
  linkedin: "rss",
  threads: "rss",
  blog: "rss",
};

const NETWORK_HOME: Record<NetworkId, string> = {
  telegram: "https://t.me",
  x: "https://x.com",
  linkedin: "https://www.linkedin.com",
  threads: "https://www.threads.net",
  blog: "",
};

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
  // осталась бы с прежними пропсами, и разобранное выглядело бы
  // как неразобранное — тот самый отказ, похожий на успех.
  const router = useRouter();

  const byNetwork = new Map(channels.map((channel) => [channel.network, channel]));
  // Что лента читает прямо сейчас. Адрес есть только там, где его можно
  // прочитать: у LinkedIn и Threads его не бывает по устройству сети.
  const reads = channels.filter((channel) => channel.handle);

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

  // Убрать адрес — не то же самое, что снять галочку: галочка гасит таб
  // в черновике, а это говорит «не читайте меня отсюда». Пока это было
  // одним действием, снятая галочка уносила канал вместе с голосом.
  const forget = (network: string) => {
    startTransition(async () => {
      const result = await forgetChannel(network);
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
          <CardTitle>
            {onboarding ? t.onboarding.channels.lastStepTitle : t.onboarding.channels.postingTitle}
          </CardTitle>
          <CardDescription>{t.onboarding.channels.postingDescription}</CardDescription>
        </CardHeader>

        <CardContent>
          {/* Четыре сети в ряд, а не списком: строки различались только
              названием, и глаз всё равно читал их как один ряд знаков.
              Отметка стоит под описанием, потому что решение принимается
              после него, а не до. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {NETWORK_IDS.filter((id) => NETWORKS[id].tab).map((id) => {
              const on = Boolean(byNetwork.get(id)?.publishes);
              return (
                // Плитка целиком — ярлык отметки: попасть в квадрат 16×16
                // пальцем можно, но промах здесь ничего не говорит о том,
                // куда надо было попасть.
                <label
                  key={id}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors",
                    on ? "border-primary/30 bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  {/* Значок общий с источниками: площадка и источник —
                      один и тот же список чужих сервисов, и узнаются они
                      знаком раньше, чем названием. */}
                  <SourceIcon kind={ICON_KIND[id]} url={NETWORK_HOME[id]} className="size-5" />
                  <span className="text-sm font-medium">{t.onboarding.networks[id]}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.onboarding.channels.charLimit(NETWORKS[id].limit)}
                  </span>
                  <Checkbox
                    className="mt-1"
                    checked={on}
                    onCheckedChange={(next) => toggle(id, next === true)}
                    disabled={busy}
                    aria-label={t.onboarding.channels.publishingIn(t.onboarding.networks[id])}
                  />
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.onboarding.channels.sourcesTitle}</CardTitle>
          <CardDescription>{t.onboarding.channels.sourcesDescription}</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
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

          {reads.length ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t.onboarding.channels.readingFrom}
              </span>
              {reads.map((channel) => {
                const id = channel.network as NetworkId;
                const address = channel.input_url ?? channel.handle ?? "";
                return (
                  <div key={id} className="flex items-center gap-3 py-1.5">
                    <SourceIcon
                      kind={ICON_KIND[id] ?? "rss"}
                      url={address || NETWORK_HOME[id]}
                      className="size-4 shrink-0"
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium">{t.onboarding.networks[id]}</span>
                      <span className="truncate text-xs text-muted-foreground">{address}</span>
                    </div>
                    {/* Кнопка стоит там же, где показан адрес, и говорит
                        ровно про него: отметка сверху отвечает на «публикую
                        ли я здесь», а это — на «читать ли меня отсюда». */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t.onboarding.channels.stopReading(t.onboarding.networks[id])}
                      onClick={() => forget(id)}
                      disabled={busy}
                    >
                      <TrashIcon />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <Field>
            <FieldTitle>{t.onboarding.channels.pasteTitle}</FieldTitle>
            <Textarea
              name="sample"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={8}
              placeholder={t.onboarding.channels.samplePlaceholder}
            />
            <FieldDescription>{t.onboarding.channels.sampleDescription}</FieldDescription>
          </Field>

          {/* Кнопка стоит вне `Field`: он растягивает детей на всю ширину,
              и «Сохранить» выходило полосой во всю карточку — крупнее
              «Перечитать мои посты», которое здесь главное действие. */}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.onboarding.channels.voiceTitle}</CardTitle>
          <CardDescription>{t.onboarding.channels.voiceDescription}</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
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
        </CardContent>
      </Card>

      {/* Выход в ленту стоит после всех трёх блоков, а не между первым
          и вторым: посреди настройки он звал уйти раньше, чем прочитано
          хоть что-то, — и черновик вышел бы не его. */}
      {onboarding ? (
        <Button variant="outline" className="self-start" render={<Link href="/" />}>
          {t.onboarding.channels.toFeed}
        </Button>
      ) : null}
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
