import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const FORMAT = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" });

/**
 * Выпуски листаются датами, а не сливаются в одну ленту: вчерашнее,
 * показанное вперемешку с сегодняшним, читается как сегодняшнее.
 * Стрелка в край списка не исчезает, а гаснет — исчезающая управляющая
 * кнопка сдвигает соседнюю под курсор.
 */
export function DateNav({ day, days }: { day: string; days: string[] }) {
  const index = days.indexOf(day);
  const newer = index > 0 ? days[index - 1] : null;
  const older = index >= 0 && index < days.length - 1 ? days[index + 1] : null;

  const arrow = "flex size-7 items-center justify-center rounded-md transition-colors";

  return (
    <div className="flex items-center gap-1 text-sm font-medium">
      {older ? (
        <Link href={`/?day=${older}`} aria-label="Предыдущий выпуск" className={cn(arrow, "hover:bg-muted")}>
          <ChevronLeftIcon className="size-4" />
        </Link>
      ) : (
        <span aria-hidden className={cn(arrow, "text-muted-foreground/30")}>
          <ChevronLeftIcon className="size-4" />
        </span>
      )}

      <span className="tabular-nums">{FORMAT.format(new Date(`${day}T12:00:00`))}</span>

      {newer ? (
        <Link href={`/?day=${newer}`} aria-label="Следующий выпуск" className={cn(arrow, "hover:bg-muted")}>
          <ChevronRightIcon className="size-4" />
        </Link>
      ) : (
        <span aria-hidden className={cn(arrow, "text-muted-foreground/30")}>
          <ChevronRightIcon className="size-4" />
        </span>
      )}
    </div>
  );
}
