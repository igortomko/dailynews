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
import { weakSpots } from "@/lib/post-levers";
import { takeOpinion, writeOpinion } from "@/lib/actions";
import { NETWORKS, overLimit, postLength, type NetworkId } from "@/lib/networks";
import { useT } from "@/components/i18n-provider";
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
  const t = useT();

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
      toast.success(t.onboarding.opinionDialog.copied);
    } catch {
      // Выделяем сами: «скопируй руками» без выделенного текста — это
      // предложение сделать работу за нас.
      field.current?.select();
      toast.warning(t.onboarding.opinionDialog.clipboardDenied, {
        description: t.onboarding.opinionDialog.clipboardDeniedDescription,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.onboarding.opinionDialog.title}</DialogTitle>
          <DialogDescription className="line-clamp-2">{title}</DialogDescription>
          {/* Каким приёмом открыт пост — видно до чтения: не понравился вход,
              второй вариант заходит иначе, и это его выбор, а не догадка. */}
          {state.kind === "ready" && state.hook ? (
            <span className="text-xs text-muted-foreground">{t.onboarding.opinionDialog.hook(state.hook)}</span>
          ) : null}
        </DialogHeader>

        {state.kind === "writing" ? (
          <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Spinner />
            {t.onboarding.opinionDialog.writing}
          </div>
        ) : null}

        {state.kind === "failed" ? (
          <Alert variant="destructive">
            <AlertTitle>{t.onboarding.opinionDialog.failedTitle}</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        {state.kind === "ready" ? (
          <div className="flex flex-col gap-3">
            {state.fallback ? (
              <Alert>
                <AlertTitle>{t.onboarding.opinionDialog.voiceNotBuiltTitle}</AlertTitle>
                <AlertDescription>{t.onboarding.opinionDialog.voiceNotBuiltDescription}</AlertDescription>
              </Alert>
            ) : null}

            {state.added.length ? (
              <Alert variant="destructive">
                <AlertTitle>{t.onboarding.opinionDialog.checkBeforePublishTitle}</AlertTitle>
                <AlertDescription>
                  {t.onboarding.opinionDialog.addedBeyondSource}
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
                      {t.onboarding.networks[id]}
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
                  <ToggleGroupItem value="1" aria-label={t.onboarding.opinionDialog.variant1}>1</ToggleGroupItem>
                  <ToggleGroupItem value="2" aria-label={t.onboarding.opinionDialog.variant2}>2</ToggleGroupItem>
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
                        {t.onboarding.opinionDialog.noDraftForNetwork}
                      </p>
                    </TabsContent>
                  );
                }
                const text = edited[draft.id] ?? draft.text;
                const length = postLength(network, text);
                const over = overLimit(network, text);
                // По тексту в поле, а не по пришедшему черновику: поправил
                // первую строку — подсказка про неё гаснет сразу.
                const weak = weakSpots(id, text);

                return (
                  <TabsContent key={id} value={id} className="flex flex-col gap-2 pt-3">
                    {/* Какой рычаг — вслух: иначе второй вариант читается
                        просто «другим», а выбор между ними ничему не учит
                        ни его, ни отчёт. */}
                    {draft.lever ? (
                      <span className="text-xs text-muted-foreground">
                        {t.onboarding.opinionDialog.lever(t.onboarding.opinionDialog.levers[draft.lever])}
                      </span>
                    ) : null}
                    {draft.unverified.length ? (
                      <Alert variant="destructive">
                        <AlertTitle>{t.onboarding.opinionDialog.unverifiedTitle}</AlertTitle>
                        <AlertDescription>
                          {t.onboarding.opinionDialog.unverifiedDescription(draft.unverified.join(", "))}
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {/* Не destructive: это подсказка из данных, а не ошибка —
                        автор может так и хотеть. Красным стоят только числа,
                        которых нет в материале. */}
                    {weak.length ? (
                      <Alert>
                        <AlertTitle>{t.onboarding.opinionDialog.weakTitle}</AlertTitle>
                        <AlertDescription>
                          {weak.map((spot) => t.onboarding.opinionDialog.weak[spot]).join(" · ")}
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
                        {t.onboarding.opinionDialog.counter(length, network.limit)}
                        {network.id === "x" ? t.onboarding.opinionDialog.xLinkNote : ""}
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
                            {t.onboarding.opinionDialog.openIn(t.onboarding.networks[id])}
                          </Button>
                        ) : null}
                        <Button size="sm" onClick={() => copy(draft, text)}>
                          {copied === draft.id ? <CheckIcon /> : <CopyIcon />}
                          {t.onboarding.opinionDialog.copy}
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
