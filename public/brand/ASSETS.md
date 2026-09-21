# Reporta / Asset manifest

## Current identity

| File | Purpose |
| --- | --- |
| logo-reporta-approved-transparent.png | Transparent export of the typeset vector wordmark, 1529 × 434; legacy filename retained |
| logo-reporta.svg | DM Serif Display outlines with optical kerning and independent vector snake layers |
| logo-reporta.png | Logo, 760 × 216 |
| logo-reporta-380.png / logo-reporta-190.png | Small logo exports |
| logo-reporta-dark.svg / logo-reporta-dark.png | Transparent light lettering and red snake for dark backgrounds |
| logo-reporta-on-dark.png | Light wordmark on a dark background, no white panel |
| snake-reporta.svg | Standalone vector snake used inside the wordmark |
| mark-reporta.png / mark-reporta.svg | Smoothed standalone snake, solid head and clean circular eyes |
| favicon-16.png / favicon-32.png | Browser icon |
| favicon-180.png / favicon-512.png / favicon.svg | Application and large icon |

SVG masters contain real paths, circles and clipping paths, with no embedded
bitmap and no live text. Their backgrounds are transparent; eye whites are opaque.
The standalone mark follows the original 300 × 152 silhouette with smoothed curves.
Enclosed cutouts around the old eyes are filled before tracing, so no background
slivers remain beneath the white and cyan (#00B8EC) circles. Eye centers and radii
are unchanged. Rebuild with `node scripts/build-brand-mark.mjs`; details are in
`mark-spec.json`. `vector-report.json` preserves historical tracing measurements,
not a fidelity claim for the cleaned mark. The wordmark is intentionally newly
typeset, not a 1:1 trace of old letters.
DM Serif Display Regular 400, HarfBuzz kerning plus manual pair corrections,
zero global tracking. Details are in
`wordmark-spec.json`; trace measurements are in `vector-report.json`.

Original references: `logo-reporta-approved.png`, `sources/mark-reporta-approved.png`.
`sources/logo-reporta-traced.svg` preserves the old lettering as a traced comparison,
not as the canonical logo. The continuous wordmark snake is a Bezier reconstruction
with a smooth manually drawn Bezier head. No traced head fragments remain.
The body is aligned to the middle of the new wordmark, passing through R, p
and o counters behind left stems and in front of right strokes. It exits a
at counter height without dipping below the baseline. Head and eyes are unchanged.
Flat vector color replaces the original raster texture.

Rebuild: `node scripts/build-brand-identity.mjs`. Requires Potrace 1.16 and uv;
fontTools 4.65.0 and uharfbuzz 0.56.2 are pinned in `scripts/brand-font-requirements.txt`.
The source font is from the official Google Fonts `ofl/dmserifdisplay` directory;
the TTF and OFL license are included in `fonts/`.
Legacy `social-preview.*` and `illustration-*.svg` are not canonical and are excluded.

## Editorial series / 20 scenes, two themes

| File | Subject | Origin |
| --- | --- | --- |
| illustrations/observer.webp | Many newspapers through a sieve, one red newspaper out: less noise | Built-in image_gen edit, 2026-09-21 |
| illustrations/attention.webp | Magnifier reveals a red gemstone in print: find value | Built-in image_gen edit, 2026-09-21 |
| illustrations/city.webp | A whole city inside a cup: the world with your morning coffee | Built-in image_gen edit, 2026-09-21 |
| photography/reader.webp | Reader at a cafe | Built-in image_gen, 2026-09-21 |
| brand-preview.png | Brand cover for GitHub and social sharing | Browser render of this brand book |

User-supplied engraving references informed the style only. They are not
redistributed. Each scene uses one instantly readable surreal metaphor. Red is part
of the scene, not an unrelated overlay. Images depict fiction, not reported events.
Photograph is an AI-generated art-direction sample, not documentary evidence.
The first three scenes were simplified; 17 more extend the same language.
`illustrations/catalog.json` lists all 20 titles and intended meanings.
`illustrations/light/` and `illustrations/dark/` contain 40 transparent PNGs.
The dark files are deterministic ink substitutions, not regenerated drawings:
alpha is byte-identical, red stays #FF462A, black becomes #FFFFFF.
White paper is removed, including the gaps inside objects. No opaque matte.
`illustrations/preview/` contains 640px lossless WebP previews.
`illustrations/sources/` preserves AI-generated source PNGs for reproducibility.
Generation prompts are in `illustrations/generation.json`; earlier art direction
is retained in `generation-prompts.json`. Run `node scripts/export-brand-illustrations.mjs`
to rebuild all pairs. Illustrations are raster assets, not vector paths.

`reporta-illustrations.zip` is the standalone 40-PNG download with catalog and usage.
`type-study/index.html` compares native and optically corrected DM Serif Display
at the same type scale. Pair adjustments per 1000 em: Re -6, ep -12, po -22,
or -10, rt +12, ta -14. These are added to native font kerning, not substituted
for it. The wordmark geometry is unchanged except for horizontal glyph positions.
Both kerning samples use the updated snake flow. The earlier low-snake logo is
preserved separately as `type-study/dm-serif-display-low-snake.svg`.
Use `scripts/build-brand-wordmark.py --native-kerning --output-dir OUTPUT` for
the uncorrected comparison. The default exports the corrected canonical logo.
Literata 600/650/700, Bodoni and earlier candidates remain historical samples.

## Fonts and interface assets

`head-study/index.html` contains six exploratory head expressions with light/dark
previews and transparent SVG/PNG downloads. These are not approved replacements:
the canonical logo remains unchanged. The head has an elongated silhouette,
and each expression retains the brand red, white and cyan. Lettering, kerning
and body paths remain identical to the canonical master. Rebuild with
`node scripts/build-brand-head-study.mjs`; the standalone ZIP lives in `head-study/`.

WOFF2 files and CSS are self-hosted in `fonts/`, with an OFL license for each
family. Source: [Google Fonts](https://github.com/google/fonts/tree/main/ofl).
Families: DM Serif Display (logo), Literata (Cyrillic headlines), Fraunces,
Inter, DM Mono and IBM Plex Mono. Bodoni Moda is a historical comparison.

Interface icons in `icons/` are rendered from the installed lucide-react
package. Its ISC license is included as `icons/LICENSE`.

`tokens.css` contains reusable colors, type roles and opt-in motion, plus success,
warning, danger, info and neutral colors in light/dark themes. Each semantic role
has fg, bg, border, solid and on-solid values, scoped by `data-reporta-theme`.
`brand.css`, `brand.js`, `index.html` implement the interactive brand book.
`GUIDELINES.md` describes all ten directions and their usage constraints.

The full kit opens offline after extraction. Product and attribution links
naturally require a connection. A kit download inside an already extracted
kit is intentionally not recursive; use the included files directly.

Rebuild the archive from the repository root with `node scripts/package-brand.mjs`.
