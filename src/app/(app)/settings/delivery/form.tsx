"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  approveKindleSender,
  dropEmail,
  requestEmailConfirm,
  resetKindleSetup,
  saveEmailDigest,
  saveKindleDigest,
  saveKindlePeriod,
  saveKindleAddress,
  savePodcast,
  saveTimezone,
  telegramBindLink,
} from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { PaywallCrown } from "@/components/paywall";
import { FEATURES, type Plan } from "@/lib/plans";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KINDLE_PERIODS, type KindlePeriod } from "@/lib/types";
import { kindleSetupStep, type KindleStep } from "@/lib/kindle-setup";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/components/i18n-provider";
import type { Dict } from "@/lib/i18n";

const DOMAIN = "kindle.reporta.club";

// Точка входа «Manage Your Content and Devices». Ссылка ведёт на настоящий
// раздел Amazon, а не на угаданный якорь внутри него: адрес личного
// документа лежит там же, а хеш-маршруты этой страницы меняются.
const AMAZON_SETTINGS = "https://www.amazon.com/hz/mycd/myx";

/**
 * Адрес, который копируется нажатием. Его переносят руками в чужую форму
 * Amazon, а ошибка в одном символе не сообщает о себе ничем: письмо просто
 * не доходит. Выделять мышью адрес в предложении неудобно, поэтому нажатие.
 */
function CopyAddress({ value, t }: { value: string; t: Dict }) {
  if (!value) return <code className="font-mono">—</code>;
  return (
    // Своя подсказка вместо title: браузерная выезжает через секунду
    // с лишним и рисуется системным шрифтом — здесь она единственное,
    // что объясняет, зачем адрес подчёркнут пунктиром.
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value);
                toast.success(t.settings.delivery.kindle.addressCopied);
              } catch {
                // Буфер закрыт настройками браузера или небезопасным
                // соединением. Молчать нельзя: читатель уверен, что скопировал.
                toast.error(t.settings.delivery.kindle.copyFailed);
              }
            }}
            className="cursor-pointer font-mono underline decoration-dotted underline-offset-4 hover:text-foreground"
          />
        }
      >
        {value}
      </TooltipTrigger>
      <TooltipContent>{t.settings.delivery.kindle.copyAddress}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Пояса, которые знает браузер, с нынешним смещением: «Europe/Moscow»
 * говорит меньше, чем «Moscow · GMT+3», а искать свой пояс по имени
 * города привычнее, чем по континенту. Смещение считается только в
 * раскрытом списке: он рисуется в браузере, и расхождению ICU сервера
 * и браузера негде разойтись с гидрацией.
 */
function zoneLabel(zone: string, withOffset: boolean) {
  const city = zone.split("/").pop()!.replaceAll("_", " ");
  if (!withOffset) return city;
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value;
  return offset ? `${city} · ${offset}` : city;
}

/** Номер шага словами: «1 из 2» отвечает на вопрос «сколько ещё осталось». */
function StepMark({ now, of, title, step }: { now: number; of: number; title: string; step: (now: number, of: number) => string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        {step(now, of)}
      </span>
      <span className="text-sm font-medium">{title}</span>
    </div>
  );
}

export function DeliveryForm({
  connected,
  username,
  email,
  emailDigest,
  emailResult,
  kindleAddress,
  kindleDigest,
  kindlePeriod,
  kindleApproved,
  podcast,
  timezone,
  sender,
  plan,
}: {
  /** Тариф читателя: на бесплатном раздел виден целиком, но не работает. */
  plan: Plan;
  connected: boolean;
  username: string | null;
  /** Подтверждённая почта: вход и направление доставки. */
  email: string | null;
  /** Присылать ли выпуск письмом. */
  emailDigest: boolean;
  /** Чем кончился клик по письму подтверждения, если пришли с него. */
  emailResult: "ok" | "taken" | "expired" | null;
  kindleAddress: string;
  kindleDigest: boolean;
  /** Как часто уходит книга: каждое утро или в субботу за неделю. */
  kindlePeriod: KindlePeriod;
  kindleApproved: boolean;
  /** Присылать ли выпуск голосом вместе с сообщением. Только Pro. */
  podcast: boolean;
  /** Пояс, в 02:00 по которому собирается выпуск. */
  timezone: string;
  sender: string | null;
}) {
  const t = useT();
  const k = t.settings.delivery.kindle;
  const [pending, startTransition] = useTransition();
  // Раздел показывается целиком и на закрытом тарифе: погашенные поля
  // объясняют, что именно даёт переход, — заглушка вместо экрана не
  // объясняет ничего. Нажатие на любое из них открывает окно.
  const locked = !FEATURES.delivery.has(plan);
  // Подкаст закрыт своим пределом, а не разделом: «Доставка» открыта
  // с Plus, а озвучка — только на Pro. Проверка та же, по которой рисуется
  // корона и по которой прогон решает, собирать ли запись. Окно с
  // предложением носит с собой сама корона, поэтому хука пейвола здесь нет.
  const noAudio = !FEATURES.audio.has(plan);
  const [error, setError] = useState<string | null>(null);
  // Управляемый, а не `defaultChecked`: сохранение перерисовывает страницу
  // (`revalidatePath`), и неуправляемый тумблер получает новое начальное
  // значение уже после того, как родился, — Base UI говорит об этом
  // в консоль, а стоит за этим настоящая возможность разойтись с базой.
  const [podcastOn, setPodcastOn] = useState(podcast);
  const [zone, setZone] = useState(timezone);
  const [digestOn, setDigestOn] = useState(kindleDigest);
  // Управляемая, как и тумблер рядом: выбор перекидывается сразу, а при
  // отказе возвращается на прежний — иначе на экране стоит одно, в базе
  // другое, и узнает читатель об этом только в субботу.
  const [period, setPeriod] = useState<KindlePeriod>(kindlePeriod);

  /**
   * На каком шаге настройка Kindle. Начальное значение приходит из базы:
   * адреса нет — первый шаг, адрес есть, но отправитель не одобрен — второй,
   * одобрен — обычные настройки. Дальше шаг двигается здесь: «назад» и «вперёд»
   * внутри мастера не должны ходить в базу за тем, что уже известно.
   */
  const [step, setStep] = useState<KindleStep>(() =>
    kindleSetupStep({ kindle_address: kindleAddress || null, kindle_approved: kindleApproved }),
  );

  /**
   * Одно и то же у всех действий: ошибку показать, успех подтвердить.
   *
   * `fail` нужен тумблеру: он перекидывается сразу, до ответа, — иначе
   * щелчок выглядит потерянным полсекунды. Не сохранилось — надо вернуть
   * его обратно, иначе на экране стоит одно, а в базе другое, и узнать
   * об этом читатель сможет только по тому, что подкаст не придёт.
   */
  const run = (
    call: Promise<{ error?: string; ok?: boolean } | undefined>,
    ok: string,
    then?: () => void,
    fail?: () => void,
  ) =>
    startTransition(async () => {
      const result = await call;
      if (result?.error) {
        fail?.();
        setError(result.error);
        return;
      }
      setError(null);
      toast.success(ok);
      then?.();
    });

  return (
    <div className="flex flex-col gap-6">
      {/* Общее — то, что верно для всех направлений сразу: когда собирается
          выпуск и есть ли у него запись. Направления ниже решают только,
          куда он приходит. */}
      <Card>
        <CardHeader>
          <CardTitle>{t.nav.delivery}</CardTitle>
          <CardDescription>{t.settings.delivery.general}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
          {/* Пояс, а не время: выпуск собирается в два ночи по нему и к утру
              уже лежит в чате. Своё время доставки ничего не добавило бы —
              просыпаются позже двух почти все. */}
          <Field>
            <FieldLabel htmlFor="timezone" className="text-foreground">
              {t.settings.delivery.telegram.timezone}
            </FieldLabel>
            <Select
              value={zone}
              onValueChange={(next: string | null) => {
                if (!next || next === zone) return;
                const previous = zone;
                setZone(next);
                run(
                  saveTimezone(next),
                  t.settings.delivery.telegram.timezoneSaved,
                  undefined,
                  () => setZone(previous),
                );
              }}
            >
              <SelectTrigger id="timezone" className="w-full max-w-xs text-foreground" disabled={pending}>
                <SelectValue>{zoneLabel(zone, false)}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} className="max-h-72 w-auto min-w-(--anchor-width)">
                {Intl.supportedValuesOf("timeZone").map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {zoneLabel(entry, true)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Выпуск голосом — тумблер, а не правило тарифа: это час звука
              каждую ночь, и такое включают сами. Корона стоит по той же
              проверке, по которой работает предел. */}
          <Field orientation="horizontal">
            <Switch
              id="podcast"
              checked={podcastOn}
              disabled={pending || noAudio}
              onCheckedChange={(next: boolean) => {
                setPodcastOn(next);
                run(
                  savePodcast(next),
                  t.settings.delivery.telegram.podcastSaved,
                  undefined,
                  () => setPodcastOn(!next),
                );
              }}
            />
            <FieldContent>
              <FieldLabel htmlFor="podcast" className="items-center gap-1.5 text-foreground">
                {t.settings.delivery.telegram.podcast}
                {noAudio ? <PaywallCrown feature="audio" plan={plan} /> : null}
              </FieldLabel>
              <FieldDescription>{t.settings.delivery.telegram.podcastHint}</FieldDescription>
            </FieldContent>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>{t.settings.delivery.telegram.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          {connected ? (
            t.settings.delivery.telegram.connected(username)
          ) : (
            <>
              {/* Ссылка собирается по нажатию, а не при показе: в ней
                  подписанный номер читателя со сроком, и лежать в разметке
                  страницы ей незачем. */}
              <Button
                type="button"
                variant="outline"
                className="self-start"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await telegramBindLink();
                    if ("error" in result) return void toast.error(result.error);
                    window.location.href = result.url;
                  })
                }
              >
                {t.settings.delivery.telegram.connect}
              </Button>
              <p>{t.settings.delivery.telegram.connectHint}</p>
            </>
          )}
        </CardContent>
      </Card>

      <EmailCard
        email={email}
        digest={emailDigest}
        canRemove={connected}
        result={emailResult}
      />

      <Card>
        {/* border-b карточка предусматривает сама: он добавляет шапке нижний
            отступ и проводит линию во всю ширину, а не по ширине текста. */}
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-1.5">
            Kindle
            {locked ? <PaywallCrown feature="delivery" plan={plan} /> : null}
          </CardTitle>
          <CardDescription>
            {step === "done" ? k.descriptionDone : k.descriptionSetup}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {/* Шаг 1: куда слать. Адрес читалки знает только Amazon, поэтому
              сначала ссылка туда, а уже потом поле. */}
          {step === "address" ? (
            <form action={(fd) => run(saveKindleAddress(fd), k.addressSaved, () => setStep("sender"))}>
              <FieldGroup>
                <StepMark now={1} of={2} title={k.step1Title} step={k.step} />
                <p className="text-sm text-muted-foreground">
                  {k.openAmazon}{" "}
                  <a href={AMAZON_SETTINGS} target="_blank" rel="noreferrer"
                     className="underline underline-offset-4">
                    {k.amazonLinkLabel}
                  </a>{" "}
                  {k.afterAmazonLink}
                </p>
                <Field data-invalid={error ? true : undefined}>
                  <FieldLabel htmlFor="kindle_address">{k.addressLabel}</FieldLabel>
                  <Input
                    id="kindle_address"
                    name="kindle_address"
                    defaultValue={kindleAddress}
                    placeholder={k.addressPlaceholder}
                    aria-invalid={error ? true : undefined}
                  />
                  {error ? (
                    <FieldError>{error}</FieldError>
                  ) : (
                    <FieldDescription>{k.addressHint}</FieldDescription>
                  )}
                </Field>
                <Button type="submit" disabled={pending || locked} className="self-start">
                  {k.next}
                </Button>
              </FieldGroup>
            </form>
          ) : null}

          {/* Шаг 2: Amazon примет письмо только от адреса, который читатель
              внёс в одобренные. Проверить это снаружи нечем — подтверждает он. */}
          {step === "sender" ? (
            <FieldGroup>
              <StepMark now={2} of={2} title={k.step2Title} step={k.step} />
              <p className="text-sm text-muted-foreground">
                {k.approvedListIntro}{" "}
                <CopyAddress value={sender ? `${sender}@${DOMAIN}` : ""} t={t} />{" "}
                {k.approvedListOutro}
              </p>
              {!connected && !email ? (
                <Alert>
                  <AlertTitle>{k.connectTelegramFirst}</AlertTitle>
                  <AlertDescription>
                    {k.beforeStartCommand} <code className="font-mono">/start</code>{" "}
                    {k.afterStartCommand}
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={pending || locked}
                  onClick={() => run(approveKindleSender(), k.allSet, () => setStep("done"))}
                >
                  {k.addedDone}
                </Button>
                <Button type="button" variant="ghost" disabled={pending || locked}
                        onClick={() => setStep("address")}>
                  {k.back}
                </Button>
              </div>
            </FieldGroup>
          ) : null}

          {/* Настроено: обычные настройки. */}
          {step === "done" ? (
            <FieldGroup>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{k.addressLabel}</span>
                  <span className="text-sm text-muted-foreground">
                    {kindleAddress || k.notSet}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{k.senderLabel}</span>
                  <span className="text-sm text-muted-foreground">
                    <CopyAddress value={`${sender}@${DOMAIN}`} t={t} /> {k.approvedSuffix}
                  </span>
                </div>

                {/* Сохраняется сам, как тумблер подкаста выше: два тумблера
                    на одном экране, один по кнопке, другой без, читались бы
                    как «этот сохранился, а тот, наверное, нет». */}
                {/* Перенос обязателен: на узком экране выбор частоты
                    не помещается рядом с подписью тумблера и уезжает
                    за край — кнопка «По субботам» становится «По субб».
                    Переносится именно она, а не подпись: тумблер со своим
                    текстом — одна вещь, и разрывать их нечем. */}
                <Field orientation="horizontal" className="flex-wrap">
                  <Switch
                    id="kindle_digest"
                    checked={digestOn}
                    disabled={pending || locked}
                    onCheckedChange={(next: boolean) => {
                      setDigestOn(next);
                      run(saveKindleDigest(next), k.saved, undefined, () => setDigestOn(!next));
                    }}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="kindle_digest">
                      {k.sendToKindle}
                    </FieldLabel>
                    <FieldDescription>{k.sendToKindleHint(digestOn, period)}</FieldDescription>
                  </FieldContent>
                  {/* Частота — рядом с тумблером, и только при включённом:
                      выбор, как часто присылать то, что не присылается,
                      предлагал бы настроить несуществующее. Сохраняется сам,
                      как и тумблер: две соседние настройки, одна по кнопке,
                      другая без, читались бы как «эта сохранилась, а та,
                      наверное, нет». */}
                  {digestOn ? (
                    <ToggleGroup
                      aria-label={k.periodLabel}
                      value={[period]}
                      onValueChange={(value: string[]) => {
                        const next = value[0] as KindlePeriod | undefined;
                        // Повторное нажатие на выбранную кнопку приходит
                        // пустым списком: у группы это «снять выбор»,
                        // а периодичности без значения не бывает.
                        if (!next || next === period) return;
                        const prev = period;
                        setPeriod(next);
                        run(saveKindlePeriod(next), k.saved, undefined, () => setPeriod(prev));
                      }}
                      variant="outline"
                      disabled={pending || locked}
                      className="ml-auto shrink-0 max-sm:mt-1 max-sm:ml-0 max-sm:basis-full"
                    >
                      {KINDLE_PERIODS.map((id) => (
                        <ToggleGroupItem key={id} value={id} className="px-3">
                          {k.period[id]}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  ) : null}
                </Field>

                <div className="flex flex-wrap items-center gap-4">
                  {/* Красный по наведению: сброс стирает адрес читалки
                      и снимает отметку об одобрении отправителя — до конца
                      повторной настройки выпуски не доходят вовсе. */}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          disabled={pending || locked}
                          onClick={() =>
                            run(resetKindleSetup(), k.setupReset, () => setStep("address"))
                          }
                          className="cursor-pointer text-sm text-muted-foreground underline underline-offset-4 hover:text-destructive disabled:opacity-50"
                        />
                      }
                    >
                      {k.resetLink}
                    </TooltipTrigger>
                    <TooltipContent>{k.resetTooltip}</TooltipContent>
                  </Tooltip>
                </div>
            </FieldGroup>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Почта как направление. Адрес появляется только подтверждённым —
 * до клика по письму его нет ни в базе, ни здесь: вписанный чужой ящик
 * иначе получал бы наши письма каждую ночь.
 */
function EmailCard({
  email,
  digest,
  canRemove,
  result,
}: {
  email: string | null;
  digest: boolean;
  /** Убрать можно, только если есть Telegram: иначе почта — единственный вход. */
  canRemove: boolean;
  result: "ok" | "taken" | "expired" | null;
}) {
  const t = useT();
  const e = t.settings.delivery.email;
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useState(digest);
  const [editing, setEditing] = useState(!email);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Ответ подтверждения — один раз, при приходе со ссылки.
  const told = useRef(false);
  useEffect(() => {
    if (!result || told.current) return;
    told.current = true;
    if (result === "ok") toast.success(e.confirmed);
    else toast.error(result === "taken" ? e.confirmTaken : e.confirmExpired);
  }, [result, e]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{e.title}</CardTitle>
        <CardDescription>{e.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
        {email ? (
          <>
            <p>{e.address(email)}</p>
            <Field orientation="horizontal">
              <Switch
                id="email_digest"
                checked={on}
                disabled={pending}
                onCheckedChange={(next: boolean) => {
                  setOn(next);
                  startTransition(async () => {
                    const saved = await saveEmailDigest(next);
                    if ("error" in saved && saved.error) {
                      setOn(!next);
                      toast.error(saved.error);
                    } else toast.success(next ? e.digestOn : e.digestOff);
                  });
                }}
              />
              <FieldContent>
                <FieldLabel htmlFor="email_digest" className="text-foreground">{e.digest}</FieldLabel>
                <FieldDescription>{e.digestHint}</FieldDescription>
              </FieldContent>
            </Field>
          </>
        ) : null}

        {sentTo ? (
          <p role="status">{e.sent(sentTo)}</p>
        ) : editing ? (
          <form
            action={(fd) =>
              startTransition(async () => {
                const address = String(fd.get("email") ?? "");
                const sent = await requestEmailConfirm(address);
                if ("error" in sent) return void setError(sent.error);
                setError(null);
                setSentTo(address.trim());
              })
            }
          >
            <FieldGroup>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="email" className="text-foreground">{e.label}</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder={e.placeholder}
                  aria-invalid={error ? true : undefined}
                  className="max-w-xs"
                />
                {error ? <FieldError>{error}</FieldError> : null}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="outline" disabled={pending}>
                  {e.confirm}
                </Button>
                {email ? (
                  <Button type="button" variant="ghost" onClick={() => { setEditing(false); setError(null); }}>
                    {e.cancel}
                  </Button>
                ) : null}
              </div>
            </FieldGroup>
          </form>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="cursor-pointer text-sm underline underline-offset-4 hover:text-foreground"
            >
              {e.change}
            </button>
            {canRemove ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const dropped = await dropEmail();
                    if ("error" in dropped) toast.error(dropped.error);
                    else toast.success(e.removed);
                  })
                }
                className="cursor-pointer text-sm underline underline-offset-4 hover:text-foreground"
              >
                {e.remove}
              </button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
