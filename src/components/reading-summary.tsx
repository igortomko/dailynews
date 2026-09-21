import type { ReadingBlock, StoredReading } from "@/lib/reading-document";
import { relationText } from "@/lib/reading-document";
import type { Dict } from "@/lib/i18n";
import { ru } from "@/lib/i18n/ru/index";
import { typography as t } from "@/lib/typography";

type Labels = Dict["feed"]["reading"];
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
    case "flow": return <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl bg-muted/60 p-4">
      {b.nodes.map((node,i) => <div key={i} className="flex min-w-0 items-center gap-4">
        {i > 0 ? <span className="text-muted-foreground" aria-label={b.relations[i-1] === "equivalent" ? labels.equals : labels.then}>{relationText[b.relations[i-1]]}</span> : null}
        <div className="min-w-0"><p className="text-xl font-semibold tracking-tight">{t(node.value)}</p><p className="text-sm text-muted-foreground">{t(node.label)}</p></div>
      </div>)}
    </div>;
    case "comparison": return <div className="rounded-xl bg-muted/60 p-4">
      <p className="mb-3 text-sm text-muted-foreground">{t(b.commonBasis.text)}</p>
      <div className="grid grid-cols-1 gap-4 min-[440px]:grid-cols-2">{b.items.map((item,i) => <div key={i} className="min-w-0">
        <p className={b.emphasis === "label" ? "text-xl font-semibold tracking-tight" : "text-sm text-muted-foreground"}>{t(item.label)}</p>
        <p className={b.emphasis === "content" ? "mt-1 text-xl font-semibold tracking-tight" : "mt-1"}>{t(item.content.text)}</p>
      </div>)}</div>
    </div>;
    case "metric": return <div className="rounded-xl bg-muted/60 p-4">
      <p className="text-2xl font-semibold tracking-tight">{t(b.value)}</p>
      <p className="mt-1 font-medium">{t(b.label)}</p><p className="mt-2 text-sm text-muted-foreground">{t(b.context.text)}</p>
    </div>;
    case "steps": return <ol className="space-y-3">{b.items.map((item,i) => <li key={i}>
      <p className="text-sm text-muted-foreground">{b.sequence === "procedure" ? labels.step : labels.stage}{'\u00a0'}{i+1}{labels[item.state] ? ` · ${labels[item.state]}` : ""}</p>
      <p className="font-medium">{t(item.label)}</p><p>{t(item.content.text)}</p>
    </li>)}</ol>;
    case "takeaway": return <div className="rounded-xl bg-muted/60 p-4"><p className="font-medium">{t(b.content.text)}</p><p className="mt-2 text-sm text-muted-foreground">{t(b.attribution)}</p></div>;
  }
}

export function ReadingSummary({
  reading,
  detailsOpen,
  onDetailsOpenChange,
  labels = ru.feed.reading,
}: {
  reading: StoredReading;
  detailsOpen: boolean;
  onDetailsOpenChange: (next: boolean) => void;
  labels?: Labels;
}) {
  const doc = reading.document;
  const answer = doc?.answer ?? doc?.lead ?? null;
  const hasDetails = Boolean(doc && (doc.lead || doc.blocks.length || doc.application || doc.evidence));
  return <div className="mt-3 max-w-[68ch] space-y-4 break-words text-pretty text-base leading-[1.6] text-foreground [overflow-wrap:anywhere]">
    {reading.notice ? <p className="text-sm text-muted-foreground">{t(reading.notice)}</p> : null}
    {doc ? <>
      {answer ? <p>{t(answer.text)}</p> : null}
      {hasDetails ? <button
        type="button"
        aria-expanded={detailsOpen}
        onClick={(event) => {
          event.stopPropagation();
          onDetailsOpenChange(!detailsOpen);
        }}
        className="cursor-pointer text-sm text-muted-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:text-foreground"
      >
        {detailsOpen ? labels.hideDetails : labels.showDetails}
      </button> : null}
      {detailsOpen ? <>
        {doc.lead && doc.lead.text !== answer?.text ? <p>{t(doc.lead.text)}</p> : null}
        {doc.blocks.map((b,i) => <Block key={i} block={b} labels={labels} />)}
        {doc.application ? <p>{t(`${doc.application.condition} ${doc.application.text}`)}</p> : null}
        {doc.evidence ? <p className="text-sm leading-relaxed text-muted-foreground">{t(doc.evidence.text)}</p> : null}
      </> : null}
    </> : null}
  </div>;
}
