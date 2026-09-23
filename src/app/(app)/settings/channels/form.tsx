"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, SparklesIcon, UploadIcon } from "lucide-react";
import { connectTelegram, rebuildVoice, saveChannelLanguage, saveStyle, toggleChannel } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SourceIcon } from "@/components/source-icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { NETWORK_IDS, NETWORKS, type NetworkId } from "@/lib/networks";
import { hasStyle, LANGUAGES, SOURCE_LANGUAGE, STYLE_LIMIT } from "@/lib/voice";
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
  oauth,
  failed,
  onboarding = false,
}: {
  channels: ReaderChannel[];
  /** «Писать черновики в моём стиле» включено. */
  styleEnabled: boolean;
  /** Текст стиля; у собранных до свитчера — карточка текстом. */
  styleText: string;
  /** Сети, где «Подключить» ведёт на вход в сеть; остальные подключаются сразу. */
  oauth: NetworkId[];
  /** Сеть, откуда вход вернулся ни с чем. */
  failed?: NetworkId;
  /** Последний шаг настройки: нужна подпись и выход в ленту. */
  onboarding?: boolean;
}) {
  const t = useT();
  const [busy, startTransition] = useTransition();
  const [building, setBuilding] = useState(false);
  // Текст стиля в поле. Отдельно от сохранённого: «Сохранить» гаснет,
  // пока правок нет, и видно, что изменения ещё не записаны.
  const [styleDraft, setStyleDraft] = useState(styleText || t.onboarding.channels.styleTemplate);
  // Свитчер включён, но стиль ещё не сохранён: включить пустой стиль нельзя,
  // поэтому поле открывается сразу, а записывается включение вместе с текстом.
  const [styleOpening, setStyleOpening] = useState(false);
  const styleOn = styleEnabled || styleOpening;
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

  const setLanguage = (network: string, language: string) => {
    startTransition(async () => {
      const result = await saveChannelLanguage(network, language);
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
      setStyleOpening(false);
      setStyleDraft(text);
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
                  {/* Язык — свойство площадки, а не стиля: в тексте стиля он
                      терялся при каждой загрузке нового skill-файла. Селект
                      нативный: в плитке 140 пикселей, а выбрать надо одно
                      из шестнадцати. */}
                  {on ? (
                    <select
                      className="mt-1 w-full truncate rounded-md border bg-transparent px-1.5 py-1 text-xs text-muted-foreground"
                      value={channel?.language ?? ""}
                      disabled={busy}
                      aria-label={t.onboarding.channels.postLanguageNamed(name)}
                      onChange={(event) => setLanguage(id, event.target.value)}
                    >
                      <option value="">{t.onboarding.channels.languageAsStyle}</option>
                      {LANGUAGES.filter((language) => language !== SOURCE_LANGUAGE).map((language) => (
                        <option key={language} value={language}>
                          {t.settings.voice.languageNames[language] ?? language}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Один блок вместо «Дай почитать свои посты» и «Как ты пишешь»:
          читатель решает одно — писать ли его стилем. Поле открыто прямо
          в карточке, пока свитчер включён: текст — вся инструкция, что
          в поле, то и уходит в промпт, и править её можно руками. */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>{t.onboarding.channels.styleTitle}</CardTitle>
              <CardDescription>
                {styleOn ? t.onboarding.channels.styleDialogText : t.onboarding.channels.styleOff}
              </CardDescription>
            </div>
            <Switch
              checked={styleOn}
              disabled={busy}
              aria-label={t.onboarding.channels.styleTitle}
              onCheckedChange={(on) => {
                if (!on) {
                  setStyleOpening(false);
                  if (styleEnabled) saveStyleAs(false, styleText);
                } else if (hasStyle(styleText)) saveStyleAs(true, styleText);
                else setStyleOpening(true);
              }}
            />
          </div>
        </CardHeader>
        {styleOn ? (
          <CardContent className="flex flex-col gap-3">
            <Textarea
              value={styleDraft}
              onChange={(event) => setStyleDraft(event.target.value)}
              maxLength={STYLE_LIMIT}
              // Высота постоянная: поле, растущее под текст, на skill-файле
              // в 6,5 тысячи знаков уносило кнопки на три экрана вниз.
              className="h-[600px] field-sizing-fixed resize-none overflow-y-auto"
              placeholder={t.onboarding.channels.stylePlaceholder}
              aria-label={t.onboarding.channels.styleTitle}
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
                {styleDraft.length} / {STYLE_LIMIT}
              </span>
              <Button
                size="sm"
                onClick={() => saveStyleAs(true, styleDraft)}
                disabled={busy || building || !hasStyle(styleDraft) || (styleEnabled && styleDraft === styleText)}
              >
                {busy ? <Spinner /> : null}
                {t.onboarding.channels.styleSave}
              </Button>
            </div>
          </CardContent>
        ) : null}
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
