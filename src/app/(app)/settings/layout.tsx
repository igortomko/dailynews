import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/actions";
import { SettingsNav } from "./nav";

/**
 * Слева разделы, справа содержимое. Настройки открывают редко и с намерением
 * («поменять источники»), поэтому список разделов должен быть виден целиком,
 * а не прятаться под кнопку, как в ленте.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="mb-6 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Назад к ленте"
          className="text-muted-foreground hover:text-foreground"
          render={<Link href="/" />}
        >
          <ArrowLeftIcon />
        </Button>
        <h1 className="text-lg font-medium">Настройки</h1>
      </header>

      <div className="flex flex-col gap-8 sm:flex-row sm:gap-10">
      <aside className="flex shrink-0 flex-col gap-1 sm:w-44">
        <SettingsNav />
        <form action={logout} className="mt-4 sm:mt-auto">
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
