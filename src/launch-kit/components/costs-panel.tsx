import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@launch-kit/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@launch-kit/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@launch-kit/components/ui/table";
import { useState } from "react";
import { Button } from "@launch-kit/components/ui/button";
import { Input } from "@launch-kit/components/ui/input";
import type { CostReport } from "@launch-kit/lib/costs";
import type { ModelPrice } from "@launch-kit/lib/types";

const usd = (value: number | null) => value === null ? "—" : value === 0 ? "$0" : value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
const tokens = (value: number | null) => value === null ? "—" : value >= 1e6 ? `${(value / 1e6).toFixed(1)} M` : value >= 1e3 ? `${Math.round(value / 1e3)} K` : String(value);
const share = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;
const palette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "#9fd3a8", "#e6c36a"];

/**
 * Model spend, from the product's own cost ledger. Unpriced calls are counted
 * and labelled as unpriced: a zero there would read as "free".
 */
function priceText(price: ModelPrice | null): string {
  if (!price) return "не задана";
  const parts = [];
  if (price.perCall !== null) parts.push(`${usd(price.perCall)} / вызов`);
  if (price.inputPerMillion !== null && price.outputPerMillion !== null) parts.push(`$${price.inputPerMillion} / $${price.outputPerMillion} за 1M`);
  return parts.join(" · ");
}

/** A model's price in three fields. Empty fields mean "not known", never zero. */
function PriceEditor({ model, price, own, onSave, onClose }: { model: string; price: ModelPrice | null; own: boolean; onSave: (model: string, price: ModelPrice | null) => Promise<void>; onClose: () => void }) {
  const field = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));
  const [form, setForm] = useState({ perCall: field(price?.perCall), input: field(price?.inputPerMillion), output: field(price?.outputPerMillion), source: own ? price?.source ?? "" : "" });
  const [error, setError] = useState("");
  const parse = (value: string) => (value.trim() === "" ? null : Number(value.replace(",", ".")));
  async function save(clear = false) {
    setError("");
    try {
      if (clear) return await onSave(model, null).then(onClose);
      const next = { perCall: parse(form.perCall), inputPerMillion: parse(form.input), outputPerMillion: parse(form.output), source: form.source.trim() || "введено вручную" };
      if ([next.perCall, next.inputPerMillion, next.outputPerMillion].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) throw new Error("Цена — неотрицательное число");
      if (next.perCall === null && (next.inputPerMillion === null || next.outputPerMillion === null)) throw new Error("Нужна цена за вызов или обе цены за токены");
      await onSave(model, next);
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "Не сохранилось"); }
  }
  return (
    <div className="space-y-2 rounded-lg border bg-white p-3">
      <div className="flex flex-wrap items-end gap-2 text-xs text-muted-foreground">
        <label className="flex flex-col gap-1">$ за вызов<Input className="h-8 w-24" inputMode="decimal" value={form.perCall} onChange={(e) => setForm({ ...form, perCall: e.target.value })} /></label>
        <label className="flex flex-col gap-1">$ за 1M входа<Input className="h-8 w-24" inputMode="decimal" value={form.input} onChange={(e) => setForm({ ...form, input: e.target.value })} /></label>
        <label className="flex flex-col gap-1">$ за 1M выхода<Input className="h-8 w-24" inputMode="decimal" value={form.output} onChange={(e) => setForm({ ...form, output: e.target.value })} /></label>
        <label className="flex min-w-40 flex-1 flex-col gap-1">Откуда цена<Input className="h-8" maxLength={160} placeholder="прайс провайдера, 23 сент." value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></label>
      </div>
      <p className="text-xs text-muted-foreground">Токены считаются, когда продукт их записал; иначе — вызовы × цена за вызов.</p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()}>Сохранить</Button>
        {own && <Button size="sm" variant="ghost" onClick={() => void save(true)}>Убрать свою цену</Button>}
        <Button size="sm" variant="ghost" onClick={onClose}>Отмена</Button>
      </div>
    </div>
  );
}

export function CostsPanel({ report, days, subjectLabel, editable = false, onSavePrice }: {
  report: CostReport;
  days: number;
  subjectLabel: (id: string) => string;
  editable?: boolean;
  onSavePrice?: (model: string, price: ModelPrice | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const money = report.priced;
  // "≈" wherever a price, not the product's ledger, produced part of the amount.
  const approx = (value: string) => (report.estimated && value !== "—" ? `≈ ${value}` : value);
  const kpis = [
    { label: `За ${days} дн.`, value: money ? approx(usd(report.total.usd)) : `${report.total.calls}`, hint: money ? `${report.total.calls} вызовов${report.unpricedCalls ? ` · ${report.unpricedCalls} без цены не учтены` : ""}` : "вызовов · цена не записывается — задай её в таблице моделей" },
    { label: "Общее на всех", value: money ? approx(usd(report.shared.usd)) : `${report.shared.calls}`, hint: "этапы, которые обслуживают всех разом" },
    { label: "По пользователям", value: money ? approx(usd(report.personal.usd)) : `${report.personal.calls}`, hint: `${report.subjectsWithSpend} с расходом` },
    { label: "На пользователя в день", value: approx(usd(report.perPayingSubjectDay)), hint: money ? "личный расход / пользователи с расходом / дни" : "нужна цена вызова" },
  ];
  const config: ChartConfig = Object.fromEntries(report.stages.map((stage, index) => [stage.key, { label: stage.label, color: palette[index] ?? "#c8c8c8" }]));
  return (
    <div className="space-y-4">
      {report.estimated && <p className="text-sm text-muted-foreground">≈ — часть сумм посчитана по цене модели, а не записана продуктом. Цена и её источник — в таблице моделей.</p>}
      {report.pendingUsd ? <p className="text-sm text-muted-foreground">Ещё {usd(report.pendingUsd)} зарезервировано незакрытыми вызовами и в суммы не входит.</p> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="soft-card gap-1 py-4">
            <CardContent className="px-4">
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <p className="tabular mt-1 text-2xl font-semibold">{kpi.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{kpi.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="soft-card">
        <CardHeader>
          <CardTitle>{money ? "Расход по этапам" : "Вызовы по этапам"}</CardTitle>
          <CardDescription>{report.granularity === "day" ? "По дням, UTC. Пустой день — продукт не дошёл до модели." : "По месяцам: продукт хранит расход помесячно."}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="h-64 w-full">
            <BarChart data={report.series} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={(value: string) => report.granularity === "day" ? value.slice(5) : value.slice(0, 7)} minTickGap={16} />
              <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(value: number) => money ? `$${value.toFixed(2)}` : String(value)} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
              {report.stages.map((stage) => <Bar key={stage.key} dataKey={stage.key} stackId="spend" fill={`var(--color-${stage.key})`} />)}
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="soft-card min-w-0">
          <CardHeader><CardTitle>Этапы</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Этап</TableHead><TableHead className="text-right">Вызовов</TableHead><TableHead className="text-right">Вход / выход</TableHead><TableHead className="text-right">$</TableHead><TableHead className="text-right">Доля</TableHead></TableRow></TableHeader>
              <TableBody>{report.stages.map((stage) => (
                <TableRow key={stage.key}>
                  <TableCell>{stage.label}</TableCell>
                  <TableCell className="tabular text-right">{stage.calls}</TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">{tokens(stage.tokensIn)} / {tokens(stage.tokensOut)}</TableCell>
                  <TableCell className="tabular text-right">{usd(stage.usd)}</TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">{share(stage.share)}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="soft-card min-w-0">
          <CardHeader><CardTitle>Модели</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Модель</TableHead><TableHead className="text-right">Вызовов</TableHead><TableHead>Цена</TableHead><TableHead className="text-right">$</TableHead></TableRow></TableHeader>
              <TableBody>{report.models.map((model) => (
                <TableRow key={model.key}>
                  <TableCell className="max-w-56 truncate font-mono text-xs" title={model.key}>{model.key}</TableCell>
                  <TableCell className="tabular text-right">{model.calls}</TableCell>
                  <TableCell className="text-xs">
                    {editing === model.key && onSavePrice ? (
                      <PriceEditor model={model.key} price={model.price} own={model.priceOrigin === "owner"} onSave={onSavePrice} onClose={() => setEditing(null)} />
                    ) : (
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span>{model.estimated || model.unpricedCalls || model.price ? priceText(model.price) : "записана продуктом"}</span>
                        {model.price && <span className="text-muted-foreground">· {model.priceOrigin === "owner" ? "своя" : model.price.source}</span>}
                        {/* A recorded amount is never replaced, so a price only matters where calls lack one. */}
                        {editable && onSavePrice && (model.estimated || model.unpricedCalls > 0) && <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setEditing(model.key)}>{model.price ? "Изменить" : "Задать"}</Button>}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">{model.estimated && model.usd !== null ? `≈ ${usd(model.usd)}` : usd(model.usd)}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <Card className="soft-card">
        <CardHeader>
          <CardTitle>Пользователи</CardTitle>
          <CardDescription>Личный расход. Общие этапы не делятся на людей: они стоят столько же при любом их числе.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Пользователь</TableHead><TableHead className="text-right">Вызовов</TableHead><TableHead className="text-right">$</TableHead></TableRow></TableHeader>
            <TableBody>{report.subjects.slice(0, 50).map((subject) => (
              <TableRow key={subject.key}>
                <TableCell>{subjectLabel(subject.key)}</TableCell>
                <TableCell className="tabular text-right">{subject.calls}</TableCell>
                <TableCell className="tabular text-right">{usd(subject.usd)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
