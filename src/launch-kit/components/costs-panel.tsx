import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@launch-kit/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@launch-kit/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@launch-kit/components/ui/table";
import type { CostReport } from "@launch-kit/lib/costs";

const usd = (value: number | null) => value === null ? "—" : value === 0 ? "$0" : value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
const tokens = (value: number | null) => value === null ? "—" : value >= 1e6 ? `${(value / 1e6).toFixed(1)} M` : value >= 1e3 ? `${Math.round(value / 1e3)} K` : String(value);
const share = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;
const palette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "#9fd3a8", "#e6c36a"];

/**
 * Model spend, from the product's own cost ledger. Unpriced calls are counted
 * and labelled as unpriced: a zero there would read as "free".
 */
export function CostsPanel({ report, days, subjectLabel }: { report: CostReport; days: number; subjectLabel: (id: string) => string }) {
  const money = report.priced;
  const kpis = [
    { label: `За ${days} дн.`, value: money ? usd(report.total.usd) : `${report.total.calls}`, hint: money ? `${report.total.calls} вызовов` : "вызовов · цена не записывается" },
    { label: "Общее на всех", value: money ? usd(report.shared.usd) : `${report.shared.calls}`, hint: "этапы, которые обслуживают всех разом" },
    { label: "По пользователям", value: money ? usd(report.personal.usd) : `${report.personal.calls}`, hint: `${report.subjectsWithSpend} с расходом` },
    { label: "На пользователя в день", value: usd(report.perPayingSubjectDay), hint: money ? "личный расход / пользователи с расходом / дни" : "нужна цена вызова" },
  ];
  const config: ChartConfig = Object.fromEntries(report.stages.map((stage, index) => [stage.key, { label: stage.label, color: palette[index] ?? "#c8c8c8" }]));
  return (
    <div className="space-y-4">
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
              <TableHeader><TableRow><TableHead>Модель</TableHead><TableHead className="text-right">Вызовов</TableHead><TableHead className="text-right">$</TableHead></TableRow></TableHeader>
              <TableBody>{report.models.map((model) => (
                <TableRow key={model.key}>
                  <TableCell className="max-w-64 truncate font-mono text-xs">{model.key}</TableCell>
                  <TableCell className="tabular text-right">{model.calls}</TableCell>
                  <TableCell className="tabular text-right">{usd(model.usd)}</TableCell>
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
