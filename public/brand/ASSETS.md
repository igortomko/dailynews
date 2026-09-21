# Reporta / Asset manifest

## Current identity

| File | Purpose |
| --- | --- |
| logo-reporta-approved-transparent.png | Transparent export of the typeset vector wordmark, 1529 × 434; legacy filename retained |
| logo-reporta.svg | Literata wordmark outlines and independent vector snake layers |
| logo-reporta.png | Logo, 760 × 216 |
| logo-reporta-380.png / logo-reporta-190.png | Small logo exports |
| logo-reporta-dark.svg / logo-reporta-dark.png | Transparent light lettering and red snake for dark backgrounds |
| logo-reporta-on-dark.png | Light wordmark on a dark background, no white panel |
| snake-reporta.svg | Standalone vector snake used inside the wordmark |
| mark-reporta.png / mark-reporta.svg | Standalone snake, traced from the original 300 × 152 reference |
| favicon-16.png / favicon-32.png | Browser icon |
| favicon-180.png / favicon-512.png / favicon.svg | Application and large icon |

SVG masters contain real paths, circles and clipping paths, with no embedded
bitmap and no live text. Their backgrounds are transparent; eye whites are opaque.
The standalone mark silhouette has 99.35% raster-mask IoU with its reference;
differences are within a one-pixel source boundary. Its eyes use exact cyan circles
(#00B8EC). The wordmark is intentionally newly typeset, not a 1:1 trace of old letters.
Literata 650, optical size 18, HarfBuzz kerning, zero tracking. Details are in
`wordmark-spec.json`; trace measurements are in `vector-report.json`.

Original references: `logo-reporta-approved.png`, `sources/mark-reporta-approved.png`.
`sources/logo-reporta-traced.svg` preserves the old lettering as a traced comparison,
not as the canonical logo. The continuous wordmark snake is a Bezier reconstruction
with a smooth manually drawn Bezier head. No traced head fragments remain.
Flat vector color replaces the original raster texture.

Rebuild: `node scripts/build-brand-identity.mjs`. Requires Potrace 1.16 and uv;
fontTools 4.65.0 and uharfbuzz 0.56.2 are pinned in `scripts/brand-font-requirements.txt`.
The source font is from the official Google Fonts `ofl/literata` directory;
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
`type-study/index.html` compares Literata 600, 650 and 700, plus the original
and earlier candidates. Literata 650 is the current user-requested trial, not
final font approval. The previous Bodoni master is preserved as
`type-study/bodoni-moda.svg`. All three Literata samples use optical size 18.
Rebuild each sample with `scripts/build-brand-wordmark.py --weight WEIGHT
--output-dir OUTPUT`, then copy its `logo-reporta.svg` into `type-study/`.

## Fonts and interface assets

WOFF2 files and CSS are self-hosted in `fonts/`, with an OFL license for each
family. Source: [Google Fonts](https://github.com/google/fonts/tree/main/ofl).
Families: Literata (logo and Cyrillic headlines), Fraunces, Inter, DM Mono,
IBM Plex Mono. Bodoni Moda is retained only as a historical comparison.

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
