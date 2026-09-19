import { redirect } from "next/navigation";
import { getProfile } from "@/lib/queries";
import { allows, planOf } from "@/lib/plans";

export const dynamic = "force-dynamic";

/**
 * Первый экран настроек — открытый раздел, а не заглушка. Прежний безусловный
 * переход на персонализацию встречал бесплатного читателя замком там, где он
 * ожидал настройки: отказ на месте входа читается как «настроек нет».
 */
export default async function SettingsIndex() {
  const plan = planOf((await getProfile()).plan);
  redirect(allows(plan, "personalization") ? "/settings/personalization" : "/settings/interests");
}
