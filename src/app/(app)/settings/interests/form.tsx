"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";
import { saveInterests, type ChipInput } from "@/lib/actions";
import { TopicChips } from "@/components/topic-chips";
import type { Plan } from "@/lib/plans";
import { FieldDescription, FieldGroup } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function InterestsForm({
  chips,
  total,
  inToday,
  plan,
}: {
  chips: ChipInput[];
  total: number;
  inToday: number;
  plan: Plan;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const schedule = () => {
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const node = form.current;
      if (!node) return;
      startTransition(async () => {
        const result = await saveInterests(new FormData(node));
        if (result?.error) {
          setError(result.error);
          return;
        }
        setError(null);
        setSaved(true);
      });
    }, 900);
  };

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!saved) return;
    const hide = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(hide);
  }, [saved]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Интересы
          <span
            aria-live="polite"
            className={cn(
              "flex items-center gap-1 text-xs font-normal",
              saved && !pending ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            {pending ? "сохраняю…" : saved ? (<><CheckIcon className="size-3" />сохранено</>) : null}
          </span>
        </CardTitle>
        <CardDescription>Направления, по которым собираются новости.</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={form} onChange={schedule} onSubmit={(event) => event.preventDefault()}>
          <FieldGroup>
            <TopicChips
              initial={chips}
              initialTotal={total}
              inToday={inToday}
              plan={plan}
              onChange={schedule}
            />
            {error ? <FieldDescription className="text-destructive">{error}</FieldDescription> : null}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
