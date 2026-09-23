"use client";

import { useState } from "react";
import { CheckIcon, MinusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Cycle } from "@/lib/billing";

/**
 * Карточки тарифов с переключателем периода.
 *
 * Всё посчитано на сервере и приходит данными: строки из `planRows`,
 * описания из `featureWhat`, ссылки из `checkoutUrl`. Здесь только выбор
 * периода — единственное, что меняется без запроса.
 */
export type PricingCard = {
  id: string;
  label: string;
  tagline: string;
  price: number;
  yearPrice: number;
  trialDays: number;
  href: Record<Cycle, string>;
  rows: { feature: string; title: string; what: string; value: string | boolean }[];
};

export type PricingText = {
  monthly: string;
  yearly: string;
  save: string;
  perMonth: string;
  billedYearly: Record<string, string>;
  start: string;
  tryFree: Record<string, string>;
  then: Record<string, Record<Cycle, string>>;
  move: Record<string, string>;
  yes: string;
  no: string;
};

export function PricingCards({
  cards, text, yearly,
}: {
  cards: PricingCard[];
  text: PricingText;
  /** Годовые цены заведены в Paddle. Нет — переключателя нет: нечего предлагать. */
  yearly: boolean;
}) {
  const [cycle, setCycle] = useState<Cycle>("month");
  return (
    <div className="flex flex-col gap-4">
      {yearly ? (
        <div role="radiogroup" className="flex w-fit gap-1 self-center rounded-lg border bg-muted p-1 sm:self-start">
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={cycle === value}
              onClick={() => setCycle(value)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors",
                cycle === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "month" ? text.monthly : text.yearly}
              {value === "year" ? (
                <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-400/20 dark:text-amber-200">
                  {text.save}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((card) => {
          const free = card.price === 0;
          const year = cycle === "year" && !free;
          return (
            <section key={card.id} className="flex flex-col gap-3 rounded-lg border p-4">
              <h2 className="font-medium">{card.label}</h2>
              <div className="flex flex-col">
                {/* За год крупно стоит цена в месяц, а сумма списания — строкой
                    под ней: сравнивают с помесячной ценой, а платят раз в год,
                    и прятать настоящую сумму значило бы удивить при оплате. */}
                <p className="flex items-baseline gap-1">
                  <span className="text-2xl font-medium tabular-nums">
                    ${year ? (card.yearPrice / 12).toFixed(2) : card.price}
                  </span>
                  <span className="text-xs text-muted-foreground">{text.perMonth}</span>
                </p>
                <span className={cn("text-xs text-muted-foreground", !year && "invisible")} aria-hidden={!year}>
                  {text.billedYearly[card.id] ?? "\u00a0"}
                </span>
              </div>
              <p className="font-medium">{card.tagline}</p>

              <dl className="flex flex-col gap-1.5">
                {card.rows.map((row) => (
                  <div key={row.feature} className="flex items-start justify-between gap-3">
                    <dt className="min-w-0">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              className="cursor-help text-left text-muted-foreground underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 hover:text-foreground"
                            />
                          }
                        >
                          {row.title}
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">{row.what}</TooltipContent>
                      </Tooltip>
                    </dt>
                    <dd className="shrink-0 whitespace-nowrap tabular-nums">
                      {typeof row.value === "string" ? (
                        row.value
                      ) : row.value ? (
                        <CheckIcon className="size-4" aria-label={text.yes} />
                      ) : (
                        <MinusIcon className="size-4 text-muted-foreground/50" aria-label={text.no} />
                      )}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* Триал — на кнопке, цена после него — строкой под ней: на «сколько
                  стоит» первым отвечает «нисколько месяц». Триала не завели —
                  кнопка его не обещает. */}
              <div className="mt-auto flex flex-col gap-1.5 pt-2">
                <Button nativeButton={false} variant={free ? "outline" : "default"} render={<a href={card.href[cycle]} />}>
                  {free ? text.start : card.trialDays > 0 ? text.tryFree[card.id] : text.move[card.id]}
                </Button>
                <span className={cn("text-center text-[11px] leading-tight text-muted-foreground", (free || card.trialDays === 0) && "invisible")}>
                  {text.then[card.id]?.[cycle] ?? " "}
                </span>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
