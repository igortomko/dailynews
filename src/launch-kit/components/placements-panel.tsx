import { useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { Button } from "@launch-kit/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@launch-kit/components/ui/card";
import { Input } from "@launch-kit/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@launch-kit/components/ui/table";
import { getJson } from "@launch-kit/lib/config";
import { placementLink, placementStats } from "@launch-kit/lib/placements";
import type { AnalyticsDataset } from "@launch-kit/lib/types";

const CHANNELS = ["telegram", "x", "linkedin", "threads", "youtube", "instagram", "newsletter", "partner", "other"];
const exponent = (currency: string) => currency === "XTR" || currency === "JPY" ? 0 : 2;
const rate = (part: number, whole: number) => whole ? `${Math.round((part / whole) * 100)}%` : "—";

function CopyButton({ href }: { href: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="outline" size="sm" onClick={async () => {
      try { await navigator.clipboard.writeText(href); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }
      catch { /* The link stays visible and can be selected by hand. */ }
    }}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Скопировано" : "Копировать"}
    </Button>
  );
}

/**
 * One link per place it is posted, minted before it goes out. People are joined
 * by the code carried in their first entry; a placement is retired, never deleted,
 * because the people it brought still point at its code.
 */
export function PlacementsPanel({ dataset, mint, csrfToken, onChanged }: {
  dataset: AnalyticsDataset;
  mint: boolean;
  csrfToken: string;
  onChanged: () => Promise<void>;
}) {
  const placements = dataset.placements!;
  const { rows, unattributed } = placementStats(dataset);
  const stats = new Map(rows.map((row) => [row.code, row]));
  const [form, setForm] = useState({ name: "", channel: "telegram", cost: "0" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await getJson(path, { method: "POST", headers: { "X-CSRF-Token": csrfToken }, body: JSON.stringify(body) });
      await onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось");
      return false;
    } finally { setBusy(false); }
  }
  const items = [...placements.items].sort((a, b) => Number(a.retiredAt !== null) - Number(b.retiredAt !== null) || b.createdAt.localeCompare(a.createdAt));
  const costMinor = Math.round(Number(form.cost.replace(",", ".")) * 10 ** exponent(dataset.product.currency));
  return (
    <div className="space-y-4">
      {mint ? (
        <Card className="soft-card">
          <CardHeader>
            <CardTitle>Новая ссылка</CardTitle>
            <CardDescription>Заводи до того, как ссылка ушла наружу: без кода пришедших не отличить от остальных.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-wrap items-end gap-3" onSubmit={async (event) => {
              event.preventDefault();
              if (await send("/api/placements", { name: form.name.trim(), channel: form.channel.trim().toLowerCase(), costMinor })) setForm({ ...form, name: "" });
            }}>
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                Где лежит
                <Input required maxLength={100} value={form.name} placeholder="Пост в @channel, 24 сент." onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Канал
                <Input required maxLength={40} list="placement-channels" className="w-36" value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })} />
                <datalist id="placement-channels">{CHANNELS.map((channel) => <option key={channel} value={channel} />)}</datalist>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Цена, {dataset.product.currency}
                <Input inputMode="decimal" className="w-24" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} />
              </label>
              <Button type="submit" disabled={busy || !form.name.trim() || !Number.isSafeInteger(costMinor) || costMinor < 0}>
                {busy && <Loader2 className="size-4 animate-spin" />}Выдать ссылку
              </Button>
            </form>
            {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">Ссылки выдаёт сам продукт (подпись или реестр живут там); здесь видно, что они привели.</p>
      )}
      <Card className="soft-card">
        <CardHeader>
          <CardTitle>Что привели</CardTitle>
          <CardDescription>Считается по первому входу: вернувшийся по новой ссылке — визит, а не новый человек. Активировались — достигли первой пользы.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Где</TableHead><TableHead>Ссылка</TableHead>
                <TableHead className="text-right">Пришли</TableHead><TableHead className="text-right">Активировались</TableHead>
                <TableHead className="text-right">Вернулись</TableHead><TableHead className="text-right">Цена за активного</TableHead>{mint && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const stat = stats.get(item.code) ?? { entered: 0, activated: 0, returned: 0 };
                const href = placementLink(placements.entry, item);
                const cost = item.costMinor / 10 ** exponent(item.currency);
                return (
                  <TableRow key={item.code} className={item.retiredAt ? "text-muted-foreground" : ""}>
                    <TableCell>
                      <div>{item.name}</div>
                      <div className="text-xs text-muted-foreground">{item.channel} · {item.createdAt.slice(0, 10)}{item.costMinor > 0 && ` · ${cost} ${item.currency}`}{item.retiredAt && " · снята"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="text-xs" title={href ?? undefined}>c_{item.code}</code>
                        {href && !item.retiredAt && <CopyButton href={href} />}
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right">{stat.entered}</TableCell>
                    <TableCell className="tabular text-right">{stat.activated} <span className="text-xs text-muted-foreground">{rate(stat.activated, stat.entered)}</span></TableCell>
                    <TableCell className="tabular text-right">{stat.returned} <span className="text-xs text-muted-foreground">{rate(stat.returned, stat.entered)}</span></TableCell>
                    <TableCell className="tabular text-right">{item.costMinor > 0 && stat.activated ? `${(cost / stat.activated).toFixed(2)} ${item.currency}` : "—"}</TableCell>
                    {mint && (
                      <TableCell className="text-right">
                        {!item.retiredAt && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void send("/api/placements/retire", { code: item.code })}>Снять</Button>}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              <TableRow className="text-muted-foreground">
                <TableCell>Без ссылки<div className="text-xs">пришли без кода или по коду не из реестра</div></TableCell>
                <TableCell />
                <TableCell className="tabular text-right">{unattributed.entered}</TableCell>
                <TableCell className="tabular text-right">{unattributed.activated}</TableCell>
                <TableCell className="tabular text-right">{unattributed.returned}</TableCell>
                <TableCell />{mint && <TableCell />}
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
