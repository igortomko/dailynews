"use client";

import { Fragment, useState, useTransition } from "react";
import { toast } from "sonner";
import { XIcon, PlusIcon, MinusIcon, GripVerticalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TopicBudgetBar } from "@/components/topic-budget-bar";
import { Field, FieldDescription, FieldLabel, FieldGroup } from "@/components/ui/field";
import { MIN_PER_TOPIC, colorAt, normalize } from "@/lib/topic-budget";
import { maxDigestOf, topicsWord, PLANS, type Plan } from "@/lib/plans";
import { usePaywall, PaywallCrown } from "@/components/paywall";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { topUpDigest, type ChipInput } from "@/lib/actions";

export function TopicChips({
  initial,
  initialTotal,
  inToday,
  onChange,
  plan,
}: {
  initial: ChipInput[];
  initialTotal: number;
  /** Тариф: он задаёт и потолок числа интересов, и доступные размеры выпуска. */
  plan: Plan;
  /** Сколько материалов в последнем выпуске: с ним сверяется предложение догрузить. */
  inToday: number;
  onChange?: () => void;
}) {
  const [, startTopUp] = useTransition();
  // Цели приводим к сумме сразу: в базе лежат цели от прошлого набора тем,
  // и без приведения полоса показывала бы не тот дайджест, который придёт.
  const [chips, setChipsState] = useState<ChipInput[]>(() =>
    withCounts(initial, normalize(initial.map((chip) => chip.count), initialTotal)),
  );
  const [total, setTotalState] = useState(initialTotal);

  // Скрытые поля меняются без события формы, поэтому о правке сообщаем сами:
  // иначе автосохранение их не заметит.
  const setChips = (next: ChipInput[]) => {
    setChipsState(next);
    onChange?.();
  };

  const setCounts = (counts: number[]) => setChips(withCounts(chips, counts));

  const setTotal = (next: number) => {
    const size = Math.min(maxDigestOf(plan), Math.max(3, Math.round(next) || 3));
    setTotalState(size);
    setChips(withCounts(chips, normalize(chips.map((chip) => chip.count), size)));
    if (size > inToday) offerTopUp(size);
  };

  /**
   * Новый размер сам по себе ничего не меняет до полуночи: сегодняшний выпуск
   * уже отобран. Поэтому спрашиваем прямо здесь, а не оставляем читателя
   * гадать, почему в ленте по-прежнему двадцать материалов.
   */
  const offerTopUp = (size: number) =>
    toast(`Сейчас в выпуске ${inToday}. Добавить ещё ${size - inToday}?`, {
      description: "Займёт пару минут",
      action: {
        label: "Добавить",
        onClick: () =>
          startTopUp(async () => {
            const running = toast.loading("Добавляю новости…");
            const result = await topUpDigest();
            toast.dismiss(running);
            if (result?.error) {
              toast.error(result.error);
            } else if (result?.added) {
              toast.success(`Добавлено: ${result.added}`);
            } else {
              toast.info(result?.note ?? "Больше свежих новостей нет");
            }
          }),
      },
    });

  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const full = chips.length >= plan.maxTopics;
  // Предел — не повод молчать: кнопка остаётся нажимаемой и объясняет,
  // что за ней. Погашенная кнопка сообщает только «нельзя».
  const topicsPaywall = usePaywall("topics", plan);
  const digestPaywall = usePaywall("digest", plan);

  /** Размеры показываем все, какие есть в продукте: за чужими — корона. */
  const sizes = Array.from(
    new Set([...plan.digestSizes, ...PLANS.pro.digestSizes, total]),
  ).sort((a, b) => a - b);

  const add = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (full) return;
    if (chips.some((chip) => chip.label.toLowerCase() === trimmed.toLowerCase())) return;
    const next = [...chips, { slug: "", label: trimmed, hint: "", count: MIN_PER_TOPIC }];
    // Новая тема берёт место у самой крупной, а не растит дайджест:
    // количество новостей в день читатель задал отдельно и сам.
    setChips(withCounts(next, normalize(next.map((chip) => chip.count), total)));
    setDraft("");
  };

  const remove = (index: number) => {
    const next = chips.filter((_, i) => i !== index);
    setChips(withCounts(next, normalize(next.map((chip) => chip.count), total)));
    setSelected(null);
  };

  const patch = (index: number, fields: Partial<ChipInput>) =>
    setChips(chips.map((chip, i) => (i === index ? { ...chip, ...fields } : chip)));

  /** Добавить теме место можно только отняв у соседа: сумма — это размер дайджеста. */
  const nudge = (index: number, by: number) => {
    // Отнять не у кого: у единственной темы счётчик уехал бы от суммы,
    // а «3 из 20» на экране означало бы не то, что придёт.
    if (chips.length < 2) return;
    const donor = chips.findIndex((chip, i) => i !== index && chip.count > MIN_PER_TOPIC);
    if (by > 0 && donor < 0) return;
    if (by < 0 && chips[index].count <= MIN_PER_TOPIC) return;
    const counts = chips.map((chip) => chip.count);
    counts[index] += by;
    counts[by > 0 ? donor : biggestOther(counts, index)] -= by;
    setCounts(counts);
  };

  /** Порядок интересов — это порядок вкладок в ленте и кусков на полосе. */
  const reorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= chips.length) return;
    const next = [...chips];
    next.splice(to, 0, ...next.splice(from, 1));
    setChips(next);
    if (selected === from) setSelected(to);
    return to;
  };

  return (
    <FieldGroup>
      <input type="hidden" name="chips" value={JSON.stringify(chips)} />

      <Field>
        <FieldLabel htmlFor="digest_size" className="flex items-center gap-1.5">
          Новостей в выпуске
          {maxDigestOf(plan) < maxDigestOf(PLANS.pro) ? (
            <PaywallCrown feature="digest" plan={plan} />
          ) : null}
        </FieldLabel>
        {/* Пять значений видны сразу: за списком они прячутся по одному,
            и «сколько читать» превращается в два действия вместо одного.
            Шаг в двадцать — заметная разница, «37» такой разницы не несёт.
            Значение вне списка (например, прежние 12) остаётся первым
            вариантом, пока его не сменили. */}
        <ToggleGroup
          value={[String(total)]}
          onValueChange={(value: string[]) => {
            const size = Number(value[0]);
            if (!value[0]) return;
            // Выбор размера не с этого тарифа не гасится молча: молчаливый
            // отказ читается как поломка переключателя.
            if (size > maxDigestOf(plan)) {
              digestPaywall.open();
              return;
            }
            setTotal(size);
          }}
          variant="outline"
        >
          {sizes.map((size) => {
            const beyond = size > maxDigestOf(plan);
            return (
              // Не disabled: выключенная кнопка не ловит нажатие, и объяснить
              // читателю, почему она погасла, становится нечем.
              <ToggleGroupItem
                key={size}
                value={String(size)}
                aria-disabled={beyond || undefined}
                className={beyond ? "text-muted-foreground/50" : undefined}
              >
                {size}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        {digestPaywall.dialog}
        <input type="hidden" name="digest_size" value={total} />
      </Field>

      {chips.length > 0 ? (
        <Field>
          <TopicBudgetBar
            labels={chips.map((chip) => chip.label)}
            counts={chips.map((chip) => chip.count)}
            onChange={setCounts}
          />
          <FieldDescription>Тяни границы, чтобы отдать теме больше или меньше</FieldDescription>
        </Field>
      ) : null}

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip, index) => (
            <Fragment key={`${chip.label}-${index}`}>
              <div
                draggable={selected !== index}
                onDragStart={() => setDragging(index)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dragging === null || dragging === index) return;
                  const moved = reorder(dragging, index);
                  if (moved !== undefined) setDragging(moved);
                }}
                onClick={() => setSelected(selected === index ? null : index)}
                onKeyDown={(event) => {
                  if (selected === index) return;
                  if (event.key === "ArrowLeft") { event.preventDefault(); reorder(index, index - 1); }
                  if (event.key === "ArrowRight") { event.preventDefault(); reorder(index, index + 1); }
                }}
                tabIndex={0}
                role="button"
                aria-label={`${chip.label}, ${chip.count} из ${total}. Стрелками влево и вправо — переставить`}
                className={cn(
                  "group flex h-10 items-center gap-1.5 rounded-lg border bg-card pr-1 pl-2 text-sm transition-colors select-none",
                  "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  selected === index
                    ? "border-foreground/30 bg-muted"
                    : "cursor-grab hover:bg-muted active:cursor-grabbing",
                  dragging === index && "opacity-40",
                )}
              >
                <GripVerticalIcon className="-ml-1.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />

                {/* Кружок связывает чип с его куском полосы. Цвет закреплён
                    за местом в списке, а не за темой: тем бывает больше,
                    чем цветов, и повтор честнее, чем неразличимые оттенки. */}
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full border-[3px]"
                  style={{ borderColor: colorAt(index) }}
                />

                {/* Имя правится прямо в чипе: отдельное поле «название темы»
                    заставляло бы искать, где переименовать то, что уже видно. */}
                {selected === index ? (
                  <input
                    value={chip.label}
                    aria-label="Название темы"
                    onChange={(event) => patch(index, { label: event.target.value })}
                    onClick={(event) => event.stopPropagation()}
                    size={Math.max(chip.label.length, 4)}
                    className="min-w-0 bg-transparent outline-none"
                  />
                ) : (
                  <span>{chip.label}</span>
                )}

                <span className="shrink-0 tabular-nums text-muted-foreground">{chip.count}</span>

                <button
                  type="button"
                  aria-label={`Убрать ${chip.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(index);
                  }}
                  className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 hover:bg-background hover:text-foreground"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>

              {/* Детали раскрываются под самим чипом, а не внизу формы:
                  w-full в ряду с переносом переводит блок на новую строку,
                  и он оказывается ровно под своей строкой чипов. */}
              {selected === index ? (
                <div className="w-full">
                  <Textarea
                    id={`hint-${index}`}
                    rows={2}
                    value={chip.hint}
                    aria-label={`Что относится к теме «${chip.label}»`}
                    placeholder="через запятую: что сюда относится"
                    onChange={(event) => patch(index, { hint: event.target.value })}
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Чем точнее, тем меньше лишнего в выпуске
                  </p>

                  {/* То же, что и полоса, но пальцем и с клавиатуры: на узком
                      экране границу шириной в четыре пиксела не поймать. */}
                  <div className="mt-3 flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="На одну новость меньше"
                      onClick={() => nudge(index, -1)}
                      disabled={chip.count <= MIN_PER_TOPIC}
                    >
                      <MinusIcon />
                    </Button>
                    <span className="w-16 text-center text-sm tabular-nums">
                      {chip.count} из {total}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="На одну новость больше"
                      onClick={() => nudge(index, 1)}
                    >
                      <PlusIcon />
                    </Button>
                  </div>
                </div>
              ) : null}
            </Fragment>
          ))}
        </div>
      ) : null}

      {/* Поле добавления внизу: сверху то, что уже есть, а не пустая строка. */}
      <Field>
        <div className="flex gap-2">
          <Input
            id="chip-draft"
            value={draft}
            aria-label="Новый интерес"
            placeholder="Например: энергетика и уран"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add(draft);
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => (full ? topicsPaywall.open() : add(draft))}
          >
            <PlusIcon data-icon="inline-start" />
            Добавить
          </Button>
        </div>
        {topicsPaywall.dialog}
        <FieldDescription>
          {full
            ? `На тарифе «${plan.label}» ${plan.maxTopics} ${topicsWord(plan.maxTopics)} — убери один, чтобы добавить новый`
            : `${chips.length} из ${plan.maxTopics} на тарифе «${plan.label}»`}
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}

const withCounts = (chips: ChipInput[], counts: number[]): ChipInput[] =>
  chips.map((chip, index) => ({ ...chip, count: counts[index] ?? MIN_PER_TOPIC }));

/** У кого отнять место: у самой крупной темы, кроме той, что растёт. */
const biggestOther = (counts: number[], except: number) =>
  counts.reduce(
    (best, count, index) => (index !== except && count > counts[best] ? index : best),
    except === 0 ? 1 : 0,
  );
