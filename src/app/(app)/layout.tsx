import { RebuildOnLeave } from "@/components/rebuild-queue";
import { I18nProvider } from "@/components/i18n-provider";
import { PaywallProvider } from "@/components/paywall";
import { checkoutUrl } from "@/lib/lemon";
import { PLAN_IDS } from "@/lib/plans";
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
  /**
   * Ссылки на оплату собираются сервером и раздаются вниз, окно с
   * предложением живёт в клиентских компонентах.
   *
   * Провайдер стоял в раскладке настроек, а окно открывается ещё из ленты
   * и из мастера первого захода: там контекст был пустым, и «Выбрать»
   * уводило в «Подписку» вместо оплаты — запасной путь, задуманный
   * на ненастроенные ключи, срабатывал при настроенных.
   */
  const checkout = Object.fromEntries(
    PLAN_IDS.map((id) => [id, checkoutUrl(id, reader.id)]).filter(([, url]) => url),
  ) as Record<string, string>;
  return (
    <I18nProvider locale={locale}>
    <PaywallProvider checkout={checkout}>
    <div
      // Язык интерфейса на подписях, кнопках и подсказках. Текст выпуска
      // объявляет свой отдельно: интерфейс может быть английским,
      // а выпуск русским, и одно на оба врало бы половине страницы.
      lang={locale}
      className="min-h-svh"
      data-brand-colors={brandColorsV2Enabled(reader) ? "v2" : "default"}
    >
      {children}
      {/* Пересборка выпуска начинается при выходе из настроек и идёт фоном.
          Сторож стоит здесь, а не в самих настройках: тот компонент к этому
          моменту уже размонтирован — его уход и есть сигнал. */}
      <RebuildOnLeave />
    </div>
    </PaywallProvider>
    </I18nProvider>
  );
}
