import { getCalibration, getSummaryQuality } from "@/lib/queries";
import { currentReader } from "@/lib/session";
import { digestsWord, newsWord } from "@/lib/telegram";
import { axisValue } from "@/lib/axis-labels";
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
  const [{ byScore, byConfidence, byAxis, totals }, quality] = await Promise.all([
    getCalibration(reader.id),
    getSummaryQuality(reader.id),
  ]);

  if (totals.shown === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Пока нечего показать</EmptyTitle>
          <EmptyDescription>Первый выпуск ещё не приходил</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const axes = [...new Set(byAxis.map((row) => row.axis))];

  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <AlertTitle>
          Открыл {totals.opened} из {totals.shown} за {totals.days} {digestsWord(totals.days)}
        </AlertTitle>
        <AlertDescription>
          Важно не само число, а растёт ли оно сверху вниз. Если новости с высокой
          оценкой открываются не чаще прочих — лента пока угадывает.
        </AlertDescription>
      </Alert>

      {totals.shown < MIN_SAMPLE ? (
        <Alert variant="destructive">
          <AlertTitle>Данных пока мало</AlertTitle>
          <AlertDescription>
            Показали {totals.shown} {newsWord(totals.shown)}. Надёжные цифры начинаются
            примерно с {MIN_SAMPLE}.
          </AlertDescription>
        </Alert>
      ) : null}

      {quality.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Качество описаний</CardTitle>
            <CardDescription>
              Лента сама оценивает, что написала. Смотреть надо на ряд по дням,
              а не на одно число.
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
          <CardTitle>Оценка и открытия</CardTitle>
          <CardDescription>Чем выше оценка, тем чаще должны открывать</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {byScore.map((row) => (
            <Row key={row.bucket} label={`оценка ${row.bucket}`} shown={row.shown} opened={row.opened} rate={row.open_rate} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Насколько лента была уверена</CardTitle>
          <CardDescription>
            Если уверенность не совпадает с открытиями — лента смотрит не на то
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {byConfidence.map((row) => (
            <Row key={row.bucket} label={`уверенность ${row.bucket}`} shown={row.shown} opened={row.opened} rate={row.open_rate} />
          ))}
        </CardContent>
      </Card>

      {axes.map((axis) => (
        <Card key={axis}>
          <CardHeader>
            <CardTitle className="capitalize">{axis}</CardTitle>
            <CardDescription>Показываем то, что встретилось хотя бы три раза</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {byAxis
              .filter((row) => row.axis === axis)
              .map((row) => (
                <Row key={`${axis}-${row.value}`} label={axisValue(row.value)} shown={row.shown} opened={row.opened} rate={row.open_rate} />
              ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
