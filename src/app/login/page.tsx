import Link from "next/link";
import { I18nProvider } from "@/components/i18n-provider";
import { dictOf } from "@/lib/i18n";
import { loginLocale } from "@/lib/i18n/server";
import { LoginForm } from "./form";
import { googleConfig } from "@/lib/google";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const { expired } = await searchParams;
  // Имя бота читается на сервере и может отсутствовать: выдуманное имя
  // увело бы читателя к чужому боту, и выглядело бы это как обычная кнопка.
  const t = dictOf(loginLocale()).onboarding.login;
  const bot = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || null;
  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 px-4">
      {/* Язык здесь не выбирают, а фиксируют: читателя ещё нет, и спросить
          некого. loginLocale() всегда отдаёт английский. */}
      <I18nProvider locale={loginLocale()}>
        <LoginForm expired={expired === "1"} bot={bot} google={Boolean(googleConfig())} />
      </I18nProvider>
      {/* Цены и документы — с первого экрана: на него попадает всякий,
          кто открыл домен, включая ревьюеров Paddle, а без цен и возврата
          домен для оплаты не одобряют. */}
      <nav className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(["pricing", "terms", "privacy", "refund"] as const).map((page) => (
          <Link key={page} href={`/${page}`} className="hover:text-foreground">
            {t[`${page}Link`]}
          </Link>
        ))}
      </nav>
    </div>
  );
}
