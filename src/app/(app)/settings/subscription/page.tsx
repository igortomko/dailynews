import { currentReader } from "@/lib/session";
import { effectivePlan } from "@/lib/lemon";
import { PlanTable } from "@/components/plan-table";

export const dynamic = "force-dynamic";

/**
 * Страница открыта на любом тарифе: прайс за замком — это предложение,
 * которого не видит ровно тот, кому оно адресовано.
 *
 * Своего ключа здесь больше нет. Он лежал в базе открытым текстом, и раздел
 * убран вместе с ним: хранить чужой секрет ради настройки, которой никто
 * не пользовался, незачем. Модель дайджеста задаётся окружением.
 */
export default async function SubscriptionPage() {
  const reader = await currentReader();
  // Действующий, а не купленный: отменённая подписка ещё работает,
  // истёкшая — уже нет, и страница обязана показывать то же, что и предел.
  return (
    <div className="flex flex-col gap-6">
      <PlanTable reader={reader} current={effectivePlan(reader)} />
    </div>
  );
}
