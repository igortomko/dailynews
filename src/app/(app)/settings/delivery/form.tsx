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
import { PaywallCrown, usePaywall } from "@/components/paywall";
import { FEATURES, type Plan } from "@/lib/plans";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { kindleSetupStep, type KindleStep } from "@/lib/kindle-setup";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
function CopyAddress({ value }: { value: string }) {
  if (!value) return <code className="font-mono">—</code>;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast.success("Адрес скопирован");
        } catch {
          // Буфер закрыт настройками браузера или небезопасным соединением.
          // Молчать нельзя: читатель уверен, что скопировал.
          toast.error("Браузер не дал скопировать — выдели адрес вручную");
        }
      }}
      title="Скопировать"
      className="cursor-pointer font-mono underline decoration-dotted underline-offset-4 hover:text-foreground"
    >
      {value}
    </button>
  );
}

/** Номер шага словами: «1 из 2» отвечает на вопрос «сколько ещё осталось». */
function StepMark({ now, of, title }: { now: number; of: number; title: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        Шаг {now} из {of}
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
  const [pending, startTransition] = useTransition();
  // Раздел показывается целиком и на закрытом тарифе: погашенные поля
  // объясняют, что именно даёт переход, — заглушка вместо экрана не
  // объясняет ничего. Нажатие на любое из них открывает окно.
  const locked = !FEATURES.delivery.has(plan);
  const kindlePaywall = usePaywall("delivery", plan);
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
          <CardDescription>
            Каждое утро в твой Telegram приходит ссылка на свежий выпуск твоих
            персональных новостей.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {connected
            ? `Подключён${username ? ` как @${username}` : ""}.`
            : "Не подключён — напиши боту /start, и он свяжет этот аккаунт."}
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
            {step === "done"
              ? "Выпуск уходит книгой на читалку."
              : "Ты можешь автоматически получать выпуск на свой Kindle. Это два шага."}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {/* Шаг 1: куда слать. Адрес читалки знает только Amazon, поэтому
              сначала ссылка туда, а уже потом поле. */}
          {step === "address" ? (
            <form action={(fd) => run(saveKindleAddress(fd), "Адрес сохранён", () => setStep("sender"))}>
              <FieldGroup>
                <StepMark now={1} of={2} title="Возьми адрес читалки в Amazon" />
                <p className="text-sm text-muted-foreground">
                  Открой{" "}
                  <a href={AMAZON_SETTINGS} target="_blank" rel="noreferrer"
                     className="underline underline-offset-4">
                    «Manage Your Content and Devices»
                  </a>{" "}
                  → Preferences → Personal Document Settings. Там лежит адрес
                  вида имя@kindle.com — вставь его сюда.
                </p>
                <Field data-invalid={error ? true : undefined}>
                  <FieldLabel htmlFor="kindle_address">Адрес читалки</FieldLabel>
                  <Input
                    id="kindle_address"
                    name="kindle_address"
                    defaultValue={kindleAddress}
                    placeholder="имя@kindle.com"
                    aria-invalid={error ? true : undefined}
                  />
                  <FieldDescription>{error ?? "Заканчивается на @kindle.com."}</FieldDescription>
                </Field>
                <Button type="submit" disabled={pending || locked} className="self-start">
                  Дальше
                </Button>
              </FieldGroup>
            </form>
          ) : null}

          {/* Шаг 2: Amazon примет письмо только от адреса, который читатель
              внёс в одобренные. Проверить это снаружи нечем — подтверждает он. */}
          {step === "sender" ? (
            <FieldGroup>
              <StepMark now={2} of={2} title="Разреши наш адрес отправителя" />
              <p className="text-sm text-muted-foreground">
                В том же разделе Amazon есть «Approved Personal Document E-mail
                List». Добавь туда{" "}
                <CopyAddress value={sender ? `${sender}@${DOMAIN}` : ""} />{" "}
                — без этого письмо отбрасывается молча, без единой ошибки.
              </p>
              {!connected ? (
                <Alert>
                  <AlertTitle>Сначала привяжи Telegram</AlertTitle>
                  <AlertDescription>
                    Пока Telegram не привязан, отправитель собран из номера
                    читателя. Напиши боту <code className="font-mono">/start</code> —
                    адрес пересоберётся из твоего username, и в Amazon его будет
                    видно глазами. После подтверждения он замораживается: менять
                    его потом значит потерять доставку молча.
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={pending || locked}
                  onClick={() => run(approveKindleSender(), "Настроено", () => setStep("done"))}
                >
                  Добавил, готово
                </Button>
                <Button type="button" variant="ghost" disabled={pending || locked}
                        onClick={() => setStep("address")}>
                  Назад
                </Button>
              </div>
            </FieldGroup>
          ) : null}

          {/* Настроено: обычные настройки. */}
          {step === "done" ? (
            <form action={(fd) => run(saveKindleDigest(fd), "Сохранено")}>
              <FieldGroup>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Адрес читалки</span>
                  <span className="text-sm text-muted-foreground">
                    {kindleAddress || "не задан"}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Отправитель</span>
                  <span className="text-sm text-muted-foreground">
                    <CopyAddress value={`${sender}@${DOMAIN}`} /> разрешён в Amazon.
                  </span>
                </div>

                <Field orientation="horizontal">
                  <Switch id="kindle_digest" name="kindle_digest" defaultChecked={kindleDigest} disabled={locked} />
                  <FieldLabel htmlFor="kindle_digest" className="font-normal">
                    Присылать выпуск на читалку
                    <FieldDescription>
                      Выключено — адрес остаётся для отправки отдельных статей.
                    </FieldDescription>
                  </FieldLabel>
                </Field>

                <div className="flex flex-wrap items-center gap-4">
                  <Button type="submit" disabled={pending || locked}>Сохранить</Button>
                  <button
                    type="button"
                    disabled={pending || locked}
                    onClick={() => run(resetKindleSetup(), "Настройка сброшена", () => setStep("address"))}
                    className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
                  >
                    Настроить заново
                  </button>
                </div>
              </FieldGroup>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
