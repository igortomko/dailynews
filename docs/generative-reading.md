# Generative reading

Approved scope: production implementation of the 2026-09-21 reading examples. Existing text summaries remain readable. New documents are private to a reader; source analysis is shared.

## Generation

1. Fetch the article behind each selected URL. Preserve a fuller RSS/email body when the public page is shorter. Record explicit provenance; `enriched_at` is not proof of full source access. Video notes and partial feeds carry a visible limitation. Process every available character in consecutive sections, including the ending. Sources above 160,000 characters fail visibly rather than silently truncate.
2. Extract source claims, their importance and attribution, referring to numbered source spans. Application code attaches the exact source text as evidence, avoiding invented quotation strings. An independent model call compares the analysis with the raw section. Shared cache keys include source hash, model, reasoning and prompt version. A busy analysis fails retryably before an edition is written.
3. Compose a personal document using the reader's saved context, language, complexity and style. Interest is not expertise. Explain unfamiliar topics briefly; omit irrelevant personal information. An application requires an exact relevant context quote. Candidate baselines belong to this reader; title overlap alone does not establish a continuation, and exposure never proves comprehension.
4. Paragraphs are the default. Lists, Q&A and at most one optional flow/comparison/metric/steps/takeaway are available. A narrative preserves motivation, obstacle, turns and outcome. The target is 80–140 words; ordinary documents have a 220-word limit and narratives/arguments/investigations 320. Source facts stay attributable, limits accompany conclusions, and labels/headline/body should not repeat each other.
5. Validate shape and source references, account for omitted claims, and compare the final document with every raw section. Allow one targeted semantic repair; malformed JSON has one format repair. On failure retain a verified document of the unchanged source, otherwise show an unavailable state with the original link. This is model-assisted source consistency checking, not independent fact-checking or a guarantee of comprehension.

## Reading and delivery

Source remains above the headline, muted until interaction. Section and approximate summary time appear on hover/focus and are visible on touch devices. Source links are not repeated in the generated text. Typography adds nonbreaking spaces. Evidence is optional, smaller text without an 'Основание' label or divider. Web and Kindle share the same content and preserve planned/current/done status. No arbitrary model HTML is rendered.

`summary_document` is versioned JSONB; `summary` is a readable plain-text fallback and the input to existing search/drafting. Failed documents do not count as successful delivery or consume usable-card capacity; a verified write can upgrade a failed concurrent write.

## Accounting and operations

Every reading request reserves its maximum estimated cost under a reader row lock and settles actual provider usage, including unsuccessful paid attempts. Uncertain transport failures retain the conservative reservation. Post, voice, translation and personal Jev calls use the same protocol. The reading profile uses reasoning none for extraction and low for editing/audits; READING_REASONING_EFFORT can explicitly override it. Reasoning-enabled calls reserve a 32k total output ceiling because provider reasoning consumes that same ceiling. Prices use the existing configured model tariffs. Shared collection/scoring remains shared.

Migration `0044_generative_reading` is additive. Existing readers are enabled when the audience is below ten; otherwise the owner is enabled. New readers default to the previous generator until explicitly enabled. Rollback: disable `readers.reading_v2_enabled`; stored documents remain readable. Do not remove schema columns to roll back.

- `npm test` and `npm run verify:db`: structural, source coverage, failure, typography, cache isolation, reservation and capacity checks.
- `npx tsx --env-file=.env pipeline/reading-replay.ts <sample.json> [ids] [output-dir]`: paid live model replay, twice, against a disposable local database; no production writes or delivery. Sample shape is declared in the script. Output is private under /tmp by default.
- `npm run replay -- --reader <id>`: current generator against the latest edition; charges and caches calls but does not update the edition or send it.
- `npx tsx --env-file=.env scripts/rewrite-reading.ts --reader <id> --apply`: back up the latest edition to a private /tmp directory and replace successful cards only, three requests in parallel at the article level. No Telegram or Kindle delivery. Rerunning skips already verified cards.
- `READING_TRACE_DIR`: optional private per-call diagnostics for local debugging. Leave unset in production; source and reader context are included.

Human comprehension, memory retention and reading-speed gains have not been measured. Source consistency and structural checks do not replace that evaluation. Full-source availability is constrained by publishers and extraction; the system summarizes the text it actually obtained.
