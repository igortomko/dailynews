import { getCalibration } from "@/lib/queries";
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
  const { byScore, byConfidence, byAxis, totals } = await getCalibration();

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
