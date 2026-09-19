import { SubscriptionForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * Раздел не закрыт тарифом. Раньше был: на этой странице жили свой провайдер
 * и свой ключ — признак Pro. Ключи убраны, и осталось предложение подписки,
 * а закрывать его тарифом значит показывать кнопку «подписаться» только тем,
 * кто уже подписан.
 */
export default async function SubscriptionPage() {
  return <SubscriptionForm />;
}
