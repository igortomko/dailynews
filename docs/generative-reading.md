# Generative reading

Approved scope: production implementation of the 2026-09-21 reading examples. Existing text summaries remain readable. New documents are private to a reader; source analysis is shared.

## Generation

1. Fetch the article behind each selected URL. Preserve a fuller RSS/email body when the public page is shorter. Record explicit provenance; `enriched_at` is not proof of full source access. Video notes and partial feeds carry a visible limitation. Process every available character in consecutive sections, including the ending. Sources above 160,000 characters fail visibly rather than silently truncate.
2. Extract source claims, their importance and attribution, referring to numbered source spans. Application code attaches the exact source text as evidence, avoiding invented quotation strings. An independent model call compares the analysis with the raw section. Shared cache keys include source hash, model, reasoning and prompt version. A busy analysis fails retryably before an edition is written.
3. Recheck personal exclusions against the fetched full text before model calls; excluded articles never become error placeholders. Compose a personal document using the reader's saved context, language, complexity and style. Interest is not expertise. Explain unfamiliar topics briefly; omit irrelevant personal information. An application requires an exact relevant context quote. Candidate baselines belong to this reader; title overlap alone does not establish a continuation, and exposure never proves comprehension.
4. Choose structure from the content: independent contributions use bullets, explicit sequences use numbering (up to six original steps), causal explanations and narratives use prose. Q&A and at most one optional flow/comparison/metric/steps/takeaway/quote are available. Exact quote candidates come from source spans; quotations stay in the original language, contain at most 25 words, and must match the raw source. A narrative preserves motivation, obstacle, turns and outcome. The target is 80–140 words; ordinary documents have a 220-word limit and narratives/arguments/investigations 320. Source facts stay attributable, limits accompany conclusions, and labels/headline/body should not repeat each other.
5. Validate shape and source references, account for omitted claims, and compare the final document with every raw section. Allow one targeted semantic repair; malformed JSON has one format repair. On failure retain a verified document of the unchanged source, otherwise show an unavailable state with the original link. This is model-assisted source consistency checking, not independent fact-checking or a guarantee of comprehension.

Articles run with concurrency two, preserving selection order. All in-flight calls settle before a retryable error propagates; cached work can be reused. If all candidates are excluded after fetching, no empty edition is created or sent. Failed rewrites report retained summaries separately from actual updates.

## Reading and delivery

Source remains above the headline, muted until interaction. Section and approximate summary time appear on hover/focus and are visible on touch devices. Source links are not repeated in the generated text. Typography adds nonbreaking spaces. Evidence is optional, smaller text without an 'Основание' label or divider. Web and Kindle share the same content and preserve planned/current/done status. No arbitrary model HTML is rendered.

Time labels omit the approximation symbol. Empty legacy cards show an unavailable notice and no reading time. Metric accents use 24px; quotations use an unboxed blockquote with attribution.

`summary_document` is versioned JSONB; `summary` is a readable plain-text fallback and the input to existing search/drafting. Failed documents do not count as successful delivery or consume usable-card capacity; a verified write can upgrade a failed concurrent write.

## Accounting and operations

Every reading request reserves its maximum estimated cost under a reader row lock and settles actual provider usage, including unsuccessful paid attempts. Uncertain transport failures retain the conservative reservation. Post, voice, translation and personal Jev calls use the same protocol. The reading profile uses reasoning none for extraction and low for editing/audits; `READING_REASONING_EFFORT` can explicitly override it. `READING_REASONING_PHASES` can override individual phases, for example `source-audit:none;verify:none`. Global `none` is not an acceptable production profile: the first replay reduced cost but caused malformed or unavailable documents. The phase-specific profile is a candidate only when a larger replay keeps verified coverage and source defects flat. Reasoning-enabled calls reserve a 32k total output ceiling because provider reasoning consumes that same ceiling. Prices use the existing configured model tariffs. Shared collection/scoring remains shared.

`digests.stats.cost_usd` includes the settled and uncertain `reading_calls` created during that digest, in addition to the legacy digest and owner quality calls. `reading_cost_usd` and `reading_calls` expose the reading-v2 portion separately; this prevents the dashboard from reporting only the old digest-call cost. When `LLM_CACHE_INPUT_PRICE` is configured, settled calls price `usage.cached` at the provider's cache-hit tariff and only the remaining input at the normal tariff; reservations still use full input price until the provider reports actual usage.

Migration `0044_generative_reading` is additive. Existing readers are enabled when the audience is below ten; otherwise the owner is enabled. New readers default to the previous generator until explicitly enabled. Rollback: disable `readers.reading_v2_enabled`; stored documents remain readable. Do not remove schema columns to roll back.

- `npm test` and `npm run verify:db`: structural, source coverage, failure, typography, cache isolation, reservation and capacity checks.
- `npx tsx --env-file=.env pipeline/reading-replay.ts <sample.json> [ids] [output-dir]`: paid live model replay, twice, against a disposable local database; no production writes or delivery. Sample shape is declared in the script. Output is private under /tmp by default.
- `npm run replay -- --reader <id>`: current generator against the latest edition; charges and caches calls but does not update the edition or send it.
- `npx tsx --env-file=.env scripts/rewrite-reading.ts --reader <id> --apply`: back up the latest edition to a private /tmp directory and replace successful cards only, three requests in parallel at the article level. No Telegram or Kindle delivery. Rerunning skips already verified cards.
- `READING_TRACE_DIR`: optional private per-call diagnostics for local debugging. Leave unset in production; source and reader context are included.

Human comprehension, memory retention and reading-speed gains have not been measured. Source consistency and structural checks do not replace that evaluation. Full-source availability is constrained by publishers and extraction; the system summarizes the text it actually obtained.

## Cost shape (2026-09-22)

A card with a reading document costs $0.0204–0.026 against $0.00037 for an
ordinary summary. Two thirds of that is reasoning tokens, not written text:
`source-audit` spends 99.3% of its output on thinking, `verify` 98.4%.

Only the top `READING_CARDS` survivors (default `LEAD_CARDS` = 5) get a
document; the rest are written by the ordinary generator in one batched
call. Selection order is importance, and readers open 16–18 cards a day
whatever the edition size, so the documents go to the cards that are read.
The knob is an environment variable because it moves with the plan price,
not with the code. Values below one read as unset: switching reading off is
the reader flag, not a zero here.

Two cost experiments are settled and recorded in `docs/economics.md`, so
they do not need repeating. Turning reasoning off in the audits saves about
a third and blinds them — the audit then answers 1031 output tokens over six
calls and misses a real misattributed figure it caught with reasoning on.
Putting Jev in front of the audits works for `verify` (18% false alarms at
threshold 0.5, catching 93% of altered numbers and 100% of invented claims)
but not for `source-audit`, where a list of dozens of restated claims draws
93–100% false alarms under either question form.

## Gate for new visual forms

New visual patterns are not added because a model can produce them. Before adding a new block type or making an existing accent more frequent, run a human worksheet over 10–15 verified cards:

```bash
npm run reading:evaluate -- --reader <id> --limit 12
# Fill sourceReview before the reader sees a card, then record readerReview.
npm run reading:evaluate -- --report /tmp/dailynews-reading-evaluation-<id>-<timestamp>.json
```

The worksheet tests the answer to the main question, the essential limit, the choice to open the source, time to answer, confidence and misleading claims. It selects already-existing forms first, then fills the sample by release order. A form needs at least four completed reviews and no misleading card before it becomes a candidate for expansion. With fewer than ten readers this is a qualitative gate, not an A/B test; no result may be described as a reading-speed lift. When traffic supports an experiment, assign readers persistently to one form per comparable story, pre-commit a primary comprehension metric and a source-accuracy guardrail, and record the decision.

## Release validation (2026-09-21)

- `reading-v2.9`: four real articles (reading incentives, exercise research, an ML repository and an engineering essay), generated twice. Eight source-consistency checks passed; 28 provider requests, $0.0894 at the configured rates. Cold articles took 38–180 seconds. The same model audited its output in separate calls; this is not independent factual corroboration.
- Manual inspection confirmed the research explains its attention test and comparison limits; the ML repository summary states that the available README does not explain the named innovations. Linked papers are not silently treated as read. Narrative paragraphs cover deterioration, proposed response and conclusion.
- The repeated sample selected prose for all eight documents. Optional visual formats are supported and renderer-tested, but this sample does not establish a varied production distribution. Some technical names and repetitions remain editorial improvement opportunities.
- 1,243 existing assertions plus reading-specific checks passed; PostgreSQL checks cover budget races, private caches, source exclusions and unavailable capacity. Desktop and 390px card layout checked; no horizontal overflow. No human comprehension or speed test was run.
- The first owner rewrite updated 17 of 60 stored cards and retained 43 after verification/source/budget failures. Daily recorded spend reached $0.488 of the unchanged $0.50 cap; no reservations remained. The Qwen source was recovered from the rendered publisher page and its empty legacy card received a manual editorial summary.
- `reading-v2.15` removes the prose-first bias, requires a verified 35–60 word lead that answers the central question without repeating the headline or erasing the source scope, and makes relevant AI/product applications state a bounded decision with a compatibility or failure condition. Critical claim extraction now keeps historical setup out of the mandatory coverage set when it does not change the method or conclusion. If a length-only repair then loses a material conclusion, one bounded final repair restores it while preserving the limit. It also supplies bounded exact quote candidates and validates quotations against source text. Current-edition list/quote examples are editorial rearrangements of verified summaries, not evidence of varied production distribution. The 12-card replay found that default reasoning retained 9/12 verified cards at $0.1684, while `source-audit:none;verify:none` retained 7/12 at $0.1069 and was rejected for coverage. A hybrid `source-audit:none;verify:low` retained 8/12 at $0.1092; it is cheaper but still below the default and is not enabled in production.
