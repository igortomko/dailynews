import type { ReadingBlock, StoredReading } from "@/lib/reading-document";
import { relationText } from "@/lib/reading-document";
import type { Dict } from "@/lib/i18n";
import { ru } from "@/lib/i18n/ru/index";
import { typography as t } from "@/lib/typography";

type Labels = Dict["feed"]["reading"];
// Крупнее заголовка карточки (20 px) в документе нет ничего: значение
// metric на 24 px читалось раньше заголовка, и карточка начиналась
// с числа, а не с новости. Акцент — 18 px, как цитата; подложка 40 %,
// как у списка публикаций сюжета: плашка тянет глаз следом за кеглем.
// Табличные цифры — ряд чисел в flow и comparison держит ширину.
const VALUE = "text-lg font-semibold tracking-tight tabular-nums";
function Block({ block: b, labels }: { block: ReadingBlock; labels: Labels }) {
  switch (b.kind) {
    case "paragraph": return <p>{t(b.content.text)}</p>;
    case "quote": return <figure className="pl-4 border-l-2 border-foreground/20">
      <blockquote className="text-lg leading-relaxed font-medium">“{t(b.content.text)}”</blockquote>
      <figcaption className="mt-2 text-sm text-muted-foreground">{t(b.attribution)}</figcaption>
    </figure>;
    case "list": {
      const Tag = b.numbering === "facts" ? "ol" : "ul";
      return <Tag className={`${b.numbering === "facts" ? "list-decimal" : "list-disc"} space-y-2 pl-5 marker:text-muted-foreground`}>
        {b.items.map((item, i) => <li key={i} className="pl-1">{t(item.text)}</li>)}
      </Tag>;
    }
    case "qa": return <div className="space-y-4">{b.items.map((item,i) => <div key={i}>
      <p className="font-medium">{t(item.question.text)}</p><p className="mt-1">{t(item.answer.text)}</p>
    </div>)}</div>;
    case "flow": return <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl bg-muted/40 p-4">
      {b.nodes.map((node,i) => <div key={i} className="flex min-w-0 items-center gap-4">
        {i > 0 ? <span className="text-muted-foreground" aria-label={b.relations[i-1] === "equivalent" ? labels.equals : labels.then}>{relationText[b.relations[i-1]]}</span> : null}
        <div className="min-w-0"><p className={VALUE}>{t(node.value)}</p><p className="text-sm text-muted-foreground">{t(node.label)}</p></div>
      </div>)}
    </div>;
    case "comparison": return <div className="rounded-xl bg-muted/40 p-4">
      <p className="mb-3 text-sm text-muted-foreground">{t(b.commonBasis.text)}</p>
      <div className="grid grid-cols-1 gap-4 min-[440px]:grid-cols-2">{b.items.map((item,i) => <div key={i} className="min-w-0">
        <p className={b.emphasis === "label" ? VALUE : "text-sm text-muted-foreground"}>{t(item.label)}</p>
        <p className={b.emphasis === "content" ? `mt-1 ${VALUE}` : "mt-1"}>{t(item.content.text)}</p>
      </div>)}</div>
    </div>;
    case "metric": return <div className="rounded-xl bg-muted/40 p-4">
      <p className={VALUE}>{t(b.value)}</p>
      <p className="mt-1 text-sm font-medium">{t(b.label)}</p><p className="mt-2 text-sm text-muted-foreground">{t(b.context.text)}</p>
    </div>;
    case "steps": return <ol className="space-y-3">{b.items.map((item,i) => <li key={i}>
      <p className="text-sm text-muted-foreground">{b.sequence === "procedure" ? labels.step : labels.stage}{'\u00a0'}{i+1}{labels[item.state] ? ` · ${labels[item.state]}` : ""}</p>
      <p className="font-medium">{t(item.label)}</p><p>{t(item.content.text)}</p>
    </li>)}</ol>;
    case "takeaway": return <div className="rounded-xl bg-muted/40 p-4"><p className="font-medium">{t(b.content.text)}</p><p className="mt-2 text-sm text-muted-foreground">{t(b.attribution)}</p></div>;
  }
}

/**
 * `lang` — язык, которым написан документ. Он же включает переносы: правила
 * у каждого языка свои, и неизвестный язык лучше не переносить вовсе,
 * чем рвать его чужими. Стоит на самом тексте, а не на странице: интерфейс
 * может быть английским при русском выпуске.
 */
export function ReadingSummary({ reading, labels = ru.feed.reading, lang }: { reading: StoredReading; labels?: Labels; lang?: string | null }) {
  const doc = reading.document;
  return <div lang={lang ?? undefined} className={`mt-3 max-w-[60ch] space-y-4 break-words text-pretty text-base leading-[1.6] text-foreground [overflow-wrap:anywhere]${lang ? " hyphens-auto" : ""}`}>
    {reading.notice ? <p className="text-sm text-muted-foreground">{t(reading.notice)}</p> : null}
    {doc ? <>
      {doc.lead ? <p>{t(doc.lead.text)}</p> : null}
      {doc.blocks.map((b,i) => <Block key={i} block={b} labels={labels} />)}
      {doc.application ? <p>{t(`${doc.application.condition} ${doc.application.text}`)}</p> : null}
      {doc.evidence ? <p className="text-sm leading-relaxed text-muted-foreground">{t(doc.evidence.text)}</p> : null}
    </> : null}
  </div>;
}
