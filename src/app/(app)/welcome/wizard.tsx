"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, CheckIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { type Plan } from "@/lib/plans";
import { useT } from "@/components/i18n-provider";
import { suggestOrder, TOPIC_LIMITS } from "@/lib/starter-topics";
import type { Suggestion, TopicOption } from "@/lib/onboarding";
import {
  addOnboardingSource, finishOnboarding, saveOnboardingInterests, saveOnboardingSources,
} from "@/lib/actions";
import { NameRules } from "@/components/name-rules";
import { BrandIllustration } from "@/components/brand-illustration";
import type { Names } from "@/lib/rules";

/**
 * Три экрана первого захода.
 *
 * Общая рамка у них одна: где ты сейчас, что от тебя нужно, сколько ещё
 * можно взять. Счётчик «2 из 5» — не украшение: предел тарифа, о котором
 * читатель узнаёт от погасшей кнопки, читается как поломка, а тот же предел
 * в счётчике — как правило игры.
 */
/**
 * Сколько интересов показать до «ещё». Двенадцать — это примерно экран
 * телефона: дальше начинается прокрутка, за которой прячется поле
 * «своими словами», и его перестают находить.
 */
const FIRST_SHOWN = 12;

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
  const t = useT();
  return (
    <div className="mx-auto flex min-h-svh max-w-xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {t.onboarding.wizard.steps.map((name, index) => (
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
  const t = useT();
  return (
    <span className="text-sm tabular-nums text-muted-foreground">
      {t.onboarding.wizard.counter(picked, limit)}
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
  const t = useT();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<string[]>([]);
  const [mine, setMine] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  // Необязательное уточнение под темами. Сохраняется вместе с ними, до
  // сборки первого выпуска: он собирается на последнем шаге и обязан
  // это учесть.
  const [follow, setFollow] = useState<Names[]>([]);
  const [exclude, setExclude] = useState<Names[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Сколько предложений показано. Разворачивается один раз и навсегда. */
  const [shown, setShown] = useState(FIRST_SHOWN);

  // Витрина стартовых интересов переведена в словаре по тому же slug;
  // серверный label остаётся резервом для интереса, которого в витрине нет.
  const bySlug = new Map(
    options.map((option) => [
      option.slug,
      { ...option, label: t.onboarding.starterTopics[option.slug]?.label ?? option.label },
    ]),
  );
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
        const result = await saveOnboardingInterests(picked, mine, follow, exclude);
        if (result?.error) setError(result.error);
        else router.refresh();
      } catch {
        // Серверное действие может не вернуть отказ, а броситься: без этой
        // ветки нажатие выглядит съеденным — кнопка отжимается, и ничего
        // не происходит.
        setError(t.onboarding.wizard.saveError);
      }
    });

  return (
    <Shell
      step={0}
      title={t.onboarding.wizard.interests.title}
      lead={t.onboarding.wizard.interests.lead(plan.maxTopics)}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Counter picked={total} limit={plan.maxTopics} />
          {/* Фокус не забирается: уход из поля списка добавляет чип, контент
              растёт, и липкий футер сдвигается на высоту отступа — клик
              по «Дальше» пропадал. Набранное в поле и так уходит в список
              (см. NameRules). */}
          <Button
            onMouseDown={(event) => event.preventDefault()}
            onClick={next}
            disabled={total === 0 || pending}
          >
            {pending ? <Spinner /> : null}
            {t.onboarding.wizard.next}
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
          {rest.slice(0, shown).map((slug) => (
            <Chip
              key={slug}
              label={bySlug.get(slug)?.label ?? slug}
              picked={false}
              disabled={full}
              onClick={() => toggle(slug)}
            />
          ))}
          {/* Весь набор сразу — это семь экранов прокрутки на телефоне,
              и поле «своими словами» уезжает за край. Верх списка и так
              отранжирован: соседями выбранного и описанием из Telegram,
              поэтому нужное чаще всего уже видно. */}
          {rest.length > shown ? (
            <button
              type="button"
              onClick={() => setShown(rest.length)}
              className="flex h-9 items-center rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              {t.onboarding.wizard.interests.more(rest.length - shown)}
            </button>
          ) : null}
        </div>

        <div className="flex gap-2">
          <Input
            value={draft}
            maxLength={TOPIC_LIMITS.label}
            aria-label={t.onboarding.wizard.interests.customLabel}
            placeholder={t.onboarding.wizard.interests.customPlaceholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addMine();
            }}
          />
          <Button type="button" variant="outline" onClick={addMine} disabled={full}>
            <PlusIcon data-icon="inline-start" />
            {t.onboarding.wizard.interests.add}
          </Button>
        </div>

        {full ? (
          <p className="text-sm text-muted-foreground">{t.onboarding.wizard.interests.full(t.plans.label[plan.id])}</p>
        ) : null}

        {/* Тот же экран, а не четвёртый шаг: пустое здесь ничего не требует,
            а отдельный экран стал бы решением, которое нельзя пропустить. */}
        <div className="mt-2 flex flex-col gap-6 border-t pt-6">
          <NameRules kind="follow" initial={follow} optional onChange={setFollow} />
          <NameRules kind="exclude" initial={exclude} optional onChange={setExclude} />
        </div>
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
  const t = useT();
  const [pending, start] = useTransition();
  // Экран начинается заполненным, а не пустым: разбирать предложенное легче,
  // чем собирать с нуля, и читатель, который просто нажмёт «Дальше»,
  // получит рабочую ленту, а не пустую.
  const [picked, setPicked] = useState<string[]>(() =>
    suggestions.slice(0, plan.maxSources).map((suggestion) => suggestion.key),
  );
  const [error, setError] = useState<string | null>(null);
  // Список живёт в состоянии: вставленная ссылка встаёт первой, а не уезжает
  // под двадцать предложенных, где её ещё надо искать глазами.
  const [list, setList] = useState(suggestions);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [adding, startAdd] = useTransition();
  const full = picked.length >= plan.maxSources;

  /**
   * Своя ссылка. Разбор ходит в сеть и занимает секунды — поэтому кнопка
   * говорит, что она делает, а не молчит со спиннером.
   *
   * Своё всегда отмечается: человек вставил ссылку не для того, чтобы потом
   * её отметить. Если мест больше нет, снимается последнее предложенное,
   * и об этом говорится вслух — молча снятое читалось бы как «моё не взяли».
   */
  const paste = () =>
    startAdd(async () => {
      const link = draft.trim();
      if (!link) return;
      setError(null);
      setNote(null);
      try {
        const result = await addOnboardingSource(link);
        // Сужение по самому значению, а не по наличию ключа: в нормализованном
        // union обе ветки несут оба поля, и `in` перестаёт различать их.
        const added = "suggestion" in result ? result.suggestion : undefined;
        if (!added) {
          setError(("error" in result && result.error) || t.onboarding.wizard.saveError);
          return;
        }
        setDraft("");
        setList((now) => [added, ...now.filter((one) => one.key !== added.key)]);
        setPicked((now) => {
          const mine = [added.key, ...now.filter((key) => key !== added.key)];
          if (mine.length <= plan.maxSources) return mine;
          const dropped = list.find((one) => one.key === mine[mine.length - 1]);
          if (dropped) setNote(t.onboarding.wizard.sources.displaced(dropped.label));
          return mine.slice(0, plan.maxSources);
        });
      } catch {
        setError(t.onboarding.wizard.saveError);
      }
    });

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
        setError(t.onboarding.wizard.saveError);
      }
    });

  return (
    <Shell
      step={1}
      title={t.onboarding.wizard.sources.title}
      lead={t.onboarding.wizard.sources.lead(topics)}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Counter picked={picked.length} limit={plan.maxSources} />
          <Button onClick={next} disabled={picked.length === 0 || pending}>
            {pending ? <Spinner /> : null}
            {t.onboarding.wizard.next}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-1">
        {list.map((suggestion) => {
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

        {/* Поле внизу, под подобранным: сверху то, из чего можно выбрать,
            а не пустая строка. Тот же порядок, что у интересов. */}
        <div className="mt-3 flex gap-2">
          <Input
            value={draft}
            aria-label={t.onboarding.wizard.sources.addPlaceholder}
            placeholder={t.onboarding.wizard.sources.addPlaceholder}
            disabled={adding}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              paste();
            }}
          />
          <Button type="button" variant="outline" onClick={paste} disabled={adding || !draft.trim()}>
            {adding ? <Spinner /> : <PlusIcon data-icon="inline-start" />}
            {adding ? t.onboarding.wizard.sources.checking : t.onboarding.wizard.sources.add}
          </Button>
        </div>

        {note ? <p className="mt-2 text-sm text-muted-foreground">{note}</p> : null}
        {full ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {t.onboarding.wizard.sources.full(t.plans.label[plan.id], plan.maxSources)}
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
  const t = useT();
  const [state, setState] = useState<"работаю" | "готово" | "пусто">("работаю");
  // Безымянное ожидание длиннее названного: сорок секунд под спиннером
  // читаются как «повисло». Секунды настоящие, а не нарисованные.
  const [seconds, setSeconds] = useState(0);
  const [added, setAdded] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (state !== "работаю") return;
    const tick = setInterval(() => setSeconds((was) => was + 1), 1000);
    return () => clearInterval(tick);
  }, [state]);

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
        const added = (result && "added" in result ? result.added : 0) ?? 0;
        setAdded(added);
        setState(added > 0 ? "готово" : "пусто");
        if (added === 0) setNote(t.onboarding.wizard.ready.noFreshItems);
      })
      // Без этой ветки упавший запрос оставляет экран со спиннером навсегда:
      // настройка сохранена, а выглядит как зависшая сборка.
      .catch(() => {
        setNote(t.onboarding.wizard.ready.buildFailed);
        setState("пусто");
      });
  }, [t]);

  return (
    <Shell
      step={2}
      title={state === "работаю" ? t.onboarding.wizard.ready.buildingTitle : t.onboarding.wizard.ready.readyTitle}
      lead={
        state === "работаю"
          ? t.onboarding.wizard.ready.buildingLead
          : t.onboarding.wizard.ready.readyLead(plan.everyDays > 1)
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
            {t.onboarding.wizard.ready.openFeed}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        )
      }
    >
      {/* Картинка говорит то же, что и текст, а не украшает пустоту:
          «observer» — из большого потока остаётся ваше, ровно это и делает
          отбор; «morning» — начать день с ясной картины. Смена картинки
          сама по себе сообщает, что работа кончилась. */}
      <div className="flex flex-col items-center gap-5 py-4 text-center">
        <BrandIllustration
          name={state === "работаю" ? "observer" : "morning"}
          alt=""
          size={200}
        />

        {state === "работаю" ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Spinner />
            {t.onboarding.wizard.ready.dontClose}{" "}
            <span className="tabular-nums">{t.onboarding.wizard.ready.elapsed(seconds)}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            {added > 0 ? <p>{t.onboarding.wizard.ready.digestSummary(added, topics)}</p> : null}
            {note ? <p>{note}</p> : null}
            <p>{t.onboarding.wizard.ready.footerNote}</p>
          </div>
        )}
      </div>
    </Shell>
  );
}
