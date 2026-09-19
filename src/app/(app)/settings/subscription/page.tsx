import { currentReader } from "@/lib/session";
import { planOf } from "@/lib/plans";
import { PlanTable } from "@/components/plan-table";
import { SubscriptionForm } from "./form";

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

  return (
    <div className="flex flex-col gap-6">
      <PlanTable current={planOf(reader.plan)} />
      <SubscriptionForm />
    </div>
  );
}
