"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { TrashIcon, PlusIcon, CrownIcon, ExternalLinkIcon } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { addSource, deleteSource, discoverSource, restoreSource } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Field, FieldDescription, FieldError, FieldGroup } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { openUrlOf, SourceIcon } from "@/components/source-icon";
import type { SourceHealth } from "@/lib/queries";
import { cleanupOf } from "@/lib/source-health";
import { PLANS, type Plan } from "@/lib/plans";
import { PaywallCrown, usePaywall } from "@/components/paywall";
import type { Dict } from "@/lib/i18n";
import type { Found } from "../../../../../pipeline/discover";

/**
 * Перечисление, которое не растёт бесконечно.
 *
 * Тревога со склеенными именами полусотни источников — это абзац, который
 * не читают, то есть тревога, переставшая работать. Первые три называются,
 * остальные считаются: список рядом всё равно сортирован сломанным вверх.
 */
function listOf(names: string[], t: Dict["sources"], limit = 3): string {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} ${t.banners.andMore(names.length - limit)}`;
}

/**
 * Со скольких дней тишины источник считается сломанным.
 *
 * Тревога, которая горит на нормальном состоянии, перестаёт что-либо значить:
 * день-другой без свежего — обычное дело у любого блога, и красная метка
 * на нём приучает её не замечать.
 */
const SILENT_DAYS = 5;

/**
 * Что с источником не так, или null, когда всё в порядке.
 *
 * Строка отдачи под каждым источником — это тридцать строк служебного текста
 * на экране из десяти. Читают её, только когда с источником что-то не то;
 * в остальное время она есть в подсказке у числа последнего прогона.
 */
function troubleOf(source: SourceHealth, t: Dict["sources"]): string | null {
  // Прогон его ещё не видел: ни удачи, ни ошибки.
  if (!source.last_ok_at && !source.last_error) {
    return t.health.added;
  }
  // Про ошибку уже сказал бейдж и подсказка под ним. Добавить сюда «за 30
  // дней ни одной новости» значит сказать рядом с «не отвечает», что
  // источник отвечает и молчит, — две разные беды одной строкой.
  if (source.last_error) return null;
  if (source.items === 0) return t.health.noNews;
  // Новости даёт, но ни одна не доходит до выпуска: источник есть, толку нет,
  // и по одному числу последнего прогона этого не увидеть.
  if (source.in_my_digests === 0) return t.health.notInDigest;
  return null;
}

/**
 * Отдача источника за тридцать дней. Само по себе «дал 124 материала» ничего
 * не значит: важно, сколько из них дошло до выпусков и не перепечатки ли это.
 */
function yieldOf(source: SourceHealth, t: Dict["sources"]): string {
  // Прогон его ещё не видел: ни удачи, ни ошибки. Написать такому «за 30 дней
  // ни одного материала» — той же фразой, что и заброшенному, — значит
  // сообщить, что он бесполезен, через минуту после того, как его завели.
  if (!source.last_ok_at && !source.last_error) return t.health.added;
  if (source.items === 0) return t.health.noNews;
  // Ряд идёт по пути новости: сколько пришло, сколько дошло до выпуска,
  // сколько открыто. Открытия стоят последними не для красоты — это
  // единственное число здесь, которое ставит сам читатель, и по нему
  // решают, убирать ли источник.
  const parts = [t.health.summary(source.items, source.in_my_digests)];
  if (source.in_my_digests > 0) parts.push(t.health.opened(source.opened));
  if (source.mean_score !== null) {
    parts.push(t.health.score(source.mean_score));
  }
  if (source.duplicates > 0) {
    parts.push(t.health.duplicatesPercent(Math.round((source.duplicates / source.items) * 100)));
  }
  return parts.join(" · ");
}

/**
 * Список свой у каждого: каталог общий, чтобы один фид опрашивался один
 * раз на всех, но «мои источники» — это выбор, а не витрина. Убрать
 * источник значит убрать его у себя; у соседа он остаётся вместе со всей
 * своей историей.
 */
export function SourcesManager({
  sources,
  plan,
}: { sources: SourceHealth[]; plan: Plan }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [input, setInput] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Мест больше нет. Считается тем же правилом, что и на сервере
   * (`denyForKind`): виды, которых тариф не опрашивает, в счёт не идут —
   * иначе после понижения три ленты X занимали бы места живых источников
   * ещё и на глаз.
   *
   * Предел — не повод молчать: кнопка остаётся нажимаемой и открывает окно
   * с предложением, как «Добавить» у интересов. До этого она уходила
   * разбирать ссылку (запрос в сеть), а возвращалась строкой «на тарифе
   * „Бесплатный“ можно 5 источников» — отказ без единого выхода.
   */
  const full =
    sources.filter((source) => plan.kinds.includes(source.kind)).length >= plan.maxSources;
  const sourcesPaywall = usePaywall("sources", plan);

  const dead = sources.filter((source) => source.last_error);
  const silent = sources.filter(
    (source) => !source.last_error && (source.silent_days ?? 0) >= SILENT_DAYS,
  );
  /*
    Кандидаты на удаление. Ручной аудит подписок не делает никто: тридцать
    строк, у каждой числа в подсказке, и чтобы понять, кто здесь лишний,
    надо навести на все тридцать и сравнить в уме. Поэтому сравнение делает
    код, а строка называет, что именно не так с этим источником, — «дал 42,
    ни одного открытия» решается за секунду, «полезность источника низкая»
    не решается вовсе.
  */
  const cleanup = sources
    .map((source) => ({ source, why: cleanupOf(source, t.sources.cleanup) }))
    .filter((row): row is { source: SourceHealth; why: string } => row.why !== null);

  /**
   * Убрать источник — с отменой прямо в сообщении.
   *
   * Отмена возможна только потому, что удаление перестало удалять: раньше
   * каскад уносил материалы, чтения и записи в прошлых выпусках, и «отменить»
   * означало бы вернуть пустую строку вместо источника с историей — отказ,
   * выглядящий как успех.
   */
  const remove = (id: number) =>
    startTransition(async () => {
      const result = await deleteSource(id);
      // Через `in`, а не по `result.error`: у удачной ветки такого поля нет
      // вовсе, и проверка на его пустоту не сужает тип — имя источника
      // ниже оказывалось «строка или ничего».
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // Корзина, а не зелёная галочка: галочка говорит «получилось»,
      // и над строкой об убранном источнике читается как «добавлено».
      // Значок здесь называет само действие, а не его исход.
      toast.success(t.sources.toast.removed(result.label), {
        icon: <TrashIcon className="size-4" />,
        duration: 10_000,
        action: {
          label: t.sources.toast.undo,
          onClick: () => startTransition(() => void restoreSource(id)),
        },
      });
    });

  const parse = () =>
    startTransition(async () => {
      setFound(null);
      setError(null);
      const result = await discoverSource(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFound(result.found);
    });

  return (
    <div className="flex flex-col gap-6">
      {dead.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>{t.sources.banners.errorTitle(dead.length)}</AlertTitle>
          <AlertDescription>
            {/*
              Список обрезан: при полусотне сломанных источников склейка
              через точку превращала тревогу в абзац, который не читают.
              Остальные видны в списке, он теперь сортирован сломанным вверх.
            */}
            {listOf(dead.map((source) => `${source.label}: ${source.last_error}`), t.sources)}
          </AlertDescription>
        </Alert>
      ) : null}

      {silent.length > 0 ? (
        <Alert>
          <AlertTitle>{t.sources.banners.quietTitle(silent.length)}</AlertTitle>
          <AlertDescription>
            {listOf(
              silent.map(
                (source) => `${source.label} (${t.sources.banners.quietDays(source.silent_days ?? 0)})`,
              ),
              t.sources,
            )}{" "}
            — {t.sources.banners.quietExplain(SILENT_DAYS)}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        {found && plan.kinds.includes(found.kind) ? (
          <form
            action={(formData) =>
              startTransition(async () => {
                const result = await addSource(formData);
                if (result?.error) {
                  setError(result.error);
                  setFound(null);
                  return;
                }
                setError(null);
                setFound(null);
                setInput("");
                toast.success(
                  result?.created ? t.sources.toast.added : t.sources.toast.alreadyAdded,
                );
              })
            }
          >
            {/*
              Разобранный источник занимает место формы: решение здесь одно —
              тот ли это источник, — и поле ввода рядом предлагало бы два сразу.
              Название правится прямо в заголовке: отдельное поле под ним
              показывало то же самое второй раз.
            */}
            <CardHeader>
              {/*
                Значок стоит перед названием, как в любом списке: он отвечает
                на «что это», а название — на «что именно», и в обратном
                порядке читать приходится дважды.
              */}
              <div className="flex items-start gap-2.5">
                <SourceIcon kind={found.kind} url={found.url} className="mt-2.5 size-5" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Input
                    name="label"
                    defaultValue={found.label}
                    key={found.url}
                    aria-label={t.sources.found.nameLabel}
                    className="font-heading h-auto border-transparent bg-transparent px-2 py-1 text-2xl leading-tight font-semibold hover:border-input"
                  />
                  <CardDescription className="px-2">
                    {t.sources.found.stats(found.via, found.fresh, found.entries)}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <input type="hidden" name="kind" value={found.kind} />
              <input type="hidden" name="url" value={found.url} />
              <input type="hidden" name="input_url" value={found.input_url} />

              {/*
                Доказательство, что источник живой, стоит над кнопками:
                на него смотрят, чтобы решить, жать ли «Добавить», а после
                кнопок его уже никто не читает.
              */}
              <div className="flex flex-col gap-1">
                <a
                  href={found.sample_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm"
                >
                  <ExternalLinkIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{t.sources.found.lastEntry(found.sample)}</span>
                </a>
                {found.fresh === 0 ? (
                  <span className="text-muted-foreground text-xs">
                    {t.sources.found.stale}
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Button type="submit" disabled={pending}>
                  <PlusIcon data-icon="inline-start" />
                  {t.sources.found.add}
                </Button>
                {/*
                  Выход обязателен: без него разобранная не та ссылка запирает
                  карточку до перезагрузки страницы.
                */}
                <Button type="button" variant="ghost" onClick={() => setFound(null)}>
                  {t.sources.found.cancel}
                </Button>
              </div>
            </CardContent>
          </form>
        ) : (
          <>
            <CardHeader>
              <CardTitle>{t.sources.addForm.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field data-invalid={error ? true : undefined}>
                  <div className="flex gap-2">
                    <Input
                      id="input"
                      // Подписи над полем нет, а имя у него быть обязано:
                      // плейсхолдер исчезает при вводе и экранному диктору
                      // именем не служит.
                      aria-label={t.sources.addForm.linkLabel}
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          parse();
                        }
                      }}
                      placeholder={t.sources.addForm.placeholder}
                      aria-invalid={error ? true : undefined}
                    />
                    {/*
                      Кнопка называет то, зачем сюда пришли. «Разобрать»
                      описывало внутренний шаг и ничего не обещало: человек
                      не знает, доведёт ли оно до добавления.
                    */}
                    <Button
                      type="button"
                      onClick={full ? sourcesPaywall.open : parse}
                      // На пределе кнопка живёт и с пустым полем: разбирать
                      // нечего, а сказать есть что — и ждать, пока читатель
                      // наберёт ссылку, ради отказа значит взять плату
                      // за отказ временем.
                      disabled={pending || (!full && !input.trim())}
                    >
                      {full ? (
                        <CrownIcon data-icon="inline-start" className="text-amber-500" />
                      ) : (
                        <PlusIcon data-icon="inline-start" />
                      )}
                      {pending ? t.sources.addForm.checking : t.sources.addForm.add}
                    </Button>
                  </div>
                  {/*
                    Отказ и подсказка — разные вещи, и выглядеть одинаково
                    они не имеют права: серая строка на месте серой строки
                    читается как продолжение подсказки, а не как «не вышло».
                    FieldError к тому же объявляет себя role="alert",
                    и экранный диктор произносит отказ сам.
                  */}
                  {error ? (
                    <FieldError>{error}</FieldError>
                  ) : (
                    <FieldDescription>
                      {t.sources.addForm.hint}
                    </FieldDescription>
                  )}
                </Field>

                {found && !plan.kinds.includes(found.kind) ? (
                  <Alert>
                    <AlertTitle className="flex items-center gap-1.5">
                      {t.sources.paywall.xTitle(PLANS.pro.label)}
                      <PaywallCrown feature="x" plan={plan} />
                    </AlertTitle>
                    <AlertDescription>
                      {t.sources.paywall.xBody(found.label)}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </FieldGroup>
            </CardContent>
          </>
        )}
      </Card>

      {cleanup.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.sources.cleanup.title}</CardTitle>
            {/*
              Про то, что у соседа источник остаётся, здесь не сказано
              намеренно: это устройство каталога, а не ответ на вопрос
              читателя. Он не знает, что каталог общий, — и «убрать только
              у себя» задаёт ему вопрос вместо того, чтобы снять.
              Что убранное возвращается, говорит само сообщение после
              нажатия: там это и нужно, а не за минуту до.
            */}
            <CardDescription>{t.sources.cleanup.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {cleanup.map(({ source, why }, index) => (
              <div key={source.id}>
                {index > 0 ? <Separator className="my-1" /> : null}
                <div className="flex items-center gap-3 py-1.5">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <SourceIcon kind={source.kind} url={source.url} className="mt-0.5 size-4" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{source.label}</span>
                      {/*
                        Одни числа: «ты его не читаешь» над «20 показано,
                        0 открыто» — это одна и та же мысль дважды, и вторая
                        строка сильнее, потому что доказывает первую.
                      */}
                      <span className="text-muted-foreground text-xs">{why}</span>
                    </div>
                  </div>
                  {/*
                    Кнопка словом и без корзины: в списке ниже корзина стоит
                    у каждой строки и значит «убрать этот», а здесь решение
                    предложено нами — и предложение обязано называть себя.
                    Та же иконка рядом с тем же словом делает их одинаковыми
                    на глаз, то есть отменяет всю разницу.
                  */}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    // Имя источника в подписи: диктору две соседние кнопки
                    // «Убрать» без него — один и тот же вопрос без ответа,
                    // какую из них он читает.
                    aria-label={t.sources.cleanup.removeAria(source.label)}
                    // Красное под курсором — тот же знак, что у корзины
                    // в списке ниже: кнопка, которая что-то уносит, обязана
                    // краснеть в обоих местах одинаково, иначе в одном
                    // из них она выглядит безобидной.
                    className="hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => remove(source.id)}
                  >
                    {t.sources.cleanup.remove}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t.sources.list.title}</CardTitle>
          <CardDescription>
            {t.sources.list.count(sources.length, plan.maxSources, t.plans.label[plan.id])}
          </CardDescription>
          {/* Полоска под числом: «16 из 100» читается за секунду, а «сколько
              ещё осталось» — нет. Тот же приём, что у полос в «Калибровке».
              Заполненная до края говорит «предел», не дожидаясь отказа при
              добавлении. */}
          <div
            className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={plan.maxSources}
            aria-valuenow={Math.min(sources.length, plan.maxSources)}
            aria-label={t.sources.list.title}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${Math.min(100, Math.round((sources.length / plan.maxSources) * 100))}%` }}
            />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {sources.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t.sources.list.emptyTitle}</EmptyTitle>
                <EmptyDescription>
                  {t.sources.list.emptyDescription}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {sources.map((source, index) => (
            <div key={source.id}>
              {index > 0 ? <Separator className="my-1" /> : null}
              <div className="flex items-center gap-3 py-1.5">
                {/*
                  Переключателя нет: источник либо есть, либо его удалили.
                  Третье состояние требовало решения на каждой строке, а решений
                  здесь ровно два — завести и убрать.
                */}
                {/*
                  Значок держится строки названия, а не середины блока:
                  под названием ещё две служебные строки, и по центру всего
                  блока он оказывается напротив адреса, к которому отношения
                  не имеет.
                */}
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <SourceIcon kind={source.kind} url={source.url} className="mt-0.5 size-4" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{source.label}</span>
                    {/*
                      Адрес открывается в соседнем окне: увидеть, что за
                      источником, — обычное желание, а копировать ссылку
                      руками ради этого незачем.
                    */}
                    {openUrlOf(source) ? (
                      <a
                        href={openUrlOf(source)!}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {source.url}
                        {source.input_url && source.input_url !== source.url
                          ? ` ← ${source.input_url}`
                          : ""}
                      </a>
                    ) : (
                      <span className="truncate text-xs text-muted-foreground">
                        {source.url}
                        {source.input_url && source.input_url !== source.url
                          ? ` ← ${source.input_url}`
                          : ""}
                      </span>
                    )}
                    {troubleOf(source, t.sources) ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {troubleOf(source, t.sources)}
                      </span>
                    ) : null}
                  </div>
                </div>
                {/*
                  Одно число без подписи — загадка. Всплывающая подсказка
                  говорит, что оно значит, и заодно держит отдачу за тридцать
                  дней: в строке она стоит только у проблемных, а посмотреть
                  её иногда хочется у любого.
                */}
                {source.last_error ? (
                  // Своя подсказка вместо title — та же, что у всех иконок
                  // в приложении. Текст ошибки продублирован в предупреждении
                  // наверху страницы, поэтому наведение здесь — короткий путь,
                  // а не единственный.
                  <Tooltip>
                    <TooltipTrigger render={<Badge variant="destructive" className="cursor-help" />}>{t.sources.list.error}</TooltipTrigger>
                    <TooltipContent>{source.last_error}</TooltipContent>
                  </Tooltip>
                ) : (source.silent_days ?? 0) >= SILENT_DAYS ? (
                  <Tooltip>
                    <TooltipTrigger render={<Badge variant="destructive" className="cursor-help" />}>
                      {t.sources.list.quietBadge(source.silent_days ?? 0)}
                    </TooltipTrigger>
                    <TooltipContent>
                      {t.sources.list.quietTooltip(SILENT_DAYS)}
                    </TooltipContent>
                  </Tooltip>
                ) : source.last_count !== null ? (
                  // Одно число без подписи — загадка: рядом уже стоит отдача
                  // за тридцать дней, и какое из двух что значит, неоткуда
                  // узнать, кроме как навести. Подпись нужна и диктору:
                  // подсказка достаётся курсору, а он её не видит.
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Badge
                          variant="secondary"
                          className="cursor-help"
                          aria-label={t.sources.list.lastCountAria(source.last_count)}
                        />
                      }
                    >
                      {source.last_count}
                    </TooltipTrigger>
                    <TooltipContent>
                      {t.sources.list.lastCountTooltip(yieldOf(source, t.sources))}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t.sources.list.removeAria(source.label)}
                        onClick={() => startTransition(() => remove(source.id))}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      />
                    }
                  >
                    <TrashIcon />
                  </TooltipTrigger>
                  {/* Своя подсказка вместо title: браузерная выезжает через
                      секунду с лишним и рисуется системным шрифтом. */}
                  <TooltipContent>{t.sources.list.removeTooltip}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {sourcesPaywall.dialog}
    </div>
  );
}
