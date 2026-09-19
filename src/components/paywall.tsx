"use client";

import { useState } from "react";
import { CrownIcon } from "lucide-react";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cheapestFor, maxDigestOf, topicsWord, FEATURES, type FeatureId, type Plan } from "@/lib/plans";

/**
 * Корона и окно с предложением.
 *
 * Корона ставится там же, где стоит предел, и по тому же правилу
 * (`FEATURES[id].has`): корона над работающей кнопкой и работающая кнопка
 * без короны одинаково незаметны на глаз и одинаково врут.
 *
 * Окно объясняет, что даёт тариф, и ведёт в «Подписку», где стоит оплата.
 * Закрыть его можно, ничего не выбрав: пейволл, из которого нет выхода
 * кроме покупки, читается как ловушка, а не как предложение.
 */
export function PaywallDialog({
  feature, plan, open, onOpenChange,
}: {
  feature: FeatureId;
  /** Текущий тариф читателя — чтобы показать, с чего он переходит. */
  plan: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const needed = cheapestFor(feature);
  const { title, what } = FEATURES[feature];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CrownIcon className="size-4 text-amber-500" aria-hidden />
            {title}
          </DialogTitle>
          <DialogDescription>{what}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-baseline justify-between gap-3 rounded-lg border p-3">
            <div className="flex flex-col">
              <span className="font-medium">{needed.label}</span>
              <span className="text-xs text-muted-foreground">
                {needed.maxSources} источников · {needed.maxTopics} {topicsWord(needed.maxTopics)} ·
                до {maxDigestOf(needed)} новостей
              </span>
            </div>
            <span className="shrink-0 text-lg font-medium tabular-nums">
              ${needed.price}
              <span className="text-xs font-normal text-muted-foreground">/мес</span>
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Сейчас у тебя «{plan.label}». Полное сравнение тарифов — в разделе «Подписка».
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" size="sm" />}>Не сейчас</DialogClose>
          <Button size="sm" render={<a href="/settings/subscription" />}>
            Перейти на «{needed.label}»
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Готовая пара «корона + окно» для случаев, когда закрытое место — это
 * отдельный значок рядом с названием, а не целая кнопка.
 */
export function PaywallCrown({
  feature, plan, className,
}: {
  feature: FeatureId;
  plan: Plan;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const needed = cheapestFor(feature);

  return (
    <>
      <button
        type="button"
        aria-label={`${FEATURES[feature].title} — на тарифе «${needed.label}»`}
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
