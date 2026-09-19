"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, CheckIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { topicsWord, type Plan } from "@/lib/plans";
import { count } from "@/lib/plural";
import { suggestOrder } from "@/lib/starter-topics";
import type { Suggestion, TopicOption } from "@/lib/onboarding";
import { finishOnboarding, saveOnboardingInterests, saveOnboardingSources } from "@/lib/actions";

/**
 * Три экрана первого захода.
 *
 * Общая рамка у них одна: где ты сейчас, что от тебя нужно, сколько ещё
 * можно взять. Счётчик «2 из 5» — не украшение: предел тарифа, о котором
 * читатель узнаёт от погасшей кнопки, читается как поломка, а тот же предел
 * в счётчике — как правило игры.
 */
const STEPS = ["Интересы", "Источники", "Лента"];

function Shell({
  step,
  title,
  lead,
  children,
  footer,
}: {
  step: number;
  title: string;
  lead: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-svh max-w-xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {STEPS.map((name, index) => (
            <div key={name} className="flex flex-1 flex-col gap-1.5">
              <div
                className={cn(
                  "h-1 rounded-full transition-colors",
                  index <= step ? "bg-foreground/70" : "bg-foreground/10",
                )}
              />
              <span
                className={cn(
                  "text-xs",
                  index === step ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {name}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-medium">{title}</h1>
        <p className="text-sm text-muted-foreground">{lead}</p>
      </div>

      <div className="flex-1">{children}</div>

      {footer ? <div className="sticky bottom-0 bg-background/80 py-3 backdrop-blur">{footer}</div> : null}
    </div>
  );
}

/** Счётчик выбранного. Число предела в нём — то же самое, что в проверке. */
function Counter({ picked, limit }: { picked: number; limit: number }) {
  return (
    <span className="text-sm tabular-nums text-muted-foreground">
      {picked} из {limit}
    </span>
  );
}

function Chip({
  label,
  picked,
  disabled,
  onClick,
}: {
  label: string;
  picked: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={picked}
      // Не disabled: погашенная кнопка ловит нажатие мимо и объяснить,
      // почему она погасла, ей нечем. Предел объясняет счётчик над списком.
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors",
        picked
          ? "border-foreground/30 bg-foreground/[0.06] font-medium"
          : disabled
            ? "border-border text-muted-foreground/50"
            : "border-border hover:bg-muted",
      )}
    >
      {picked ? <CheckIcon className="size-3.5" /> : null}
      {label}
    </button>
  );
}

export function InterestsStep({
  plan,
  options,
  ranked,
}: {
  plan: Plan;
  options: TopicOption[];
  ranked: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<string[]>([]);
  const [mine, setMine] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const bySlug = new Map(options.map((option) => [option.slug, option]));
  const total = picked.length + mine.length;
  const full = total >= plan.maxTopics;
  // Соседи выбранного всплывают наверх: «ИИ» тянет за собой «Разработку»
  // и «Железо», и пять интересов набираются пятью нажатиями, а не пятью
  // попытками вспомнить, что тебе вообще интересно.
  const rest = suggestOrder(picked, ranked);

  const toggle = (slug: string) => {
    setError(null);
    setPicked((now) => {
      if (now.includes(slug)) return now.filter((other) => other !== slug);
      // Набран предел — нажатие не делает ничего, и объясняет это счётчик
      // над кнопкой, а не погасшая кнопка.
      if (full) return now;
      return [...now, slug];
    });
  };

  const addMine = () => {
    const label = draft.trim();
    if (!label || full) return;
    if (mine.some((existing) => existing.toLowerCase() === label.toLowerCase())) return;
    setMine([...mine, label]);
    setDraft("");
  };

  const next = () =>
    start(async () => {
      try {
        const result = await saveOnboardingInterests(picked, mine);
        if (result?.error) setError(result.error);
        else router.refresh();
      } catch {
        // Серверное действие может не вернуть отказ, а броситься: без этой
        // ветки нажатие выглядит съеденным — кнопка отжимается, и ничего
        // не происходит.
        setError("Не получилось сохранить — попробуй ещё раз");
      }
    });

  return (
    <Shell
      step={0}
      title="О чём собирать ленту"
      lead={`Выбери до ${plan.maxTopics} ${topicsWord(plan.maxTopics)} — по ним лента делит выпуск, чтобы одна тема не заняла всё. Поменять можно в любой день.`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Counter picked={total} limit={plan.maxTopics} />
          <Button onClick={next} disabled={total === 0 || pending}>
            {pending ? <Spinner /> : null}
            Дальше
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {total > 0 ? (
          <div className="flex flex-wrap gap-2">
            {picked.map((slug) => (
              <Chip key={slug} label={bySlug.get(slug)?.label ?? slug} picked onClick={() => toggle(slug)} />
            ))}
            {mine.map((label) => (
              <Chip
                key={label}
                label={label}
                picked
                onClick={() => setMine(mine.filter((other) => other !== label))}
              />
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {rest.map((slug) => (
            <Chip
              key={slug}
              label={bySlug.get(slug)?.label ?? slug}
              picked={false}
              disabled={full}
              onClick={() => toggle(slug)}
            />
          ))}
        </div>

        <div className="flex gap-2">
          <Input
            value={draft}
            aria-label="Свой интерес"
            placeholder="Своими словами: например, финтех в Бразилии"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addMine();
            }}
          />
          <Button type="button" variant="outline" onClick={addMine} disabled={full}>
            <PlusIcon data-icon="inline-start" />
            Добавить
          </Button>
        </div>

        {full ? (
          <p className="text-sm text-muted-foreground">
            Это весь набор на тарифе «{plan.label}». Больше интересов — на платном, в «Подписке».
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </Shell>
  );
}

export function SourcesStep({
  plan,
  topics,
  suggestions,
}: {
  plan: Plan;
  topics: string[];
  suggestions: Suggestion[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Экран начинается заполненным, а не пустым: разбирать предложенное легче,
  // чем собирать с нуля, и читатель, который просто нажмёт «Дальше»,
  // получит рабочую ленту, а не пустую.
  const [picked, setPicked] = useState<string[]>(() =>
    suggestions.slice(0, plan.maxSources).map((suggestion) => suggestion.key),
  );
  const [error, setError] = useState<string | null>(null);
  const full = picked.length >= plan.maxSources;

  const toggle = (key: string) => {
    setError(null);
    setPicked((now) => {
      if (now.includes(key)) return now.filter((other) => other !== key);
      if (full) return now;
      return [...now, key];
    });
  };

  const next = () =>
    start(async () => {
      try {
        const result = await saveOnboardingSources(picked);
        if (result?.error) setError(result.error);
        else router.refresh();
      } catch {
        setError("Не получилось сохранить — попробуй ещё раз");
      }
    });

  return (
    <Shell
      step={1}
      title="Откуда читать"
      lead={`Подобрал под ${topics.length > 1 ? "интересы" : "интерес"}: ${topics.join(", ")}. Снимай лишнее; свои ссылки добавишь потом — в настройках или прямо в боте.`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Counter picked={picked.length} limit={plan.maxSources} />
          <Button onClick={next} disabled={picked.length === 0 || pending}>
            {pending ? <Spinner /> : null}
            Дальше
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-1">
        {suggestions.map((suggestion) => {
          const on = picked.includes(suggestion.key);
          return (
            <button
              key={suggestion.key}
              type="button"
              onClick={() => toggle(suggestion.key)}
              aria-pressed={on}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                on ? "border-foreground/30 bg-foreground/[0.04]" : "border-transparent hover:bg-muted",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-md border",
                  on ? "border-foreground/40 bg-foreground/80 text-background" : "border-border",
                )}
              >
                {on ? <CheckIcon className="size-3.5" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{suggestion.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{suggestion.why}</span>
              </span>
            </button>
          );
        })}

        {full ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Тариф «{plan.label}» опрашивает {plan.maxSources} источников. Сними один, чтобы взять другой.
          </p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      </div>
    </Shell>
  );
}

/**
 * Последний шаг делает работу, а не поздравляет.
 *
 * Поток уже собран и оценён — он общий, — поэтому первый выпуск собирается
 * прямо сейчас: отбор весами этого читателя и описания его языком. Минута
 * ожидания здесь честнее, чем «всё готово» и пустая лента до утра.
 */
export function ReadyStep({ plan, topics }: { plan: Plan; topics: number }) {
  const router = useRouter();
  const [state, setState] = useState<"работаю" | "готово" | "пусто">("работаю");
  const [added, setAdded] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    // React в разработке монтирует дважды, а сборка выпуска стоит денег.
    if (once.current) return;
    once.current = true;
    finishOnboarding()
      .then((result) => {
        if (result && "error" in result && result.error) {
          setNote(result.error);
          setState("пусто");
          return;
        }
        const count = (result && "added" in result ? result.added : 0) ?? 0;
        setAdded(count);
        setState(count > 0 ? "готово" : "пусто");
        if (count === 0) setNote("Свежих материалов по твоим темам пока нет — соберу ночью.");
      })
      // Без этой ветки упавший запрос оставляет экран со спиннером навсегда:
      // настройка сохранена, а выглядит как зависшая сборка.
      .catch(() => {
        setNote("Не получилось собрать первый выпуск — соберу ночью.");
        setState("пусто");
      });
  }, []);

  const when = plan.everyDays > 1 ? "через день" : "каждую ночь";

  return (
    <Shell
      step={2}
      title={state === "работаю" ? "Собираю первый выпуск" : "Лента готова"}
      lead={
        state === "работаю"
          ? "Отбираю из того, что уже собрано, и пишу описания. Минута-две."
          : `Дальше выпуск будет приходить ${when}, ссылка — в бота. Спасибо, что читаешь.`
      }
      footer={
        state === "работаю" ? null : (
          <Button
            className="w-full"
            onClick={() => {
              // Выпуск собрался только что и мимо перерисовки: без refresh
              // клиентский роутер показал бы ленту такой, какой она была
              // до сборки, — пустой.
              router.refresh();
              router.push("/");
            }}
          >
            Открыть ленту
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        )
      }
    >
      {state === "работаю" ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Spinner />
          Не закрывай вкладку.
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          {added > 0 ? (
            <p>
              В первом выпуске {count(added, "материал", "материала", "материалов")} по{" "}
              {topics} {topicsWord(topics)}.
            </p>
          ) : null}
          {note ? <p>{note}</p> : null}
          <p>Что читать и чего не хватает — видно в настройках: интересы, источники, подача.</p>
        </div>
      )}
    </Shell>
  );
}
