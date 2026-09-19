import Link from "next/link";
import { SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Шапка почти пуста: в ленте важна лента. Шестерёнка приглушена в покое
 * и проявляется по наведению — она нужна раз в неделю, а место занимает
 * в каждом просмотре.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="group mx-auto flex max-w-3xl items-center justify-end px-4 pt-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Настройки"
          className="text-muted-foreground/40 transition-colors hover:text-foreground focus-visible:text-foreground [@media(hover:none)]:text-muted-foreground"
          render={<Link href="/settings/personalization" />}
        >
          <SettingsIcon />
        </Button>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-10 pt-2">{children}</main>
    </>
  );
}
