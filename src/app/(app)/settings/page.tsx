import { redirect } from "next/navigation";
import { currentReader } from "@/lib/session";
import { allows } from "@/lib/plans";
import { effectivePlan } from "@/lib/lemon";

export const dynamic = "force-dynamic";

/**
 * Первый экран настроек — открытый раздел, а не заглушка. Прежний безусловный
 * переход на персонализацию встречал бесплатного читателя замком там, где он
 * ожидал настройки: отказ на месте входа читается как «настроек нет».
 */
export default async function SettingsIndex() {
  const plan = effectivePlan(await currentReader());
  redirect(allows(plan, "personalization") ? "/settings/personalization" : "/settings/interests");
}
