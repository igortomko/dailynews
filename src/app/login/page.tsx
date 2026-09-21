import { I18nProvider } from "@/components/i18n-provider";
import { loginLocale } from "@/lib/i18n/server";
import { LoginForm } from "./form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const { next, expired } = await searchParams;
  // Имя бота читается на сервере и может отсутствовать: выдуманное имя
  // увело бы читателя к чужому боту, и выглядело бы это как обычная кнопка.
  const bot = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || null;
  // next читается на сервере: useSearchParams в клиенте потребовал бы
  // Suspense и всё равно не пережил бы пререндер.
  return (
    <div className="mx-auto flex min-h-svh max-w-sm items-center px-4">
      {/* Язык здесь не выбирают, а фиксируют: читателя ещё нет, и спросить
          некого. loginLocale() всегда отдаёт английский. */}
      <I18nProvider locale={loginLocale()}>
        <LoginForm next={next ?? "/"} expired={expired === "1"} bot={bot} />
      </I18nProvider>
    </div>
  );
}
