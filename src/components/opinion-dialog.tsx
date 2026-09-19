"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { takeOpinion, writeOpinion } from "@/lib/actions";
import { NETWORKS, overLimit, postLength, type NetworkId } from "@/lib/networks";
import type { SavedDraft } from "@/lib/posts";

/**
 * Готовый пост его голосом.
 *
 * Текст правится прямо здесь, и скопированное уходит в базу вместе с правкой:
 * разница между нашим черновиком и его версией — самый сильный сигнал о его
 * вкусе, и получить его больше негде. Отправки в сеть нет: постить за него
 * значило бы просить OAuth у четырёх платформ ради кнопки, которую он и так
 * жмёт сам. Ссылка «открыть» ведёт в окно публикации с подставленным текстом;
 * подставляют его не все, поэтому главное действие — «скопировать».
 *
 * Предупреждения стоят над текстом, а не под ним: он опубликует это под своим
 * именем, и выдуманное число надо увидеть до нажатия, а не после.
 */
export function OpinionDialog({
  itemId,
  title,
  url,
  networks,
  open,
  onOpenChange,
}: {
  itemId: number;
  title: string;
  url: string;
  networks: NetworkId[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Начальное состояние — «пишу», а не «жду»: мотатка монтируется в тот же
  // миг, когда её открыли, и открытие и есть просьба написать. Лишний шаг
  // «теперь напиши» был бы вторым нажатием за те же деньги.
  const [state, setState] = useState<
    | { kind: "writing" }
    | { kind: "failed"; error: string }
    | { kind: "ready"; drafts: SavedDraft[]; hook: string; added: string[]; fallback: boolean }
  >({ kind: "writing" });
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [variant, setVariant] = useState("1");
  const [copied, setCopied] = useState<number | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // Один запрос на монтирование: ref, а не состояние, — иначе повторный
  // рендер мотатки заказал бы второй пост за те же деньги.
  const asked = useRef(false);
  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    void (async () => {
      const result = await writeOpinion(itemId);
      setState(
        "error" in result
          ? { kind: "failed", error: result.error }
          : {
              kind: "ready",
              drafts: result.drafts,
              hook: result.hook,
              added: result.added,
              fallback: result.fallback,
            },
      );
    })();
  }, [open, itemId]);

  const tabs = networks.filter((id) => NETWORKS[id]);
  const draftsOf = (network: NetworkId) =>
    state.kind === "ready" ? state.drafts.filter((draft) => draft.network === network) : [];

  const copy = async (draft: SavedDraft, text: string) => {
    // Отметка ставится на нажатие, а не на удачный доступ к буферу: выбор
    // варианта и его правка — единственный сигнал о вкусе автора, и терять
    // его из-за того, что браузер не дал доступ к буферу, значит терять
    // ровно то, ради чего всё это хранится. Отметка — про намерение,
    // а буфер — про механику.
    void takeOpinion(draft.id, text);
    setCopied(draft.id);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Скопировано");
    } catch {
      // Выделяем сами: «скопируй руками» без выделенного текста — это
      // предложение сделать работу за нас.
      field.current?.select();
      toast.warning("Браузер не дал доступ к буферу", {
        description: "Текст выделен — нажми ⌘C",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Своё мнение</DialogTitle>
          <DialogDescription className="line-clamp-2">{title}</DialogDescription>
          {/* Каким приёмом открыт пост — видно до чтения: не понравился вход,
              второй вариант заходит иначе, и это его выбор, а не догадка. */}
          {state.kind === "ready" && state.hook ? (
            <span className="text-xs text-muted-foreground">Вход: {state.hook}</span>
          ) : null}
        </DialogHeader>

        {state.kind === "writing" ? (
          <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Spinner />
            Пишу твоим голосом — это занимает несколько секунд
          </div>
        ) : null}

        {state.kind === "failed" ? (
          <Alert variant="destructive">
            <AlertTitle>Не написалось</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        {state.kind === "ready" ? (
          <div className="flex flex-col gap-3">
            {state.fallback ? (
              <Alert>
                <AlertTitle>Голос ещё не собран</AlertTitle>
                <AlertDescription>
                  Это написано твоими настройками подачи, а не твоим голосом. Добавь
                  канал в «Моих площадках» и собери голос — посты станут твоими.
                </AlertDescription>
              </Alert>
            ) : null}

            {state.added.length ? (
              <Alert variant="destructive">
                <AlertTitle>Проверь перед публикацией</AlertTitle>
                <AlertDescription>
                  Добавлено сверх материала:
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {state.added.map((line) => (
                      <li key={line}>— {line}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            <Tabs defaultValue={tabs[0]}>
              <div className="flex items-center justify-between gap-3">
                <TabsList variant="line" className="h-auto p-0">
                  {tabs.map((id) => (
                    <TabsTrigger key={id} value={id}>
                      {NETWORKS[id].label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {/* Вариантов два, и отличаются они первой строкой. Какой он
                    выберет — единственный сигнал о его вкусе, который ничего
                    не стоит, поэтому переключатель стоит на виду. */}
                <ToggleGroup
                  value={[variant]}
                  onValueChange={(value) => setVariant(String(value[0] ?? "1"))}
                  className="shrink-0"
                >
                  <ToggleGroupItem value="1" aria-label="Первый вариант">1</ToggleGroupItem>
                  <ToggleGroupItem value="2" aria-label="Второй вариант">2</ToggleGroupItem>
                </ToggleGroup>
              </div>

              {tabs.map((id) => {
                const network = NETWORKS[id];
                const drafts = draftsOf(id);
                const draft =
                  drafts.find((entry) => String(entry.variant) === variant) ?? drafts[0];
                if (!draft) {
                  return (
                    <TabsContent key={id} value={id}>
                      <p className="py-6 text-sm text-muted-foreground">
                        Для этой сети модель ничего не дала — попробуй ещё раз.
                      </p>
                    </TabsContent>
                  );
                }
                const text = edited[draft.id] ?? draft.text;
                const length = postLength(network, text);
                const over = overLimit(network, text);

                return (
                  <TabsContent key={id} value={id} className="flex flex-col gap-2 pt-3">
                    {draft.unverified.length ? (
                      <Alert variant="destructive">
                        <AlertTitle>Числа, которых нет в материале</AlertTitle>
                        <AlertDescription>
                          {draft.unverified.join(", ")} — проверь по источнику или убери.
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    <Textarea
                      ref={field}
                      value={text}
                      rows={network.limit > 500 ? 12 : 7}
                      onChange={(event) =>
                        setEdited((all) => ({ ...all, [draft.id]: event.target.value }))
                      }
                      className="font-normal leading-relaxed"
                    />

                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          over ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {length} из {network.limit}
                        {network.id === "x" ? " (ссылка считается за 23)" : ""}
                      </span>
                      <div className="flex items-center gap-2">
                        {network.intent ? (
                          <Button
                            variant="outline"
                            size="sm"
                            render={
                              <a
                                href={network.intent(text, url)}
                                target="_blank"
                                rel="noreferrer noopener"
                              />
                            }
                          >
                            <ExternalLinkIcon />
                            Открыть в {network.label}
                          </Button>
                        ) : null}
                        <Button size="sm" onClick={() => copy(draft, text)}>
                          {copied === draft.id ? <CheckIcon /> : <CopyIcon />}
                          Скопировать
                        </Button>
                      </div>
                    </div>
                  </TabsContent>
                );
              })}
            </Tabs>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
