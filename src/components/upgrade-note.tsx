"use client";

import { ArrowRightIcon } from "lucide-react";
import { featureOf, type UpgradeNote } from "@/lib/upgrade";
import { PLANS, type Plan } from "@/lib/plans";
import { usePaywall } from "@/components/paywall";
import { useT } from "@/components/i18n-provider";

/**
 * Строка под выпуском: в какой предел ты упёрся сегодня.
 *
 * Стоит здесь, а не в «О проекте», где живёт та же арифметика: туда заходят
 * один раз и по своей воле, а предел человек встречает в момент чтения —
 * когда выпуск кончился раньше, чем он ожидал, или когда сегодня его нет
 * вовсе. Числа те же самые, момент другой.
 *
 * Говорит о том, что произошло, а не о том, что купить: «за сутки у твоих
 * источников вышло 106, в выпуск поместилось 8» — проверяемое утверждение
 * про его же ленту. Название тарифа идёт следом и мелким, как ответ
 * на вопрос, а не как заголовок.
 *
 * Открывает окно, а не уводит в «Подписку»: читатель пришёл читать выпуск,
 * и увести его со страницы за ценой значит закончить чтение вместо того,
 * чтобы дать вернуться к нему после.
 */
export function UpgradeLine({ note, plan }: { note: UpgradeNote; plan: Plan }) {
  const t = useT();
  const paywall = usePaywall(featureOf(note.reason), plan);
  const words = t.feed.upgrade;
  const to = t.plans.label[note.plan];

  const text = note.reason === "cadence" ? words.cadence(to)
    : note.reason === "sources" ? words.sources(note.from, t.plans.label[plan.id], note.to, to)
    : note.reason === "topics" ? words.topics(note.from, t.plans.label[plan.id], note.to, to)
    : words.minutes(note.collected, note.kept, note.from, note.to, to);

  return (
    <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span>{text}</span>
      {/* Кнопка-ссылка, а не Button: строка идёт прозой, и кнопка в её
          середине читалась бы как отдельное действие, которого тут два —
          дочитать выпуск и посмотреть цену. */}
      <button
        type="button"
        onClick={paywall.open}
        className="inline-flex cursor-pointer items-center gap-1 text-foreground underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:decoration-foreground"
      >
        {words.see(to, PLANS[note.plan].price)}
        <ArrowRightIcon className="size-3.5" />
      </button>
      {paywall.dialog}
    </div>
  );
}
