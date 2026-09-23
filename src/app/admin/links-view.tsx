import { CHANNELS, listPlacements, placementLink } from "@/lib/analytics/placements";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@launch-kit/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@launch-kit/components/ui/table";
import { addPlacement, retire } from "./actions";
import { CopyLink } from "./copy-link";

const rate = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");
const perReader = (cost: number, n: number) => (cost > 0 && n > 0 ? `$${(cost / n).toFixed(2)}` : "—");

export async function LinksView() {
  const { placements, unattributed } = await listPlacements();
  const botMissing = placementLink("x") === null;
  const field = "h-9 rounded-md border bg-card px-3 text-sm";

  return (
    <main className="mx-auto min-w-0 max-w-[1160px] space-y-4 px-3 pb-24 pt-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold">Ссылки на каналы</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Одна ссылка на одно место, где она лежит: пост, канал, автор, рассылка. Код пишется читателю при первом /start и больше не меняется — видно, кто пришёл, настроился и начал читать.
        </p>
        {botMissing && <p className="mt-2 text-sm text-destructive">Не задан TELEGRAM_BOT_USERNAME — ссылку собрать не из чего.</p>}
      </header>

      <Card className="soft-card">
        <CardHeader>
          <CardTitle>Новая ссылка</CardTitle>
          <CardDescription>Заводи до того, как ссылка ушла наружу: без кода пришедших не отличить от остальных.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={addPlacement} className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Где лежит
              <input name="name" required maxLength={100} placeholder="Пост в @channel, 24 сент." className={field} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Канал
              <input name="channel" required maxLength={40} list="placement-channels" defaultValue="telegram" className={`${field} w-36`} />
              <datalist id="placement-channels">{CHANNELS.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Цена, $
              <input name="cost" inputMode="decimal" defaultValue="0" pattern="[0-9]+([.,][0-9]+)?" className={`${field} w-24`} />
            </label>
            <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground">Выдать ссылку</button>
          </form>
        </CardContent>
      </Card>

      <Card className="soft-card">
        <CardHeader>
          <CardTitle>Что привели</CardTitle>
          <CardDescription>Настроились — прошли онбординг. Читают — раскрыли хотя бы одну карточку.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Где</TableHead><TableHead>Ссылка</TableHead>
                <TableHead className="text-right">Пришли</TableHead><TableHead className="text-right">Настроились</TableHead>
                <TableHead className="text-right">Читают</TableHead><TableHead className="text-right">$ за читающего</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {placements.map((p) => {
                const href = placementLink(p.code);
                return (
                  <TableRow key={p.code} className={p.retired_at ? "text-muted-foreground" : ""}>
                    <TableCell>
                      <div>{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.channel} · {p.created_at.toISOString().slice(0, 10)}{p.cost_usd > 0 && ` · $${p.cost_usd}`}{p.retired_at && " · снята"}</div>
                    </TableCell>
                    <TableCell>
                      {href && <div className="flex items-center gap-2"><code className="text-xs" title={href}>c_{p.code}</code>{!p.retired_at && <CopyLink href={href} />}</div>}
                    </TableCell>
                    <TableCell className="tabular text-right">{p.starts}</TableCell>
                    <TableCell className="tabular text-right">{p.onboarded} <span className="text-xs text-muted-foreground">{rate(p.onboarded, p.starts)}</span></TableCell>
                    <TableCell className="tabular text-right">{p.opened} <span className="text-xs text-muted-foreground">{rate(p.opened, p.starts)}</span></TableCell>
                    <TableCell className="tabular text-right">{perReader(p.cost_usd, p.opened)}</TableCell>
                    <TableCell className="text-right">
                      {!p.retired_at && (
                        <form action={retire}>
                          <input type="hidden" name="code" value={p.code} />
                          <button type="submit" className="text-xs text-muted-foreground hover:text-foreground">Снять</button>
                        </form>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="text-muted-foreground">
                <TableCell>Без ссылки<div className="text-xs">пришли до реестра или по ссылке без кода</div></TableCell>
                <TableCell />
                <TableCell className="tabular text-right">{unattributed.starts}</TableCell>
                <TableCell className="tabular text-right">{unattributed.onboarded}</TableCell>
                <TableCell className="tabular text-right">{unattributed.opened}</TableCell>
                <TableCell /><TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
