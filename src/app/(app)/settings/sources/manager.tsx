"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { TrashIcon, PlusIcon, ExternalLinkIcon, GlobeIcon } from "lucide-react";
import { addSource, deleteSource, discoverSource, restoreSource } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Field, FieldDescription, FieldGroup } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { Source } from "@/lib/types";
import type { SourceHealth } from "@/lib/queries";
import type { Plan } from "@/lib/plans";
import { PaywallCrown } from "@/components/paywall";
import type { Found } from "../../../../../pipeline/discover";

/**
 * Значок источника: Telegram своим знаком, остальные — своим favicon.
 *
 * Favicon берётся с домена самого источника, а не через чужой сервис вроде
 * s2/favicons: иначе список того, что читает человек, уезжает третьей стороне
 * просто ради картинок.
 */
function faviconOf(kind: Source["kind"], url: string): string | null {
  const host =
    kind === "hackernews" ? "news.ycombinator.com"
    : kind === "x" ? "x.com"
    : kind === "reddit" ? "www.reddit.com"
    : kind === "email" ? url.split("@")[1]
    : (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return null;
        }
      })();
  return host ? `https://${host}/favicon.ico` : null;
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

/**
 * Значок с запасным вариантом: favicon лежит по /favicon.ico далеко не
 * у всех, и битая картинка вместо значка хуже отсутствия значка.
 */
function SourceIcon({
  kind,
  url,
  className = "size-4",
}: { kind: Source["kind"]; url: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (kind === "telegram") return <TelegramIcon className={className} />;
  const src = faviconOf(kind, url);
  if (!src || failed) return <GlobeIcon className={`${className} text-muted-foreground`} />;
  return (
    // Ленивая загрузка не украшение: значок — это запрос к чужому домену,
    // по одному на строку. На семнадцати источниках это семнадцать
    // рукопожатий TLS при каждом показе страницы, от 0,1 до 1,3 секунды
    // каждое, и три из них впустую — favicon.ico есть не у всех. С lazy
    // грузятся только те строки, до которых долистали.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      width={16}
      height={16}
      className={`${className} shrink-0 rounded-sm`}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Перечисление, которое не растёт бесконечно.
 *
 * Тревога со склеенными именами полусотни источников — это абзац, который
 * не читают, то есть тревога, переставшая работать. Первые три называются,
 * остальные считаются: список рядом всё равно сортирован сломанным вверх.
 */
function listOf(names: string[], limit = 3): string {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} и ещё ${names.length - limit}`;
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
 * Отдача источника за тридцать дней. Само по себе «дал 124 материала» ничего
 * не значит: важно, сколько из них дошло до выпусков и не перепечатки ли это.
 */
function yieldOf(source: SourceHealth): string {
  // Прогон его ещё не видел: ни удачи, ни ошибки. Написать такому «за 30 дней
  // ни одного материала» — той же фразой, что и заброшенному, — значит
  // сообщить, что он бесполезен, через минуту после того, как его завели.
  if (!source.last_ok_at && !source.last_error) return "добавлен — первый сбор в ближайшем прогоне";
  if (source.items === 0) return "за 30 дней — ни одного материала";
  const parts = [`за 30 дней: ${source.items} → ${source.in_digest} в выпусках`];
  if (source.mean_score !== null) parts.push(`скор ${source.mean_score}`);
  if (source.duplicates > 0) {
    parts.push(`дублей ${Math.round((source.duplicates / source.items) * 100)}%`);
  }
  return parts.join(" · ");
}

/**
 * Каталог общий на всех читателей, поэтому правит его владелец: удаление
 * источника уносит каскадом собранные материалы, и у такой кнопки не должно
 * быть ста рук. Остальным он виден целиком — знать, откуда берётся лента,
 * полезно и без права её менять.
 */
export function SourcesManager({
  sources,
  plan,
  editable,
}: { sources: SourceHealth[]; plan: Plan; editable: boolean }) {
  const [pending, startTransition] = useTransition();
  const [input, setInput] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dead = sources.filter((source) => source.last_error);
  const silent = sources.filter(
    (source) => !source.last_error && (source.silent_days ?? 0) >= SILENT_DAYS,
  );

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
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.label} убран из ленты`, {
        duration: 10_000,
        action: {
          label: "Отменить",
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
          <AlertTitle>Источники с ошибкой: {dead.length}</AlertTitle>
          <AlertDescription>
            {/*
              Список обрезан: при полусотне сломанных источников склейка
              через точку превращала тревогу в абзац, который не читают.
              Остальные видны в списке — он теперь сортирован сломанным вверх.
            */}
            {listOf(dead.map((source) => `${source.label}: ${source.last_error}`))}
          </AlertDescription>
        </Alert>
      ) : null}

      {silent.length > 0 ? (
        <Alert>
          <AlertTitle>Отвечают, но молчат: {silent.length}</AlertTitle>
          <AlertDescription>
            {listOf(silent.map((source) => `${source.label} (${source.silent_days} дн.)`))} —
            источник жив и отвечает, но {SILENT_DAYS} дней подряд не даёт ни одного свежего
            материала. Обычно это значит, что его забросили.
          </AlertDescription>
        </Alert>
      ) : null}

      {editable ? (
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
                  result?.created ? "Источник добавлен" : "Этот источник уже был в списке",
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
                    aria-label="Название источника"
                    className="font-heading h-auto border-transparent bg-transparent px-2 py-1 text-2xl leading-tight font-semibold hover:border-input"
                  />
                  <CardDescription className="px-2">
                    {found.via} · свежих {found.fresh} из {found.entries}
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
                  <span className="truncate">последняя запись: {found.sample}</span>
                </a>
                {found.fresh === 0 ? (
                  <span className="text-muted-foreground text-xs">
                    Записи есть, но ни одной за окно свежести — источник, похоже, заброшен.
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Button type="submit" disabled={pending}>
                  <PlusIcon data-icon="inline-start" />
                  Добавить
                </Button>
                {/*
                  Выход обязателен: без него разобранная не та ссылка запирает
                  карточку до перезагрузки страницы.
                */}
                <Button type="button" variant="ghost" onClick={() => setFound(null)}>
                  Отмена
                </Button>
              </div>
            </CardContent>
          </form>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Добавить источник</CardTitle>
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
                      aria-label="Ссылка на источник"
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          parse();
                        }
                      }}
                      placeholder="https://www.youtube.com/@канал"
                      aria-invalid={error ? true : undefined}
                    />
                    {/*
                      Кнопка называет то, зачем сюда пришли. «Разобрать»
                      описывало внутренний шаг и ничего не обещало: человек
                      не знает, доведёт ли оно до добавления.
                    */}
                    <Button type="button" onClick={parse} disabled={pending || !input.trim()}>
                      <PlusIcon data-icon="inline-start" />
                      {pending ? "Проверяю…" : "Добавить"}
                    </Button>
                  </div>
                  <FieldDescription>
                    {error ??
                      "Поддерживается: новостные сайты, блоги, YouTube, GitHub, " +
                        "открытый Telegram-канал и т. д."}
                  </FieldDescription>
                </Field>

                {found && !plan.kinds.includes(found.kind) ? (
                  <Alert>
                    <AlertTitle className="flex items-center gap-1.5">
                      Посты из X — на платном тарифе
                      <PaywallCrown feature="x" plan={plan} />
                    </AlertTitle>
                    <AlertDescription>
                      Ссылка разобралась: {found.label}. Твиты попадают в выпуск наравне
                      с новостями сайтов, но X берёт за доступ отдельно.
                    </AlertDescription>
                  </Alert>
                ) : null}
              </FieldGroup>
            </CardContent>
          </>
        )}
      </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Источники</CardTitle>
          <CardDescription>
            {sources.length} опрашивается · предел тарифа «{plan.label}» — {plan.maxSources}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {sources.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Пока ни одного источника</EmptyTitle>
                <EmptyDescription>
                  {editable
                    ? "Вставь ссылку выше — на блог, канал, репозиторий. Пока источников нет, выпуск собирать не из чего."
                    : "Каталог наполняет владелец ленты."}
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
                    <span className="truncate text-xs text-muted-foreground">
                      {source.url}
                      {source.input_url && source.input_url !== source.url
                        ? ` ← ${source.input_url}`
                        : ""}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{yieldOf(source)}</span>
                  </div>
                </div>
                {source.last_error ? (
                  // Своя подсказка вместо title — та же, что у всех иконок
                  // в приложении. Текст ошибки продублирован в предупреждении
                  // наверху страницы, поэтому наведение здесь — короткий путь,
                  // а не единственный.
                  <Tooltip>
                    <TooltipTrigger render={<Badge variant="destructive" />}>ошибка</TooltipTrigger>
                    <TooltipContent>{source.last_error}</TooltipContent>
                  </Tooltip>
                ) : (source.silent_days ?? 0) >= SILENT_DAYS ? (
                  <Badge variant="destructive">молчит {source.silent_days} дн.</Badge>
                ) : source.last_count !== null ? (
                  // Одно число без подписи — загадка: рядом уже стоит отдача
                  // за тридцать дней, и какое из двух что значит, неоткуда
                  // узнать, кроме как навести.
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Badge
                          variant="secondary"
                          aria-label={`Последний прогон дал ${source.last_count} свежих материалов`}
                        />
                      }
                    >
                      {source.last_count}
                    </TooltipTrigger>
                    <TooltipContent>Столько свежих материалов дал последний прогон</TooltipContent>
                  </Tooltip>
                ) : null}
                {editable ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Убрать ${source.label} из ленты`}
                          onClick={() => startTransition(() => remove(source.id))}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        />
                      }
                    >
                      <TrashIcon />
                    </TooltipTrigger>
                    {/* Своя подсказка вместо title: браузерная выезжает через
                        секунду с лишним и рисуется системным шрифтом. */}
                    <TooltipContent>
                      Убрать из ленты — материалы и статистика останутся, действие можно отменить
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
