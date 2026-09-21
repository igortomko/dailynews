# Reporta / Asset manifest

## Approved identity

| File | Purpose |
| --- | --- |
| logo-reporta-approved-transparent.png | Approved full-resolution logo, 1529 × 434 |
| logo-reporta.svg | Same approved bitmap embedded in SVG, not vector paths |
| logo-reporta.png | Logo, 760 × 216 |
| logo-reporta-380.png / logo-reporta-190.png | Small logo exports |
| logo-reporta-on-dark.png | Approved logo on a white field inside a dark frame |
| mark-reporta.png / mark-reporta.svg | Approved standalone snake, original raster 300 × 152 |
| favicon-16.png / favicon-32.png | Browser icon |
| favicon-180.png / favicon-512.png / favicon.svg | Application and large icon |

The approved body geometry is preserved. The standalone mark now has two
flat cyan irises (#00B8EC), rendered as vector circles in its SVG. Its PNG
body pixels outside the irises are unchanged. Favicon exports use this version.
Rebuild these exports with `node scripts/refine-brand-eyes.mjs`.
Legacy files `logo-reporta-dark.*`, `social-preview.*`, `illustration-*.svg`
are retained for compatibility but are not canonical and are not included in the kit.

## New editorial series

| File | Subject | Origin |
| --- | --- | --- |
| illustrations/observer.webp | Reader portrait with newspaper | Built-in image_gen, 2026-09-21 |
| illustrations/attention.webp | Hand with magnifying glass | Built-in image_gen, 2026-09-21 |
| illustrations/city.webp | City engraving | Built-in image_gen, 2026-09-21 |
| photography/reader.webp | Reader at a cafe | Built-in image_gen, 2026-09-21 |
| brand-preview.png | Brand cover for GitHub and social sharing | Browser render of this brand book |

User-supplied engraving references informed the style only. They are not
redistributed. New images depict fictional people and scenes, not reported events.
Photograph is an AI-generated art-direction sample, not documentary evidence.
WebP quality 93 retains the generated compositions without redrawing.
Exact generation prompts are in `generation-prompts.json`.

## Fonts and interface assets

WOFF2 files and CSS are self-hosted in `fonts/`, with an OFL license for each
family. Source: [Google Fonts](https://github.com/google/fonts/tree/main/ofl).
Families: Fraunces, Literata, Inter, DM Mono, IBM Plex Mono.

Interface icons in `icons/` are rendered from the installed lucide-react
package. Its ISC license is included as `icons/LICENSE`.

`tokens.css` contains reusable colors, type roles and opt-in motion.
`brand.css`, `brand.js`, `index.html` implement the interactive brand book.
`GUIDELINES.md` describes all ten directions and their usage constraints.

The full kit opens offline after extraction. Product and attribution links
naturally require a connection. A kit download inside an already extracted
kit is intentionally not recursive; use the included files directly.

Rebuild the archive from the repository root with `node scripts/package-brand.mjs`.
