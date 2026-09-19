import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/actions";
import { getProfile } from "@/lib/queries";
import { planOf } from "@/lib/plans";
import { SettingsNav } from "./nav";

/**
 * Слева разделы, справа содержимое. Настройки открывают редко и с намерением
 * («поменять источники»), поэтому список разделов должен быть виден целиком,
 * а не прятаться под кнопку, как в ленте.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const plan = planOf((await getProfile()).plan);
  return (
    <>
      <PageHeader
        left={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Назад к ленте"
              className="text-muted-foreground hover:text-foreground"
              render={<Link href="/" />}
            >
              <ArrowLeftIcon />
            </Button>
            <h1 className="text-sm font-medium">Настройки</h1>
          </div>
        }
        // На телефоне колонка разделов идёт лентой поверху, и «Выйти» под ней
        // занимало целую строку ради одной кнопки. В шапке справа место уже
        // есть и пустует. На широком экране выход остаётся внизу колонки.
        right={
          <form action={logout} className="sm:hidden">
            <Button variant="ghost" size="sm" type="submit" className="h-10 px-3">
              Выйти
            </Button>
          </form>
        }
      />

      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6 sm:flex-row sm:gap-10">
      {/* Колонка разделов прибита к экрану: в источниках список на два
          экрана, и «Выйти» с ним уезжало вниз страницы — на месте оставалась
          пустая колонка. Высота считается от окна за вычетом шапки (3rem)
          и полей (по 1.5rem), поэтому «Выйти» стоит внизу экрана, а не внизу
          документа. На узком экране разделы идут лентой поверху, и прибивать
          там нечего. */}
      <aside className="flex shrink-0 flex-col gap-1 sm:sticky sm:top-[4.5rem] sm:h-[calc(100dvh-6rem)] sm:w-44 sm:self-start">
        <SettingsNav open={plan.sections} />
        <form action={logout} className="mt-4 hidden sm:mt-auto sm:block">
          <Button variant="ghost" size="sm" type="submit" className="w-full justify-start px-2">
            Выйти
          </Button>
        </form>
      </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  );
}
