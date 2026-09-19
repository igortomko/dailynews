import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Первый экран настроек. Персонализация открыта всем, ловить нечего. */
export default function SettingsIndex() {
  redirect("/settings/personalization");
}
