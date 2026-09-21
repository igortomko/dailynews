"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { savePersonalization } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  COMPLEXITY, LANGUAGES, DEFAULT_COMPLEXITY, DEFAULT_STYLE, STYLES,
  complexityAt, flagOf, SOURCE_LANGUAGE,
} from "@/lib/voice";
import type { Reader } from "@/lib/types";
import { FEATURES, type Plan } from "@/lib/plans";
import { PaywallCrown, usePaywall } from "@/components/paywall";
import { flushRebuild, queueRebuild } from "@/components/rebuild-queue";
import { useSettingsSave } from "@/components/settings-save";

/** Флажок и название одной строкой: в поле и в списке это одно и то же. */
const languageOption = (entry: string) => (
  <span className="flex min-w-0 items-center gap-2">
    <span aria-hidden="true">{flagOf(entry)}</span>
    {/* Поле у́же самого длинного языка, и «португальском (бразильский
        вариант)» вылезал бы за него: обрезаем с многоточием. В списке
        обрезать нечего — он расходится по содержимому. */}
    <span className="truncate">{entry}</span>
  </span>
);

export function PersonalizationForm({ profile, plan }: { profile: Reader; plan: Plan }) {
  // Перевод — платная возможность: на бесплатном выпуск остаётся на языке
  // источника. Селект показывается целиком и погашенным, а не прячется:
  // по нему видно, что именно даёт переход.
  const translates = FEATURES.language.has(plan);
  const languagePaywall = usePaywall("language", plan);
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const first = !profile?.onboarded_at;

  const [complexity, setComplexity] = useState(profile?.complexity ?? DEFAULT_COMPLEXITY);
  const [style, setStyle] = useState(profile?.style ?? DEFAULT_STYLE);
  const [language, setLanguage] = useState(profile?.language ?? "русском");

  // Каким голосом написан сегодняшний выпуск. Сравниваем с ним, а не с прошлым
  // сохранением: покрутить ползунок туда-обратно — не изменение, и платить
  // за пересборку в этом случае не за что.
  const written = useRef({
    language: profile?.language ?? "русском",
    complexity: profile?.complexity ?? DEFAULT_COMPLEXITY,
    style: profile?.style ?? DEFAULT_STYLE,
    reader_context: profile?.reader_context ?? "",
  });

  /**
   * Запись. Промисом, а не колбэком: её ждут двое — кнопка и окно
   * «сохранить перед уходом», и второму нужен исход, чтобы решить,
   * уходить ли.
   */
  const write = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        const node = form.current;
        if (!node) return resolve(false);
        const data = new FormData(node);
        startTransition(async () => {
          try {
            await savePersonalization(data);
          } catch {
            // Провал записи обязан сказать о себе: молча погашенная кнопка
            // читается как «сохранено», а в базе прежнее.
            toast.error("Не удалось сохранить. Попробуй ещё раз");
            return resolve(false);
          }

          // Язык, сложность, манера и «кто читает» уезжают в промпт дайджеста:
          // выпуск, написанный прежними, новой настройке не соответствует.
          // Сама пересборка отсюда не запускается — её решает тот, кто
          // позвал запись.
          const now = {
            language: String(data.get("language") ?? ""),
            complexity: Number(data.get("complexity")),
            style: String(data.get("style") ?? ""),
            reader_context: String(data.get("reader_context") ?? ""),
          };
          if (
            now.language !== written.current.language ||
            now.complexity !== written.current.complexity ||
            now.style !== written.current.style ||
            now.reader_context !== written.current.reader_context
          ) {
            // Запоминаем сразу: второе сохранение без правок не должно
            // оплачивать переписывание того же текста тем же голосом.
            written.current = now;
            queueRebuild("voice");
          }
          resolve(true);
        });
      }),
    [],
  );

  /** Переписать сегодняшний выпуск новым голосом, не дожидаясь полуночи. */
  const rebuild = useCallback(() => flushRebuild(() => router.refresh()), [router]);

  const { dirty, applying, touch, apply } = useSettingsSave(write, rebuild);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{first ? "Настрой ленту" : "Язык и подача"}</CardTitle>
        <CardDescription>
          {first
            ? "Скажи, на каком языке и как писать новости. Интересы выберешь следующим шагом."
            : // Не «как мы подбираем»: отбор здесь ни при чём, он идёт
              // по интересам и оценкам, общим для всех. Обещать на этом
              // экране влияние на подбор значит обещать то, чего нет.
              "На каком языке и как написан твой выпуск. О чём он, выбираешь в «Интересах»."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={form} onChange={touch} onSubmit={(event) => event.preventDefault()}>
          {/* Сколько новостей в день — в «Интересах», рядом с полосой, где
              это число делится между темами: там оно одно решение, а не два.
              Здесь остаётся только то, как текст написан и для кого. */}
          <FieldGroup>
            <Field>
              {/* «На каком языке», а не «Язык»: в списке лежит предложный
                  падеж — форма, которая уезжает в промпт как есть, — и над
                  «русском» заголовок в именительном не сходится ни с одним
                  пунктом. */}
              <FieldLabel htmlFor="language" className="flex items-center gap-1.5">
                На каком языке
                {translates ? null : <PaywallCrown feature="language" plan={plan} />}
              </FieldLabel>
              {/* Список из пятнадцати, а колонка осталась свободным текстом:
                  миграция 0014 убрала список из трёх ровно потому, что его
                  выбирал автор формы. Сохранённое значение вне списка
                  остаётся выбранным, а не подменяется первым пунктом. */}
              <Select
                value={translates ? language : SOURCE_LANGUAGE}
                onValueChange={(value: string | null) => {
                  if (!value) return;
                  if (!translates) {
                    languagePaywall.open();
                    return;
                  }
                  setLanguage(value);
                  touch();
                }}
              >
                {/* Не disabled: выключенный селект не ловит нажатие, и окно
                    с предложением тарифа, которое открывает onValueChange,
                    не открывалось никогда — ветка была мёртвой. Корона
                    у подписи говорит, что раздел платный, а выбор языка
                    показывает, за что именно платить. Значение при этом
                    не меняется: окно открывается вместо него. */}
                <SelectTrigger id="language" className="w-full max-w-xs">
                  <SelectValue>{languageOption(language)}</SelectValue>
                </SelectTrigger>
                {/* Обычный выпадающий список, а не список, подтянутый выбранным
                    пунктом к полю: на шестнадцати языках он растягивался
                    на весь экран и закрывал карточку целиком. Высота ограничена,
                    остальное прокручивается. Ширина по содержимому, но не у́же
                    поля: список наследует ширину поля, а поле стало коротким —
                    иначе длинные языки обрезались бы и в самом списке, где
                    их и выбирают. */}
                <SelectContent
                  alignItemWithTrigger={false}
                  className="max-h-72 w-auto min-w-(--anchor-width)"
                >
                  {(LANGUAGES.includes(language) ? LANGUAGES : [language, ...LANGUAGES]).map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {languageOption(entry)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                type="hidden"
                name="language"
                value={translates ? language : SOURCE_LANGUAGE}
              />
              {languagePaywall.dialog}
              <FieldDescription>
                {translates
                  ? "Источники остаются на своих языках, мы переводим и адаптируем."
                  : "Выпуск приходит на языке источника. Перевод есть на «Plus» и «Pro»."}
              </FieldDescription>
            </Field>

            {/* Пять делений названы словами, а не номером на ползунке:
                «3 из 5» не говорит ничего о том, каким станет текст, и выбрать
                по нему можно только наугад. Скрытое поле держит значение
                для FormData — группа меняется мимо события формы. */}
            <Field>
              <FieldLabel>Сложность языка</FieldLabel>
              <ToggleGroup
                aria-label="Сложность языка"
                value={[String(complexity)]}
                onValueChange={(value: string[]) => {
                  if (!value[0]) return;
                  setComplexity(Number(value[0]));
                  touch();
                }}
                variant="outline"
                className="grid w-full grid-cols-2 items-stretch sm:grid-cols-5"
              >
                {COMPLEXITY.map((entry) => (
                  <ToggleGroupItem
                    key={entry.key}
                    value={entry.key}
                    className="h-auto min-h-9 min-w-0 px-2 py-1.5 text-center leading-tight whitespace-normal"
                  >
                    {entry.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <input type="hidden" name="complexity" value={complexity} />
              <FieldDescription>{complexityAt(complexity).hint}</FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Манера подачи</FieldLabel>
              {/* Четыре варианта видны сразу и выделяются так же, как деления
                  сложности над ними: разная заливка у двух соседних групп
                  читается как два разных элемента, и выбранное в одной
                  перестаёт быть похоже на выбранное в другой. */}
              <ToggleGroup
                aria-label="Манера подачи"
                value={[style]}
                onValueChange={(value: string[]) => {
                  if (!value[0]) return;
                  setStyle(value[0]);
                  touch();
                }}
                variant="outline"
                className="grid w-full grid-cols-1 items-stretch sm:grid-cols-2 lg:grid-cols-4"
              >
                {STYLES.map((entry) => (
                  <ToggleGroupItem
                    key={entry.key}
                    value={entry.key}
                    className="h-auto flex-col items-start justify-start gap-1 p-3 text-left whitespace-normal"
                  >
                    <span className="font-medium">{entry.label}</span>
                    <span className="text-xs leading-snug font-normal text-muted-foreground">
                      {entry.hint}
                    </span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <input type="hidden" name="style" value={style} />
            </Field>

            <Field>
              <FieldLabel htmlFor="reader_context">О себе и что важно</FieldLabel>
              <Textarea
                id="reader_context"
                name="reader_context"
                rows={4}
                defaultValue={profile?.reader_context ?? ""}
                placeholder="Чем занимаешься, что за продукт, где живёшь и какие новости тебе особенно интересны"
              />
              {/* Про отбор здесь не обещаем: эта строка уходит только в промпт
                  описаний. Зато от неё зависит связь с читателем, самая слабая
                  ось в измерении качества. */}
              <FieldDescription>
                Чем подробнее напишешь, тем точнее объясним, чем новость важна тебе.
              </FieldDescription>
            </Field>

            {/* В онбординге кнопка не сохраняет, а заканчивает настройку
                и уводит дальше: выпуска, который надо пересобирать, ещё нет. */}
            {first ? (
              <Button
                type="button"
                // Своя занятость, а не `applying`: его зажигает «Сохранить»,
                // а эта кнопка зовёт запись напрямую — и без признака работы
                // двойное нажатие уходило дважды.
                disabled={pending}
                className="self-start"
                onClick={async () => {
                  // Уходим только после записи: раньше переход шёл вместе
                  // с ней, и отказ записи уносил настройку молча. Пересборки
                  // здесь нет и не нужно — выпуска ещё не существует.
                  if (!(await write())) return;
                  // У блогера настройка на шаг длиннее: голос собирается
                  // с его каналов, и просить их потом — значит получить
                  // первый пост, написанный ничьим голосом.
                  router.push(FEATURES.posts.has(plan) ? "/settings/channels?first=1" : "/");
                }}
              >
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {FEATURES.posts.has(plan) ? "Дальше: мои площадки" : "Готово"}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={applying || !dirty}
                // Заметно крупнее остальных кнопок экрана: это единственное
                // действие, ради которого сюда пришли, а в ряду одинаковых
                // оно читалось как ещё одна настройка.
                className="h-11 self-start px-6 text-base"
                onClick={apply}
              >
                {applying ? <Spinner data-icon="inline-start" /> : null}
                Сохранить
              </Button>
            )}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
