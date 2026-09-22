"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  XIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { QUIET } from "@/lib/quiet";
import { useLocale, useT } from "@/components/i18n-provider";
import { formatDay } from "@/lib/relative-time";
import { move, overviewMarkdown, overviewText, type Overview } from "@/lib/overview";

/**
 * Плашка над лентой: сколько отмечено и что с этим делать.
 *
 * Обратная странице, как тост и кнопка «наверх»: всё, что лежит поверх
 * ленты, здесь выглядит одинаково. Живёт только пока есть выбор — плашка
 * с нулём была бы предметом на экране без единого действия.
 *
 * На широком экране — по содержимому, а не по колонке: полоса от края
 * до края читалась бы как панель приложения, а это подсказка к трём
 * карточкам. На телефоне наоборот, во всю ширину и вплотную к нижнему
 * краю, с запасом под полосу жеста: плавающая таблетка там ложилась
 * на текст с обеих сторон и ничего не выигрывала.
 *
 * Тосты живут там же, внизу по центру, и пока плашка на экране, они
 * поднимаются над ней на её измеренную высоту (см. `Bar`).
 */
export function SelectionBar({
  count: selected,
  onClear,
  onOpen,
}: {
  count: number;
  onClear: () => void;
  onOpen: () => void;
}) {
  return selected === 0 ? null : <Bar count={selected} onClear={onClear} onOpen={onOpen} />;
}

function Bar({
  count: selected,
  onClear,
  onOpen,
}: {
  count: number;
  onClear: () => void;
  onOpen: () => void;
}) {
  const t = useT().feed.overview;
  const bar = useRef<HTMLDivElement>(null);

  // Сколько места плашка занимает снизу — измеряется, а не записано числом
  // в двух местах: на узком экране она переносится на две строки, и тост,
  // поднятый на константу, ложился бы на верхнюю. Переменная живёт на html,
  // пока плашка на экране; globals.css поднимает на неё тосты.
  //
  // Меряется обёртка, а не сама плашка: обёртка держит отступ снизу вместе
  // с safe-area и не анимируется, а плашка въезжает снизу, и её положение
  // в момент монтирования на восемь пикселей ниже конечного.
  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--selection-bar-lift", `${node.offsetHeight + 8}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--selection-bar-lift");
    };
  }, []);

  return (
    <div
      ref={bar}
      data-slot="selection-bar"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center sm:px-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div
        role="toolbar"
        aria-label={t.toolbarLabel}
        className={cn(
          "pointer-events-auto flex w-full flex-wrap items-center gap-1 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]",
          "sm:w-auto sm:max-w-page sm:rounded-2xl sm:p-1.5",
          "bg-foreground text-background shadow-lg shadow-black/20",
          "animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none",
        )}
      >
        {/* Крестик с краю, а не между числом и главной кнопкой: рядом
            с «Собрать» промах пальцем снимал бы весь выбор, а с противоположного
            конца плашки он читается как «отмена» — там, где её ищут. */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={t.clearAria}
                onClick={onClear}
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-background/70 transition-colors hover:bg-background/15 hover:text-background focus-visible:ring-3 focus-visible:ring-background/40 outline-none"
              />
            }
          >
            <XIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent>{t.clearTooltip}</TooltipContent>
        </Tooltip>
        {/* Живая область: число меняется от каждого нажатия, и диктору
            об этом надо сказать без перевода фокуса на плашку. */}
        {/* На телефоне число прижато к крестику, кнопка — к правому краю:
            mr-auto растягивает промежуток, а на таблетке промежутка нет. */}
        <span aria-live="polite" className="mx-1.5 mr-auto text-sm font-medium tabular-nums sm:mr-1.5">
          {t.selected(selected)}
        </span>
        {/* «Собрать», а не «написать»: текст уже готов, модель здесь
            не зовётся, и обещать её работу было бы неправдой. */}
        <button
          type="button"
          onClick={onOpen}
          className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-background px-3 text-sm font-medium text-foreground transition-[background-color,scale] duration-150 outline-none hover:bg-background/90 focus-visible:ring-3 focus-visible:ring-background/40 active:scale-[0.97]"
        >
          <FileTextIcon className="size-4" />
          {t.build}
        </button>
      </div>
    </div>
  );
}

/**
 * Поле редактора: без рамки в покое, серое под курсором и в фокусе.
 *
 * Обзор читается как документ, а не как анкета: рамка вокруг каждого
 * абзаца превращала страницу в форму из десяти полей. Что текст правится,
 * видно ровно тогда, когда к нему тянутся. Кольца фокуса нет намеренно —
 * его роль играет тот же серый фон.
 *
 * Отрицательные поля — чтобы текст поля стоял вровень со строкой над ним,
 * а серая подложка выходила за него на восемь пикселей в обе стороны.
 */
const FIELD =
  "-mx-2 w-[calc(100%+1rem)] rounded-md border-transparent bg-transparent px-2 shadow-none transition-colors hover:bg-muted focus-visible:border-transparent focus-visible:bg-muted focus-visible:ring-0 dark:bg-transparent dark:hover:bg-muted dark:focus-visible:bg-muted";

/**
 * Кнопка в строке блока: стрелка или крестик, с подсказкой.
 *
 * aria-disabled, а не disabled: у крайнего блока стрелка выключена,
 * но браузер снимает фокус с выключенной кнопки, и с клавиатуры место
 * в списке терялось бы ровно в момент нажатия.
 */
function BlockAction({
  label,
  icon: Icon,
  onClick,
  disabled = false,
  destructive = false,
}: {
  label: string;
  icon: typeof ArrowUpIcon;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-disabled={disabled}
            onClick={disabled ? undefined : onClick}
            className={cn(
              "flex size-7 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              disabled && "text-muted-foreground/30",
              !disabled && "cursor-pointer text-muted-foreground/60",
              !disabled && destructive && "hover:bg-destructive/10 hover:text-destructive",
              !disabled && !destructive && "hover:bg-muted hover:text-foreground",
            )}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Редактор обзора.
 *
 * Открывается сразу и с готовым текстом: заголовки, описания и ссылки
 * уже написаны для этого читателя, ждать здесь нечего. Всё редактируется
 * на месте, правки живут в черновике и карточек выпуска не трогают.
 *
 * Черновик держит родитель, а не диалог: закрытие окна не должно стирать
 * написанное вступление, а выбор в ленте и состав блоков — одно и то же
 * состояние, и его нельзя держать в двух местах.
 *
 * Список блоков прокручивается внутри окна, кнопки копирования стоят
 * внизу и видны всегда: обзор из десяти новостей длиннее экрана,
 * а главное действие нельзя прятать за прокруткой. Высота — от `dvh`,
 * чтобы на телефоне окно ужималось вместе с клавиатурой.
 */
export function OverviewDialog({
  day,
  overview,
  open,
  onOpenChange,
  onChange,
}: {
  day: string;
  overview: Overview;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (next: Overview) => void;
}) {
  const t = useT().feed.overview;
  const locale = useLocale();
  const [copied, setCopied] = useState<"text" | "markdown" | null>(null);
  // Текст, который не удалось положить в буфер: остаётся на экране
  // выделенным, чтобы его можно было скопировать руками.
  const [fallback, setFallback] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const popup = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fallback === null) return;
    field.current?.focus();
    field.current?.select();
  }, [fallback]);

  // Закрытие сбрасывает следы копирования: галочка «скопировано» на
  // повторном открытии обещала бы буфер, в котором уже другое.
  const close = (next: boolean) => {
    if (!next) {
      setCopied(null);
      setFallback(null);
    }
    onOpenChange(next);
  };

  const { blocks } = overview;
  const update = (patch: Partial<Overview>) => onChange({ ...overview, ...patch });
  const patchBlock = (id: number, patch: Partial<Overview["blocks"][number]>) =>
    update({ blocks: blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)) });

  const copy = async (format: "text" | "markdown") => {
    const text = format === "markdown" ? overviewMarkdown(overview) : overviewText(overview);
    try {
      // Без буфера (небезопасный адрес, старый браузер) `clipboard`
      // отсутствует вовсе — это тот же отказ, что и запрет доступа.
      if (!navigator.clipboard) throw new Error("буфер недоступен");
      await navigator.clipboard.writeText(text);
      // Успех — только после подтверждения буфера: галочка до записи
      // обещала бы то, чего могло не случиться.
      setCopied(format);
      setFallback(null);
      toast.success(t.copied, { description: t.copiedHint });
    } catch {
      setCopied(null);
      setFallback(text);
      toast.warning(t.clipboardDeniedTitle, { description: t.clipboardDeniedDescription });
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        ref={popup}
        // С мыши и клавиатуры фокус встаёт в заголовок — правка начинается
        // сразу. С пальца — на само окно: фокус в поле поднял бы клавиатуру
        // раньше, чем человек увидел, что вообще собралось.
        initialFocus={(type) => (type === "touch" ? popup.current : true)}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{t.issueOf(formatDay(day, locale), blocks.length)}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          <Input
            aria-label={t.titleLabel}
            value={overview.title}
            onChange={(event) => update({ title: event.target.value })}
            className={cn(FIELD, "font-medium")}
          />
          {/* Вступление пишет человек. Дописать его за него — значит
              вложить в его уста вывод, которого он не делал. */}
          <Textarea
            aria-label={t.introLabel}
            placeholder={t.introPlaceholder}
            value={overview.intro}
            onChange={(event) => update({ intro: event.target.value })}
            // Свой минимум у каждого поля: с field-sizing: content пустое
            // поле сжимается до одних полей ввода, и `rows` ему не указ.
            className={cn(FIELD, "min-h-14 leading-relaxed")}
          />

          {blocks.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t.empty}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {blocks.map((block, index) => (
                <li key={block.id} className="group flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">{index + 1}.</span>
                    <span className="shrink-0 font-medium text-foreground/75">{block.source}</span>
                    {/* Ссылка на саму статью, а не на издание: в обзор
                        уходит она, и проверить её надо здесь же. */}
                    <a
                      href={block.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="min-w-0 truncate underline-offset-4 hover:underline"
                    >
                      {block.url}
                    </a>
                    <div className={cn("ml-auto flex shrink-0 items-center", QUIET)}>
                      <BlockAction
                        label={t.up}
                        icon={ArrowUpIcon}
                        disabled={index === 0}
                        onClick={() => update({ blocks: move(blocks, index, index - 1) })}
                      />
                      <BlockAction
                        label={t.down}
                        icon={ArrowDownIcon}
                        disabled={index === blocks.length - 1}
                        onClick={() => update({ blocks: move(blocks, index, index + 1) })}
                      />
                      {/* Убрать здесь — снять выбор в ленте: состав обзора
                          и отмеченные карточки — одно состояние. */}
                      <BlockAction
                        label={t.removeBlock}
                        icon={XIcon}
                        destructive
                        onClick={() =>
                          update({ blocks: blocks.filter((entry) => entry.id !== block.id) })
                        }
                      />
                    </div>
                  </div>
                  <Textarea
                    aria-label={t.blockTitleLabel}
                    value={block.title}
                    onChange={(event) => patchBlock(block.id, { title: event.target.value })}
                    className={cn(FIELD, "min-h-9 font-medium")}
                  />
                  <Textarea
                    aria-label={t.blockSummaryLabel}
                    value={block.summary}
                    onChange={(event) => patchBlock(block.id, { summary: event.target.value })}
                    className={cn(FIELD, "leading-relaxed")}
                  />
                </li>
              ))}
            </ol>
          )}

          {fallback !== null ? (
            <Textarea
              ref={field}
              readOnly
              aria-label={t.fallbackLabel}
              value={fallback}
              className="max-h-64 min-h-40 font-mono text-xs"
            />
          ) : null}
        </div>

        {/* Копирование — не отправка: текст уходит туда, куда его вставят
            сами. Формата два, данные одни: вкладки по сетям здесь ничего
            бы не меняли. */}
        <DialogFooter className="mx-0 mb-0 shrink-0">
          <Button
            variant="outline"
            disabled={blocks.length === 0}
            onClick={() => copy("markdown")}
          >
            {copied === "markdown" ? <CheckIcon /> : <CopyIcon />}
            {t.copyMarkdown}
          </Button>
          <Button disabled={blocks.length === 0} onClick={() => copy("text")}>
            {copied === "text" ? <CheckIcon /> : <CopyIcon />}
            {t.copy}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
