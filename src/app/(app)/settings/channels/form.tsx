"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, PlusIcon, SparklesIcon, TrashIcon, UploadIcon } from "lucide-react";
import { addChannel, connectTelegram, forgetChannel, rebuildVoice, saveSample, saveStyle, toggleChannel } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SourceIcon } from "@/components/source-icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldTitle } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { NETWORK_IDS, NETWORKS, type NetworkId } from "@/lib/networks";
import { STYLE_LIMIT } from "@/lib/voice";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import type { ReaderChannel } from "@/lib/types";

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
  styleEnabled,
  styleText,
  sample,
  oauth,
  failed,
  onboarding = false,
}: {
  channels: ReaderChannel[];
  /** «Писать черновики в моём стиле» включено. */
  styleEnabled: boolean;
  /** Текст стиля; у собранных до свитчера — карточка текстом. */
  styleText: string;
  sample: string;
  /** Сети, где «Подключить» ведёт на вход в сеть; остальные подключаются сразу. */
  oauth: NetworkId[];
  /** Сеть, откуда вход вернулся ни с чем. */
  failed?: NetworkId;
  /** Последний шаг настройки: нужна подпись и выход в ленту. */
  onboarding?: boolean;
}) {
  const t = useT();
  const [input, setInput] = useState("");
  const [text, setText] = useState(sample);
  const [busy, startTransition] = useTransition();
  const [building, setBuilding] = useState(false);
  // Окно стиля: null — закрыто, строка — черновик текста в поле. Черновик
  // живёт отдельно от сохранённого: «Отмена» не должна ничего менять.
  const [styleDraft, setStyleDraft] = useState<string | null>(null);
  // Карточка приходит с сервера, а форма клиентская: без обновления она
  // осталась бы с прежними пропсами, и разобранное выглядело бы
  // как неразобранное — тот самый отказ, похожий на успех.
  const router = useRouter();

  useEffect(() => {
    if (!failed || !NETWORK_IDS.includes(failed)) return;
    toast.error(t.onboarding.channels.connectFailed(t.onboarding.networks[failed]));
    router.replace(onboarding ? "/settings/channels?first=1" : "/settings/channels");
  }, [failed, onboarding, router, t]);

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

  // Окно канала Telegram: null — закрыто. Окно, а не поле в плитке:
  // в плитку шириной 140 пикселей влезало «t.me/ка», и что туда нужен
  // существующий публичный канал, а не свой ник, сказать было негде.
  const [channelInput, setChannelInput] = useState<string | null>(null);

  const connectChannel = () => {
    const value = channelInput?.trim();
    if (!value) return;
    startTransition(async () => {
      const result = await connectTelegram(value);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setChannelInput(null);
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

  // «Изучи мой стиль»: разбор ложится в поле, а не в базу. Сохраняет автор,
  // прочитав: разбор чужого публичного канала моделью не должен сам
  // становиться инструкцией для следующих черновиков.
  const learn = async () => {
    setBuilding(true);
    const result = await rebuildVoice();
    setBuilding(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setStyleDraft(result.text);
    toast.success(t.onboarding.channels.styleLearned(result.built_from));
    if (result.failed.length) toast.warning(result.failed.join("; "));
  };

  // Skill-файл читается в браузере и тоже ложится в поле: что уйдёт
  // в промпт, автор видит целиком до сохранения.
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name) && !file.type.startsWith("text/")) {
      toast.error(t.onboarding.channels.skillWrongType);
      return;
    }
    setStyleDraft((await file.text()).slice(0, STYLE_LIMIT));
  };

  const saveStyleAs = (enabled: boolean, text: string) =>
    startTransition(async () => {
      const result = await saveStyle(enabled, text);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setStyleDraft(null);
      if (enabled) toast.success(t.onboarding.channels.styleSaved);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <Dialog open={channelInput !== null} onOpenChange={(open) => !open && setChannelInput(null)}>
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              connectChannel();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t.onboarding.channels.channelDialogTitle}</DialogTitle>
              <DialogDescription>{t.onboarding.channels.channelDialogText}</DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={channelInput ?? ""}
              onChange={(event) => setChannelInput(event.target.value)}
              placeholder={t.onboarding.channels.channelPlaceholder}
              aria-label={t.onboarding.channels.channelDialogTitle}
              disabled={busy}
            />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>
                {t.onboarding.channels.channelDialogCancel}
              </DialogClose>
              <Button type="submit" disabled={busy || !channelInput?.trim()}>
                {busy ? <Spinner /> : null}
                {t.onboarding.channels.connect}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>
            {onboarding ? t.onboarding.channels.lastStepTitle : t.onboarding.channels.postingTitle}
          </CardTitle>
          <CardDescription>{t.onboarding.channels.postingDescription}</CardDescription>
        </CardHeader>

        <CardContent>
          {/* Четыре сети в ряд, а не списком: строки различались только
              названием, и глаз всё равно читал их как один ряд знаков. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {NETWORK_IDS.filter((id) => NETWORKS[id].tab).map((id) => {
              const channel = byNetwork.get(id);
              const on = Boolean(channel?.publishes);
              const name = t.onboarding.networks[id];
              // У Telegram подключается канал, а не профиль: без названного
              // канала «Подключить» сначала спрашивает ссылку на него.
              const account =
                id === "telegram" ? (channel?.handle ? `@${channel.handle}` : null) : channel?.account;
              const asksChannel = id === "telegram" && !channel?.handle;
              return (
                <div
                  key={id}
                  className={cn(
                    "group flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors",
                    on && "border-primary/30 bg-primary/5",
                  )}
                >
                  {/* Значок общий с источниками: площадка и источник —
                      один и тот же список чужих сервисов, и узнаются они
                      знаком раньше, чем названием. */}
                  <SourceIcon kind={ICON_KIND[id]} url={NETWORK_HOME[id]} className="size-5" />
                  <span className="text-sm font-medium">{name}</span>
                  <span className="min-h-4 truncate text-xs text-muted-foreground">
                    {on ? account : null}
                  </span>
                  {on ? (
                    // Одна кнопка, а не две: «Подключено» по наведению
                    // становится «Отключить» — как «Following» у GitHub.
                    // Второй кнопке рядом в плитке 140 пикселей не хватает.
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1"
                      onClick={() => toggle(id, false)}
                      disabled={busy}
                      aria-label={t.onboarding.channels.disconnectNamed(name)}
                    >
                      <span className="flex items-center gap-1 group-hover:hidden group-focus-within:hidden">
                        <CheckIcon />
                        {t.onboarding.channels.connected}
                      </span>
                      <span className="hidden text-destructive group-hover:inline group-focus-within:inline">
                        {t.onboarding.channels.disconnect}
                      </span>
                    </Button>
                  ) : oauth.includes(id) ? (
                    // Обычная ссылка, а не Link: адрес — редирект на экран
                    // сети, а не страница приложения.
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1"
                      aria-label={t.onboarding.channels.connectNamed(name)}
                      render={<a href={`/api/connect/${id}${onboarding ? "?first=1" : ""}`} />}
                    >
                      {t.onboarding.channels.connect}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1"
                      onClick={() => (asksChannel ? setChannelInput("") : toggle(id, true))}
                      disabled={busy}
                      aria-label={t.onboarding.channels.connectNamed(name)}
                    >
                      {t.onboarding.channels.connect}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Один блок вместо «Дай почитать свои посты» и «Как ты пишешь»:
          читатель решает одно — писать ли его стилем, — а откуда стиль
          взят, дело второе и живёт в окне. Текст в окне — вся инструкция:
          что в поле, то и уходит в промпт, и править её можно руками. */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>{t.onboarding.channels.styleTitle}</CardTitle>
              {styleEnabled ? null : (
                <CardDescription>{t.onboarding.channels.styleOff}</CardDescription>
              )}
            </div>
            <Switch
              checked={styleEnabled}
              disabled={busy}
              aria-label={t.onboarding.channels.styleTitle}
              onCheckedChange={(on) => (on ? setStyleDraft(styleText) : saveStyleAs(false, styleText))}
            />
          </div>
        </CardHeader>
        {styleEnabled ? (
          <CardContent className="flex flex-col items-start gap-3">
            <p className="line-clamp-4 whitespace-pre-line text-sm text-muted-foreground">{styleText}</p>
            <Button variant="outline" size="sm" onClick={() => setStyleDraft(styleText)}>
              {t.onboarding.channels.styleEdit}
            </Button>
          </CardContent>
        ) : null}
      </Card>

      <Dialog open={styleDraft !== null} onOpenChange={(open) => !open && setStyleDraft(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.onboarding.channels.styleDialogTitle}</DialogTitle>
            <DialogDescription>{t.onboarding.channels.styleDialogText}</DialogDescription>
          </DialogHeader>

          <Textarea
            value={styleDraft ?? ""}
            onChange={(event) => setStyleDraft(event.target.value)}
            rows={12}
            maxLength={STYLE_LIMIT}
            placeholder={t.onboarding.channels.stylePlaceholder}
            aria-label={t.onboarding.channels.styleDialogTitle}
            disabled={busy || building}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={learn} disabled={busy || building}>
              {building ? <Spinner /> : <SparklesIcon />}
              {t.onboarding.channels.learnStyle}
            </Button>
            <Button variant="outline" size="sm" disabled={busy || building} render={<label />}>
              <UploadIcon />
              {t.onboarding.channels.uploadSkill}
              <input
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                className="sr-only"
                onChange={(event) => {
                  void upload(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </Button>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {(styleDraft ?? "").length} / {STYLE_LIMIT}
            </span>
          </div>

          {/* Откуда изучать — вторым планом: нужно тому, кто жмёт «Изучи»,
              и больше никому. */}
          <details className="group rounded-lg border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">{t.onboarding.channels.styleSourcesTitle}</summary>
            <div className="flex flex-col gap-4 pt-3">
              <p className="text-muted-foreground">{t.onboarding.channels.styleSourcesText}</p>
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

              {reads.length ? (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t.onboarding.channels.readingFrom}
                  </span>
                  {reads.map((channel) => {
                    const id = channel.network as NetworkId;
                    const address = channel.input_url ?? channel.handle ?? "";
                    return (
                      <div key={id} className="flex items-center gap-3 py-1">
                        <SourceIcon
                          kind={ICON_KIND[id] ?? "rss"}
                          url={address || NETWORK_HOME[id]}
                          className="size-4 shrink-0"
                        />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="font-medium">{t.onboarding.networks[id]}</span>
                          <span className="truncate text-xs text-muted-foreground">{address}</span>
                        </div>
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
                  rows={5}
                  placeholder={t.onboarding.channels.samplePlaceholder}
                />
              </Field>
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
                    else toast.success(t.onboarding.channels.saved);
                  })
                }
              >
                {t.onboarding.channels.save}
              </Button>
            </div>
          </details>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>
              {t.onboarding.channels.channelDialogCancel}
            </DialogClose>
            <Button onClick={() => saveStyleAs(true, styleDraft ?? "")} disabled={busy || building || !styleDraft?.trim()}>
              {busy ? <Spinner /> : null}
              {t.onboarding.channels.styleSave}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
