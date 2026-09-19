import { getCalibration, getSummaryQuality } from "@/lib/queries";
import { currentReader } from "@/lib/session";
import { allows } from "@/lib/plans";
import { effectivePlan } from "@/lib/lemon";
import { PlanGate } from "@/components/plan-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

/** Ниже этого числа показов любые проценты — совпадение, а не сигнал. */
const MIN_SAMPLE = 30;

function Row({ label, shown, opened, rate }: { label: string; shown: number; opened: number; rate: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-32 shrink-0 truncate text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(rate * 100)}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right tabular-nums">
        {Math.round(rate * 100)}%
        <span className="ml-1 text-xs text-muted-foreground">{opened}/{shown}</span>
      </span>
    </div>
  );
}

export default async function CalibrationPage() {
  const reader = await currentReader();
  const plan = effectivePlan(reader);
  // Тяжёлые запросы статистики не должны выполняться ради страницы,
  // которую тариф всё равно не покажет.
  if (!allows(plan, "calibration")) {
    return (
      <PlanGate
        section="calibration"
        plan={plan}
        title="Калибровка"
        what="Растёт ли доля прочитанного с ростом скора и как меняется качество описаний по дням."
      />
    );
  }

  const [{ byScore, byConfidence, byAxis, totals }, quality] = await Promise.all([
    getCalibration(reader.id),
    getSummaryQuality(reader.id),
  ]);

  if (totals.shown === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Нечего калибровать</EmptyTitle>
          <EmptyDescription>Ни одного дайджеста ещё не было.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const axes = [...new Set(byAxis.map((row) => row.axis))];

  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <AlertTitle>
          {totals.opened} из {totals.shown} открыто за {totals.days} дайджестов
        </AlertTitle>
        <AlertDescription>
          Смысл не в проценте, а в наклоне. Если верхние корзины скора открываются не чаще
          нижних — отбор угадывает. Если высокая уверенность не совпадает с открытиями,
          неверно подобраны сами оси, а не их веса.
        </AlertDescription>
      </Alert>

      {totals.shown < MIN_SAMPLE ? (
        <Alert variant="destructive">
          <AlertTitle>Данных мало</AlertTitle>
          <AlertDescription>
            {totals.shown} показов. До {MIN_SAMPLE} любые проценты ниже — это шум,
            менять по ним веса не стоит.
          </AlertDescription>
        </Alert>
      ) : null}

      {quality.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Качество описаний</CardTitle>
            <CardDescription>
              Те же вопросы, но о собственном выходе. Смысл не в отдельном числе,
              а в ряду: правка формулировок либо двигает его, либо нет.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="w-20 shrink-0">день</span>
              <span className="w-12 text-right">среднее</span>
              <span className="w-24 text-right">пересказ</span>
              <span className="w-24 text-right">связь с тобой</span>
              <span className="w-20 text-right">оценки</span>
            </div>
            {quality.map((row) => (
              <div key={row.day} className="flex gap-3 tabular-nums">
                <span className="w-20 shrink-0 text-muted-foreground">{row.day.slice(5)}</span>
                <span className="w-12 text-right font-medium">{row.mean}</span>
                <span className="w-24 text-right text-muted-foreground">{row.repeats} из {row.items}</span>
                <span className="w-24 text-right text-muted-foreground">{row.relevant} из {row.items}</span>
                <span className="w-20 text-right text-muted-foreground">{row.evaluative}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Скор против открытий</CardTitle>
          <CardDescription>Корзины от нижней к верхней. Ожидается рост слева направо.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {byScore.map((row) => (
            <Row key={row.bucket} label={`корзина ${row.bucket}`} shown={row.shown} opened={row.opened} rate={row.open_rate} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Уверенность против открытий</CardTitle>
          <CardDescription>
            Уверенность без корреляции с чтением означает, что оси описывают не то различение.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {byConfidence.map((row) => (
            <Row key={row.bucket} label={`корзина ${row.bucket}`} shown={row.shown} opened={row.opened} rate={row.open_rate} />
          ))}
        </CardContent>
      </Card>

      {axes.map((axis) => (
        <Card key={axis}>
          <CardHeader>
            <CardTitle className="capitalize">{axis}</CardTitle>
            <CardDescription>Только значения, встретившиеся минимум трижды.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {byAxis
              .filter((row) => row.axis === axis)
              .map((row) => (
                <Row key={`${axis}-${row.value}`} label={row.value} shown={row.shown} opened={row.opened} rate={row.open_rate} />
              ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
