import { getCalibration, getSummaryQuality } from "@/lib/queries";
import { currentReader } from "@/lib/session";
import { axisValue } from "@/lib/axis-labels";
import { getDict } from "@/lib/i18n/server";
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
  const t = await getDict();
  const [{ byScore, byConfidence, byAxis, totals }, quality] = await Promise.all([
    getCalibration(reader.id),
    getSummaryQuality(reader.id),
  ]);

  if (totals.shown === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t.plans.calibration.empty}</EmptyTitle>
          <EmptyDescription>{t.plans.calibration.emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const axes = [...new Set(byAxis.map((row) => row.axis))];

  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <AlertTitle>
          {t.plans.calibration.openedOf(totals.opened, totals.shown, totals.days)}
        </AlertTitle>
        <AlertDescription>
          {t.plans.calibration.openedHint}
        </AlertDescription>
      </Alert>

      {totals.shown < MIN_SAMPLE ? (
        <Alert variant="destructive">
          <AlertTitle>{t.plans.calibration.lowData}</AlertTitle>
          <AlertDescription>
            {t.plans.calibration.lowDataDescription(totals.shown, MIN_SAMPLE)}
          </AlertDescription>
        </Alert>
      ) : null}

      {quality.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.plans.calibration.quality.title}</CardTitle>
            <CardDescription>
              {t.plans.calibration.quality.hint}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="w-20 shrink-0">{t.plans.calibration.quality.day}</span>
              <span className="w-12 text-right">{t.plans.calibration.quality.mean}</span>
              <span className="w-24 text-right">{t.plans.calibration.quality.repeats}</span>
              <span className="w-24 text-right">{t.plans.calibration.quality.relevant}</span>
              <span className="w-20 text-right">{t.plans.calibration.quality.scores}</span>
            </div>
            {quality.map((row) => (
              <div key={row.day} className="flex gap-3 tabular-nums">
                <span className="w-20 shrink-0 text-muted-foreground">{row.day.slice(5)}</span>
                <span className="w-12 text-right font-medium">{row.mean}</span>
                <span className="w-24 text-right text-muted-foreground">
                  {t.plans.calibration.outOf(row.repeats, row.items)}
                </span>
                <span className="w-24 text-right text-muted-foreground">
                  {t.plans.calibration.outOf(row.relevant, row.items)}
                </span>
                <span className="w-20 text-right text-muted-foreground">{row.evaluative}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t.plans.calibration.score.title}</CardTitle>
          <CardDescription>{t.plans.calibration.score.hint}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {byScore.map((row) => (
            <Row
              key={row.bucket}
              label={t.plans.calibration.score.bucket(row.bucket)}
              shown={row.shown}
              opened={row.opened}
              rate={row.open_rate}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.plans.calibration.confidence.title}</CardTitle>
          <CardDescription>
            {t.plans.calibration.confidence.hint}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {byConfidence.map((row) => (
            <Row
              key={row.bucket}
              label={t.plans.calibration.confidence.bucket(row.bucket)}
              shown={row.shown}
              opened={row.opened}
              rate={row.open_rate}
            />
          ))}
        </CardContent>
      </Card>

      {axes.map((axis) => (
        <Card key={axis}>
          <CardHeader>
            <CardTitle className="capitalize">{axis}</CardTitle>
            <CardDescription>{t.plans.calibration.axis.hint}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {byAxis
              .filter((row) => row.axis === axis)
              .map((row) => (
                <Row
                  key={`${axis}-${row.value}`}
                  label={axisValue(row.value, t.plans.calibration.axis)}
                  shown={row.shown}
                  opened={row.opened}
                  rate={row.open_rate}
                />
              ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
