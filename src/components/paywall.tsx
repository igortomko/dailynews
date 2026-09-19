"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { CrownIcon } from "lucide-react";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  maxDigestOf, topicsWord, FEATURES, PLAN_IDS, PLANS,
  type FeatureId, type Plan, type PlanId,
} from "@/lib/plans";

/**
 * Корона и окно с предложением.
 *
 * Корона ставится там же, где стоит предел, и по тому же правилу
 * (`FEATURES[id].has`): корона над работающей кнопкой и работающая кнопка
 * без короны одинаково незаметны на глаз и одинаково врут.
 */

/**
 * Ссылки на оплату приходят с сервера: их собирает `checkoutUrl` из
 * переменных окружения, а клиент до них не достаёт. Контекст, а не пропсы:
 * окно открывается из меню, из формы интересов и из доставки — четыре
 * уровня прокидывания ради двух строк.
 */
const CheckoutContext = createContext<Partial<Record<PlanId, string>>>({});

export function PaywallProvider({
  checkout, children,
}: {
  checkout: Partial<Record<PlanId, string>>;
  children: ReactNode;
}) {
  return <CheckoutContext.Provider value={checkout}>{children}</CheckoutContext.Provider>;
}

function Offer({
  plan, feature, href, recommended,
}: {
  plan: Plan;
  feature: FeatureId;
  href?: string;
  recommended: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border p-3",
        recommended ? "border-foreground/30 bg-foreground/[0.03]" : "border-border",
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{plan.label}</span>
        <span className="text-xs text-muted-foreground">
          {plan.maxSources} источников · {plan.maxTopics} {topicsWord(plan.maxTopics)} · до{" "}
          {maxDigestOf(plan)} новостей
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-base font-medium tabular-nums">
          ${plan.price}
          <span className="text-xs font-normal text-muted-foreground">/мес</span>
        </span>
        <Button
          size="sm"
          variant={recommended ? "default" : "outline"}
          // Без настроенной оплаты ведём в «Подписку»: кнопка, ведущая
          // в никуда, обещает больше, чем продукт умеет.
          render={<a href={href ?? "/settings/subscription"} />}
        >
          Выбрать
        </Button>
      </div>
    </div>
  );
}

export function PaywallDialog({
  feature, plan, open, onOpenChange,
}: {
  feature: FeatureId;
  /** Текущий тариф читателя — чтобы не предлагать то, что уже есть. */
  plan: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const checkout = useContext(CheckoutContext);
  const { title, what } = FEATURES[feature];

  // Все тарифы, где возможность есть и которые дороже текущего. Показывать
  // один самый дешёвый значит терять место, где читатель мог выбрать Pro:
  // он пришёл сюда за возможностью, а решает про тариф целиком.
  const offers = PLAN_IDS.map((id) => PLANS[id]).filter(
    (candidate) => FEATURES[feature].has(candidate) && candidate.price > plan.price,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CrownIcon className="size-4 text-amber-500" aria-hidden />
            {title}
          </DialogTitle>
          <DialogDescription>{what}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {offers.map((offer, index) => (
            <Offer
              key={offer.id}
              plan={offer}
              feature={feature}
              href={checkout[offer.id]}
              // Выделен самый дешёвый из подходящих: он и есть ответ
              // на вопрос «сколько это стоит».
              recommended={index === 0}
            />
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Сейчас у тебя «{plan.label}». Полное сравнение — в разделе «Подписка».
        </p>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" size="sm" />}>Не сейчас</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Готовая пара «корона + окно» для случаев, когда закрытое место — это
 * значок рядом с подписью, а не целая кнопка.
 */
export function PaywallCrown({
  feature, plan, className,
}: {
  feature: FeatureId;
  plan: Plan;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={`${FEATURES[feature].title} — на платном тарифе`}
        onClick={(event) => {
          // Корона живёт внутри ссылок и кнопок: без остановки всплытия
          // клик по ней заодно уводит на страницу, которую она закрывает.
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "inline-flex shrink-0 cursor-pointer align-[-1px] text-amber-500/80 transition-colors hover:text-amber-500",
          className,
        )}
      >
        <CrownIcon className="size-3.5" />
      </button>
      <PaywallDialog feature={feature} plan={plan} open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * То же окно, но открывается чем угодно: кнопкой «Добавить» на пределе,
 * пунктом меню, вариантом в списке. Возвращает функцию открытия и само
 * окно — родитель решает, что считать нажатием.
 */
export function usePaywall(feature: FeatureId, plan: Plan) {
  const [open, setOpen] = useState(false);
  return {
    open: () => setOpen(true),
    dialog: <PaywallDialog feature={feature} plan={plan} open={open} onOpenChange={setOpen} />,
  };
}
