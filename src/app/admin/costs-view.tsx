import type { Costs } from "@/lib/analytics/costs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@launch-kit/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@launch-kit/components/ui/table";
import { CostsChart } from "./costs-chart";

// Имена этапов — как их знает владелец, а не как они записаны в check.
const STAGES: Record<string, string> = {
  score: "Оценка потока (Jev)",
  dedup: "Дедуп (Jev)",
  digest: "Дайджест",
  summary: "Замер описаний",
  translate: "Перевод",
  "translation-quality": "Качество перевода",
  video: "Конспект ролика",
  voice: "Карточка голоса",
  post: "Посты",
  "post-quality": "Проверка поста",
  interests: "Подбор интересов",
  "spoken-terms": "Произношение терминов",
  "reading-gate": "Привратник разбора",
  "reading-repeat": "Повтор разбора",
};

const usd = (v: number) => (v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
const tokens = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)} M` : v >= 1e3 ? `${Math.round(v / 1e3)} K` : String(v));

export function CostsView({ costs }: { costs: Costs }) {
  const { totals, days } = costs;
  const personal = costs.readers.reduce((sum, r) => sum + r.month, 0);
  const kpis = [
    { label: "Сегодня", value: usd(totals.today), hint: "С полуночи UTC — окно дневного потолка" },
    { label: "7 дней", value: usd(totals.week), hint: `≈ ${usd((totals.week / 7) * 30)} за месяц в этом темпе` },
    { label: `${days} дней`, value: usd(totals.month), hint: `общее ${usd(costs.shared.month)} · по читателям ${usd(personal)}` },
    {
      label: "На читателя в день",
      value: costs.activeReaders ? usd(personal / costs.activeReaders / days) : "—",
      hint: `личный расход / ${costs.activeReaders} с расходом за ${days} дн.`,
    },
    { label: "Всего", value: usd(totals.all), hint: totals.first ? `с ${totals.first.toISOString().slice(0, 10)}` : "вызовов ещё нет" },
  ];

  return (
    <main className="mx-auto min-w-0 max-w-[1160px] space-y-4 px-3 pb-24 pt-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold">Расходы на модель</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Из <code>model_calls</code> — той же таблицы, по которой прогон сверяет дневной потолок. Сутки по UTC.
          {costs.pending.calls > 0 && ` Ещё ${costs.pending.calls} вызовов разбора не закрыты (резерв ${usd(costs.pending.usd)}) и в суммы не входят.`}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {kpis.map((k) => (
          <Card key={k.label} className="soft-card gap-1 py-4">
            <CardContent className="px-4">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="tabular mt-1 text-2xl font-semibold">{k.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="soft-card">
        <CardHeader>
          <CardTitle>По дням и этапам</CardTitle>
          <CardDescription>Последние {days} дней. Пустой день — прогон не дошёл до модели.</CardDescription>
        </CardHeader>
        <CardContent>
          <CostsChart series={costs.series} stages={costs.stages.map((s) => s.stage)} labels={STAGES} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="soft-card min-w-0">
          <CardHeader>
            <CardTitle>Этапы</CardTitle>
            <CardDescription>{days} дней. Jev отвечает за оценку и дедуп — общие на всех читателей.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Этап</TableHead><TableHead className="text-right">Вызовов</TableHead><TableHead className="text-right">Вход / выход</TableHead><TableHead className="text-right">$</TableHead><TableHead className="text-right">Доля</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {costs.stages.map((s) => (
                  <TableRow key={s.stage}>
                    <TableCell>{STAGES[s.stage] ?? s.stage}</TableCell>
                    <TableCell className="tabular text-right">{s.calls}</TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">{tokens(s.tokens_in)} / {tokens(s.tokens_out)}</TableCell>
                    <TableCell className="tabular text-right">{usd(s.usd)}</TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">{totals.month ? `${Math.round((s.usd / totals.month) * 100)}%` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="soft-card min-w-0">
          <CardHeader>
            <CardTitle>Модели</CardTitle>
            <CardDescription>{days} дней</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Модель</TableHead><TableHead className="text-right">Вызовов</TableHead><TableHead className="text-right">$</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {costs.models.map((m) => (
                  <TableRow key={m.model}>
                    <TableCell className="max-w-64 truncate font-mono text-xs">{m.model}</TableCell>
                    <TableCell className="tabular text-right">{m.calls}</TableCell>
                    <TableCell className="tabular text-right">{usd(m.usd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="soft-card">
        <CardHeader>
          <CardTitle>Читатели</CardTitle>
          <CardDescription>
            Личный расход против цены тарифа. Общий этап (сбор, оценка, дедуп) не делится: он стоит одинаково при любом числе читателей.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Читатель</TableHead><TableHead>Тариф</TableHead>
                <TableHead className="text-right">Сегодня / потолок</TableHead><TableHead className="text-right">{days} дней</TableHead>
                <TableHead className="text-right">Тариф в месяц</TableHead><TableHead className="text-right">Всего</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costs.readers.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name}{r.owner && <span className="ml-1 text-xs text-muted-foreground">владелец</span>}</TableCell>
                  <TableCell>{r.plan}</TableCell>
                  <TableCell className={`tabular text-right ${r.today >= r.cap ? "text-destructive" : ""}`}>{usd(r.today)} / {usd(r.cap)}</TableCell>
                  <TableCell className={`tabular text-right ${r.price > 0 && r.month > r.price ? "text-destructive" : ""}`}>{usd(r.month)}</TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">{r.price ? usd(r.price) : "—"}</TableCell>
                  <TableCell className="tabular text-right">{usd(r.all)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="text-muted-foreground">Общее на всех</TableCell>
                <TableCell />
                <TableCell className="tabular text-right">{usd(costs.shared.today)}</TableCell>
                <TableCell className="tabular text-right">{usd(costs.shared.month)}</TableCell>
                <TableCell />
                <TableCell className="tabular text-right">{usd(costs.shared.all)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
