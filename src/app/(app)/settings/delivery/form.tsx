"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  approveKindleSender,
  resetKindleSetup,
  saveKindleDigest,
  saveKindleAddress,
} from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { PaywallCrown } from "@/components/paywall";
import { FEATURES, type Plan } from "@/lib/plans";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { kindleSetupStep, type KindleStep } from "@/lib/kindle-setup";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/components/i18n-provider";
import type { Dict } from "@/lib/i18n";

const DOMAIN = "kindle.tomko.io";

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
  kindleAddress,
  kindleDigest,
  kindleApproved,
  sender,
  plan,
}: {
  /** Тариф читателя: на бесплатном раздел виден целиком, но не работает. */
  plan: Plan;
  connected: boolean;
  username: string | null;
  kindleAddress: string;
  kindleDigest: boolean;
  kindleApproved: boolean;
  sender: string | null;
}) {
  const t = useT();
  const k = t.settings.delivery.kindle;
  const [pending, startTransition] = useTransition();
  // Раздел показывается целиком и на закрытом тарифе: погашенные поля
  // объясняют, что именно даёт переход, — заглушка вместо экрана не
  // объясняет ничего. Нажатие на любое из них открывает окно.
  const locked = !FEATURES.delivery.has(plan);
  const [error, setError] = useState<string | null>(null);

  /**
   * На каком шаге настройка Kindle. Начальное значение приходит из базы:
   * адреса нет — первый шаг, адрес есть, но отправитель не одобрен — второй,
   * одобрен — обычные настройки. Дальше шаг двигается здесь: «назад» и «вперёд»
   * внутри мастера не должны ходить в базу за тем, что уже известно.
   */
  const [step, setStep] = useState<KindleStep>(() =>
    kindleSetupStep({ kindle_address: kindleAddress || null, kindle_approved: kindleApproved }),
  );

  /** Одно и то же у всех трёх действий: ошибку показать, успех подтвердить. */
  const run = (
    call: Promise<{ error?: string; ok?: boolean } | undefined>,
    ok: string,
    then?: () => void,
  ) =>
    startTransition(async () => {
      const result = await call;
      if (result?.error) {
        setError(result.error);
        return;
      }
      setError(null);
      toast.success(ok);
      then?.();
    });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>{t.settings.delivery.telegram.description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {connected
            ? t.settings.delivery.telegram.connected(username)
            : t.settings.delivery.telegram.notConnected}
        </CardContent>
      </Card>

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
              {!connected ? (
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
            <form action={(fd) => run(saveKindleDigest(fd), k.saved)}>
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

                <Field orientation="horizontal">
                  <Switch id="kindle_digest" name="kindle_digest" defaultChecked={kindleDigest} disabled={locked} />
                  <FieldLabel htmlFor="kindle_digest" className="font-normal">
                    {k.sendToKindle}
                    <FieldDescription>{k.sendToKindleHint}</FieldDescription>
                  </FieldLabel>
                </Field>

                <div className="flex flex-wrap items-center gap-4">
                  <Button type="submit" disabled={pending || locked}>{t.settings.common.save}</Button>
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
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
