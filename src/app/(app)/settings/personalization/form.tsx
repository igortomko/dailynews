"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePersonalization } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
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
import { LANGUAGES, DEFAULT_COMPLEXITY, DEFAULT_STYLE, STYLES, complexityAt, styleOf, SOURCE_LANGUAGE } from "@/lib/voice";
import type { Reader } from "@/lib/types";
import { FEATURES, type Plan } from "@/lib/plans";
import { PaywallCrown, usePaywall } from "@/components/paywall";

export function PersonalizationForm({ profile, plan }: { profile: Reader; plan: Plan }) {
  // Перевод — платная возможность: на бесплатном выпуск остаётся на языке
  // источника. Селект показывается целиком и погашенным, а не прячется:
  // по нему видно, что именно даёт переход.
  const translates = FEATURES.language.has(plan);
  const languagePaywall = usePaywall("language", plan);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();
  const first = !profile?.onboarded_at;

  const [complexity, setComplexity] = useState(profile?.complexity ?? DEFAULT_COMPLEXITY);
  const [style, setStyle] = useState(profile?.style ?? DEFAULT_STYLE);
  const [language, setLanguage] = useState(profile?.language ?? "русском");

  const save = () => {
    const node = form.current;
    if (!node) return;
    startTransition(async () => {
      await savePersonalization(new FormData(node));
      setSaved(true);
    });
  };

  // Сохраняем сами, с паузой после последней правки: кнопка заставляет
  // помнить, что изменения не применены, и наказывает за уход со страницы.
  // Пауза нужна, чтобы не слать запрос на каждую букву в текстовом поле.
  const schedule = () => {
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
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
          {first ? "Настрой ленту" : "Персонализация"}
          <span
            aria-live="polite"
            className="flex items-center gap-1 text-xs font-normal text-muted-foreground"
          >
            {pending ? "сохраняю…" : saved ? (<><CheckIcon className="size-3" />сохранено</>) : null}
          </span>
        </CardTitle>
        {first ? (
          <CardDescription>
            По этим направлениям будут собираться новости, и по ним же раскладываться вкладки.
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <form ref={form} onChange={schedule} onSubmit={(event) => event.preventDefault()}>
          {/* Сколько новостей в день — в «Интересах», рядом с полосой, где
              это число делится между темами: там оно одно решение, а не два.
              Здесь остаётся только то, как текст написан и для кого. */}
          <FieldGroup>
            {/* Язык и сложность — одно решение «как это будет написано»,
                поэтому стоят в строку. На узком экране колонки схлопываются
                сами: две трёхсотпиксельные колонки на телефоне нечитаемы. */}
            <div className="grid gap-5 @md/field-group:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="language" className="flex items-center gap-1.5">
                  Язык
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
                    schedule();
                  }}
                >
                  {/* Не disabled: выключенный селект не ловит нажатие, и окно
                      с предложением тарифа, которое открывает onValueChange,
                      не открывалось никогда — ветка была мёртвой. Корона
                      у подписи говорит, что раздел платный, а выбор языка
                      показывает, за что именно платить. Значение при этом
                      не меняется: окно открывается вместо него. */}
                  <SelectTrigger id="language" className="w-full">
                    <SelectValue>{language}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(LANGUAGES.includes(language) ? LANGUAGES : [language, ...LANGUAGES]).map((entry) => (
                      <SelectItem key={entry} value={entry}>
                        {entry}
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
                    ? "Источники остаются на своих языках."
                    : "Выпуск приходит на языке источника — перевод есть на «Plus» и «Pro»."}
                </FieldDescription>
              </Field>

              {/* Ползунок и селект меняются мимо события формы: базовый компонент
                  не шлёт change с настоящего поля, поэтому о правке сообщаем сами.
                  Скрытое поле держит значение для FormData. */}
              <Field>
                <FieldLabel htmlFor="complexity">Сложность языка</FieldLabel>
                <div className="flex h-8 items-center">
                  <Slider
                    id="complexity"
                    min={1}
                    max={5}
                    step={1}
                    // Массивом, а не числом: обёртка рисует по ползунку на элемент,
                    // и на скаляре откатывается к [min, max] — два ползунка вместо
                    // одного, причём поле при этом продолжает сохраняться.
                    value={[complexity]}
                    onValueChange={(value) => {
                      setComplexity(Array.isArray(value) ? value[0] : value);
                      schedule();
                    }}
                    aria-label="Сложность языка"
                  />
                </div>
                <input type="hidden" name="complexity" value={complexity} />
                <FieldDescription>{complexityAt(complexity).hint}</FieldDescription>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="style">Манера</FieldLabel>
              {/* Четыре варианта видны сразу: за списком они прячутся по одному,
                  и выбрать манеру нельзя, не открыв его и не сравнив. */}
              <ToggleGroup
                value={[style]}
                onValueChange={(value: string[]) => {
                  if (!value[0]) return;
                  setStyle(value[0]);
                  schedule();
                }}
                variant="outline"
                className="flex-wrap"
              >
                {STYLES.map((entry) => (
                  <ToggleGroupItem key={entry.key} value={entry.key}>
                    {entry.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <input type="hidden" name="style" value={style} />
              <FieldDescription>{styleOf(style).hint}</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="reader_context">Кто читает</FieldLabel>
              <Textarea
                id="reader_context"
                name="reader_context"
                rows={5}
                defaultValue={profile?.reader_context ?? ""}
                placeholder="Чем занимаешься, какой стек, что за продукт, где живёшь"
              />
              <FieldDescription>
                Расскажите о себе, это влияет на саммари и отбор новостей под ваши интересы.
              </FieldDescription>
            </Field>

            {/* Кнопка остаётся только в онбординге: там она не сохраняет,
                а заканчивает настройку и уводит в ленту. */}
            {first ? (
              <Button
                type="button"
                disabled={pending}
                className="self-start"
                onClick={() => {
                  clearTimeout(timer.current);
                  save();
                  router.push("/");
                }}
              >
                Готово
              </Button>
            ) : null}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
