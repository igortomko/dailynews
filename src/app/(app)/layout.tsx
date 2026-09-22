import { RebuildOnLeave } from "@/components/rebuild-queue";
import { I18nProvider } from "@/components/i18n-provider";
import { currentLocale } from "@/lib/i18n/server";
import { currentReader } from "@/lib/session";
import { brandColorsV2Enabled } from "@/lib/flags";

/**
 * Серая страница, белая колонка: белое становится местом для чтения,
 * а не фоном по умолчанию. Шапку рисует каждый раздел — в ленте это дата
 * и шестерёнка, в настройках заголовок и возврат, — потому что одна на оба
 * означала бы шестерёнку внутри настроек, которая никуда не ведёт.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Язык читается здесь один раз и раздаётся вниз: каждый клиентский
  // компонент, спрашивающий его сам, спрашивал бы у сервера, которого
  // в браузере нет.
  const [locale, reader] = await Promise.all([currentLocale(), currentReader()]);
  return (
    <I18nProvider locale={locale}>
    <div
      className="min-h-svh"
      data-brand-colors={brandColorsV2Enabled(reader) ? "v2" : "default"}
    >
      {children}
      {/* Пересборка выпуска начинается при выходе из настроек и идёт фоном.
          Сторож стоит здесь, а не в самих настройках: тот компонент к этому
          моменту уже размонтирован — его уход и есть сигнал. */}
      <RebuildOnLeave />
    </div>
    </I18nProvider>
  );
}
