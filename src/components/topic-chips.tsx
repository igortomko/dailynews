"use client";

import { Fragment, useRef, useState } from "react";
import Link from "next/link";
import { XIcon, PlusIcon, MinusIcon, GripVerticalIcon, CrownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TopicBudgetBar } from "@/components/topic-budget-bar";
import { Field, FieldDescription, FieldLabel, FieldGroup } from "@/components/ui/field";
import { MIN_PER_TOPIC, colorAt, normalize } from "@/lib/topic-budget";
import { MIN_READING_MINUTES, READING_MINUTES, PLAN_IDS, PLANS, type Plan } from "@/lib/plans";
import { formatMinutes, itemsForMinutes } from "@/lib/reading-time";
import { usePaywall } from "@/components/paywall";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { type ChipInput } from "@/lib/actions";
import { rulesAnchor } from "@/lib/rules";
import { ownLabel, TOPIC_LIMITS } from "@/lib/starter-topics";
import { queueRebuild } from "@/components/rebuild-queue";
import { useT } from "@/components/i18n-provider";

/**
 * Чип в форме: `own` обязателен. Форма решает по нему, показывать ли поле
 * подсказки, и необязательное поле молча делало бы каждую тему «только
 * для чтения» у того, кто забыл его передать. Сервер этого поля не читает
 * и решает сам (`upsertTopic`).
 */
export type FormChip = ChipInput & { own: boolean };

export function TopicChips({
  initial,
  initialMinutes,
  perCard,
  inToday,
  onChange,
  plan,
}: {
  initial: FormChip[];
  /** Заказ читателя: сколько минут чтения он просит. */
  initialMinutes: number;
  /**
   * Сколько минут занимает одна его карточка. Считается на сервере по уже
   * написанным описаниям — здесь только делится, той же функцией, что
   * и в прогоне: вторая копия арифметики разошлась бы с ней молча, и полоса
   * делила бы места, которых не будет.
   */
  perCard: number;
  /** Тариф: он задаёт и потолок числа интересов, и потолок времени. */
  plan: Plan;
  /** Сколько минут в последнем выпуске: с ними сверяется предложение догрузить. */
  inToday: number;
  onChange?: () => void;
}) {
  const t = useT();
  const tc = t.settings.topicChips;
  const planLabel = t.plans.label[plan.id];
  const [minutes, setMinutesState] = useState(initialMinutes);
  // Места считаются из времени, а не хранятся: число карточек — следствие
  // заказа, и вторая правда о нём разъехалась бы с первой на первой же смене
  // языка (описания по-английски короче, и в те же минуты их влезает больше).
  const places = itemsForMinutes(minutes, perCard, plan.maxItems);
  // Потолок штук упёрся раньше времени: у короткой карточки в заказанные
  // минуты влезло бы больше, чем тариф отдаёт. Молчать об этом нельзя —
  // выпуск выходил бы короче заказа каждый день, и виноватым выглядел бы
  // поток, а не наш предел.
  const capped = places < Math.round(minutes / perCard);
  // Цели приводим к сумме сразу: в базе лежат цели от прошлого набора тем,
  // и без приведения полоса показывала бы не тот выпуск, который придёт.
  const [chips, setChipsState] = useState<FormChip[]>(() =>
    // `places` на первом проходе и есть места этого заказа: `minutes`
    // заведено из `initialMinutes`. Вторая запись той же формулы разошлась бы
    // с первой на первой же правке.
    withCounts(initial, normalize(initial.map((chip) => chip.count), places)),
  );

  // Скрытые поля меняются без события формы, поэтому о правке сообщаем сами:
  // иначе автосохранение их не заметит.
  const setChips = (next: FormChip[]) => {
    setChipsState(next);
    onChange?.();
  };

  const setCounts = (counts: number[]) => setChips(withCounts(chips, counts));

  const setMinutes = (next: number) => {
    const asked = Math.min(plan.maxMinutes, Math.max(MIN_READING_MINUTES, next));
    setMinutesState(asked);
    setChips(withCounts(
      chips,
      normalize(chips.map((chip) => chip.count), itemsForMinutes(asked, perCard, plan.maxItems)),
    ));
    offerTopUp(asked);
  };

  /**
   * Новый размер сам по себе ничего не меняет до полуночи: сегодняшний выпуск
   * уже отобран. Раньше здесь же спрашивали «добавить?» и ждали ответа минуту
   * с лишним — всё это время интерфейс был занят, а читатель сидел в настройках
   * и смотрел на спиннер. Теперь правка просто откладывается: догрузка начнётся,
   * когда из настроек выйдут, и пойдёт фоном.
   */
  const offerTopUp = (asked: number) => {
    if (asked > inToday) queueRebuild("size");
  };

  const [draft, setDraft] = useState("");
  // Куда вернуть фокус, когда убранный чип унесёт его с собой.
  const box = useRef<HTMLDivElement>(null);
  const draftInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const full = chips.length >= plan.maxTopics;
  // Предел — не повод молчать: кнопка остаётся нажимаемой и объясняет,
  // что за ней. Погашенная кнопка сообщает только «нельзя».
  const topicsPaywall = usePaywall("topics", plan);
  const digestPaywall = usePaywall("digest", plan);

  /** Время показываем всё, какое есть в продукте: за чужим — корона. */
  const sizes = Array.from(new Set([...READING_MINUTES, minutes])).sort((a, b) => a - b);

  /** Тарифы, где выпуск бывает длиннее: их имена стоят в подписи под кнопками. */
  const bigger = PLAN_IDS
    .filter((id) => PLANS[id].maxMinutes > plan.maxMinutes)
    .map((id) => t.plans.label[id]);

  const add = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (full) return;
    if (chips.some((chip) => chip.label.toLowerCase() === trimmed.toLowerCase())) return;
    // Заведённая руками тема — своя: подсказку и имя можно править сразу.
    // Кроме имени, которое сводится к слагу каталожной темы («AI-инфра» —
    // это `ai-infra`): сервер сочтёт её каталожной, и поле, чью правку он
    // отбросит, здесь не показывается — тем же правилом, что и у него.
    // Совпадёт со взятой соседом — сервер правку отбросит, а после
    // перезагрузки чип придёт уже общим.
    const next = [...chips, {
      slug: "", label: trimmed, hint: "", count: MIN_PER_TOPIC, own: ownLabel(trimmed),
    }];
    // Новая тема берёт место у самой крупной, а не растит выпуск:
    // сколько читать, читатель задал отдельно и сам.
    setChips(withCounts(next, normalize(next.map((chip) => chip.count), places)));
    setDraft("");
  };

  const remove = (index: number) => {
    const next = chips.filter((_, i) => i !== index);
    setChips(withCounts(next, normalize(next.map((chip) => chip.count), places)));
    setSelected(null);

    // Кнопка, по которой только что нажали, исчезает вместе с чипом,
    // и фокус уходит в body: с клавиатуры это потеря места — дальше Tab
    // начинает обход страницы заново. Принимаем его крестик соседа,
    // а когда убрали последний — поле ввода нового интереса.
    requestAnimationFrame(() => {
      const buttons = box.current?.querySelectorAll<HTMLButtonElement>("[data-chip-remove]") ?? [];
      const landing = buttons[Math.min(index, buttons.length - 1)];
      (landing ?? draftInput.current)?.focus();
    });
  };

  /**
   * Своя ли тема после правки имени. Только у чипа без слага: у него слаг
   * выведет сервер из имени (`chip.slug || toSlug(chip.label)`), и совпадение
   * с каталожным делает тему каталожной — тем же правилом, что и `add`.
   * У темы со слагом имя на слаг не влияет.
   */
  const settleOwn = (index: number) => {
    const chip = chips[index];
    // У темы со слагом имя на слаг не влияет — пересчитывать нечего.
    if (chip.slug) return;
    const own = ownLabel(chip.label);
    // Без изменений — без записи: setChips зовёт `touch`, и одно наведение
    // на имя с уходом зажигало бы «Сохранить» и сторожа ухода впустую.
    if (own === chip.own) return;
    setChips(chips.map((current, i) => (i === index ? { ...current, own } : current)));
  };

  const patch = (index: number, fields: Partial<Pick<ChipInput, "label" | "hint">>) =>
    setChips(chips.map((chip, i) => (i === index ? { ...chip, ...fields } : chip)));

  /** Добавить теме место можно только отняв у соседа: сумма — это весь выпуск. */
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
    <FieldGroup ref={box}>
      <input type="hidden" name="chips" value={JSON.stringify(chips)} />

      <Field>
        <FieldLabel id="digest-minutes-label">{tc.minutesLabel}</FieldLabel>
        {/* Заказывается время, а не штуки: «сорок новостей» не отвечает
            на вопрос, который задают перед чтением. Все пять значений видны
            сразу — за списком они прячутся по одному, и «сколько читать»
            превращается в два действия вместо одного. Значение вне списка
            (осталось от прежнего тарифа) стоит своим вариантом, пока его
            не сменили. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <ToggleGroup
            aria-labelledby="digest-minutes-label"
            value={[String(minutes)]}
            onValueChange={(value: string[]) => {
              const asked = Number(value[0]);
              if (!value[0]) return;
              // Время не с этого тарифа не гасится молча: молчаливый отказ
              // читается как поломка переключателя.
              if (asked > plan.maxMinutes) {
                digestPaywall.open();
                return;
              }
              setMinutes(asked);
            }}
            variant="outline"
          >
            {sizes.map((size) => {
              const beyond = size > plan.maxMinutes;
              return (
                // Не disabled: выключенная кнопка не ловит нажатие, и объяснить
                // читателю, почему она погасла, становится нечем. Корона стоит
                // в самой кнопке, а не у подписи над группой: закрыт не раздел,
                // а конкретные числа, и по подписи не видно, какие.
                <ToggleGroupItem
                  key={size}
                  value={String(size)}
                  aria-disabled={beyond || undefined}
                  aria-label={beyond ? `${tc.minutes(size)}, ${tc.onPaidPlan}` : tc.minutes(size)}
                  className={beyond ? "text-muted-foreground/60" : undefined}
                >
                  {tc.minutesShort(size)}
                  {beyond ? (
                    <CrownIcon className="size-3.5 text-amber-500/80" aria-hidden />
                  ) : null}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          {/* Штуки не исчезают совсем: полоса ниже делит именно их, и без
              этой строки «3 из 12» было бы числом из ниоткуда. Но стоят они
              подписью к времени, а не вместо него. */}
          <span className="text-sm text-muted-foreground">
            {/* Знаком, а не словом, и тем же, что у времени чтения
                в карточке: два написания одной и той же оговорки в одном
                продукте читаются как две разные. */}
            <span className="font-medium text-foreground tabular-nums">~{places}</span>{" "}
            {tc.storiesWord(places)}
          </span>
        </div>
        {digestPaywall.dialog}
        {capped ? (
          // Потолок штук упёрся раньше времени — значит, заказанных минут
          // не будет, и сказать об этом должны мы, а не пустое место в ленте.
          <FieldDescription>
            {tc.capReached(planLabel, plan.maxItems, formatMinutes(places * perCard, t.feed.time))}
          </FieldDescription>
        ) : bigger.length > 0 ? (
          // Тарифы названы, а не спрятаны за «в других»: предел без имени
          // того, кто его снимает, — это отказ, за которым надо идти искать.
          // Список считается из PLANS: написанный руками, он разъедется
          // с настоящими пределами молча.
          <FieldDescription>
            {tc.upToMinutes(planLabel, plan.maxMinutes)}{" "}
            <Link href="/settings/subscription" className="underline underline-offset-4">
              {tc.onPlans(bigger)}
            </Link>
          </FieldDescription>
        ) : null}
        <input type="hidden" name="digest_minutes" value={minutes} />
      </Field>

      {chips.length > 1 ? (
        <Field>
          {/* Единица названа в подписи: под полосой стоят новости, а выпуск
              заказан минутами, и без слова числа читаются той единицей,
              которой набран весь экран выше. */}
          <FieldLabel>{tc.distributionLabel}</FieldLabel>
          <TopicBudgetBar
            labels={chips.map((chip) => chip.label)}
            counts={chips.map((chip) => chip.count)}
            onChange={setCounts}
          />
        </Field>
      ) : null}

      {chips.length > 0 ? (
        <Field>
          <FieldLabel className="flex items-center gap-2">
            {tc.yourTopics}
            {/* Счётчик у подписи, а не строкой под полем ввода: там он читался
                как отказ, хотя отказом становится только на пределе. */}
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {tc.ofTotal(chips.length, plan.maxTopics)}
            </span>
          </FieldLabel>
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
                aria-label={tc.chipAria(chip.label, chip.count, places)}
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
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colorAt(index) }}
                />

                {/* Имя правится прямо в чипе: отдельное поле «название темы»
                    заставляло бы искать, где переименовать то, что уже видно.
                    Только у своей темы: название каталожной или взятой соседом
                    общее, и поле, чья правка не сохраняется, — обман. */}
                {selected === index && chip.own ? (
                  <input
                    value={chip.label}
                    maxLength={TOPIC_LIMITS.label}
                    aria-label={tc.topicNameAria}
                    onChange={(event) => patch(index, { label: event.target.value })}
                    // Сервер выводит слаг новой темы из имени при записи,
                    // и новое имя может сделать её каталожной («Крипта» →
                    // «Blockchain»). Признак пересчитывается, когда правка
                    // закончена, а не на каждую букву: иначе поле исчезало бы
                    // под пальцами на полуслове.
                    onBlur={() => settleOwn(index)}
                    onClick={(event) => event.stopPropagation()}
                    size={Math.max(chip.label.length, 4)}
                    className="min-w-0 bg-transparent outline-none"
                  />
                ) : (
                  <span>{chip.label}</span>
                )}

                <span className="shrink-0 tabular-nums text-muted-foreground">{chip.count}</span>

                {/* Виден всегда, красный только по наведению. Прятать его
                    до наведения нельзя: на тапе group-hover не наступает
                    никогда, и убрать интерес с телефона было нечем —
                    возможность, которой нет ровно там, где она нужна. */}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        data-chip-remove
                        aria-label={tc.removeAria(chip.label)}
                        onClick={(event) => {
                          event.stopPropagation();
                          remove(index);
                        }}
                        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      />
                    }
                  >
                    <XIcon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>{tc.removeTooltip}</TooltipContent>
                </Tooltip>
              </div>

              {/* Детали раскрываются под самим чипом, а не внизу формы:
                  w-full в ряду с переносом переводит блок на новую строку,
                  и он оказывается ровно под своей строкой чипов. */}
              {selected === index ? (
                <div className="w-full">
                  {chip.own ? (
                    <>
                      <Textarea
                        id={`hint-${index}`}
                        rows={2}
                        value={chip.hint}
                        maxLength={TOPIC_LIMITS.hint}
                        aria-label={tc.hintAria(chip.label)}
                        placeholder={tc.hintPlaceholder}
                        onChange={(event) => patch(index, { hint: event.target.value })}
                      />
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {tc.hintHelp}
                      </p>
                    </>
                  ) : (
                    // Подсказка темы — критерий классификации Jev, один на всех,
                    // кто её взял. Поле у общей темы приглашало вписать сюда
                    // имена и продукты, а правка молча терялась. Вместо поля —
                    // адрес, куда имена и идут: слежение личное и буквальное.
                    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                      {/* Подсказка остаётся видимой, хоть и не правится: это
                          критерий, по которому тема попадает в выпуск, и больше
                          его негде прочитать. */}
                      {chip.hint ? <p className="text-foreground/80">{chip.hint}</p> : null}
                      <p>
                        {tc.sharedNote}{" "}
                        <a href={`#${rulesAnchor("follow")}`} className="underline underline-offset-4">
                          {tc.sharedLink(t.rules.follow.label)}
                        </a>
                        .
                      </p>
                    </div>
                  )}

                  {/* То же, что и полоса, но пальцем и с клавиатуры: на узком
                      экране границу шириной в четыре пиксела не поймать. */}
                  <div className="mt-3 flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={tc.lessAria}
                            onClick={() => nudge(index, -1)}
                            disabled={chip.count <= MIN_PER_TOPIC}
                          />
                        }
                      >
                        <MinusIcon />
                      </TooltipTrigger>
                      <TooltipContent>{tc.lessTooltip}</TooltipContent>
                    </Tooltip>
                    <span className="w-16 text-center text-sm tabular-nums">
                      {tc.ofTotal(chip.count, places)}
                    </span>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={tc.moreAria}
                            onClick={() => nudge(index, 1)}
                          />
                        }
                      >
                        <PlusIcon />
                      </TooltipTrigger>
                      <TooltipContent>{tc.moreTooltip}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ) : null}
            </Fragment>
          ))}
          </div>
        </Field>
      ) : null}

      {/* Поле добавления внизу: сверху то, что уже есть, а не пустая строка. */}
      <Field>
        <div className="flex gap-2">
          <Input
            id="chip-draft"
            ref={draftInput}
            value={draft}
            maxLength={TOPIC_LIMITS.label}
            aria-label={tc.newTopicAria}
            placeholder={tc.newTopicPlaceholder}
            onChange={(event) => setDraft(event.target.value)}
            // Уход из поля добавляет набранное, как в «За чем следить»:
            // «Сохранить» гасит фокус до снимка формы, и набранное, но
            // не добавленное имя иначе стиралось бы пересевом молча.
            // Кнопка рядом фокус на mousedown не забирает — иначе первый
            // клик уходил бы в пустоту под съехавшим полем.
            onBlur={() => add(draft)}
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
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => (full ? topicsPaywall.open() : add(draft))}
          >
            <PlusIcon data-icon="inline-start" />
            {tc.add}
          </Button>
        </div>
        {topicsPaywall.dialog}
        {full ? (
          <FieldDescription>
            {tc.topicLimitReached(planLabel, plan.maxTopics, t.plans.topicsWord(plan.maxTopics))}
          </FieldDescription>
        ) : null}
      </Field>
    </FieldGroup>
  );
}

const withCounts = <T extends ChipInput>(chips: T[], counts: number[]): T[] =>
  chips.map((chip, index) => ({ ...chip, count: counts[index] ?? MIN_PER_TOPIC }));

/** У кого отнять место: у самой крупной темы, кроме той, что растёт. */
const biggestOther = (counts: number[], except: number) =>
  counts.reduce(
    (best, count, index) => (index !== except && count > counts[best] ? index : best),
    except === 0 ? 1 : 0,
  );
