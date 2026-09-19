import Link from "next/link";
import { MoreHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logout } from "@/lib/actions";

/**
 * Настройками пользуются раз в неделю, лентой — каждый день. Четыре ссылки
 * поперёк экрана отнимали место у первого заголовка, поэтому они убраны
 * под одну кнопку.
 */
const MENU = [
  { href: "/", label: "Лента" },
  { href: "/interests", label: "Интересы" },
  { href: "/sources", label: "Источники" },
  { href: "/calibration", label: "Калибровка" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="mx-auto flex max-w-3xl items-center justify-end px-4 pt-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Меню" />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              {MENU.map((entry) => (
                <DropdownMenuItem key={entry.href} render={<Link href={entry.href} />}>
                  {entry.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                render={<button type="submit" form="logout-form" className="w-full" />}
              >
                Выйти
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <form action={logout} id="logout-form" className="hidden" />
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-10 pt-2">{children}</main>
    </>
  );
}
