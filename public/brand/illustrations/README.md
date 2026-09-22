# Reporta / 20 illustrations

`light/{id}.png`: black engraved ink and #FF462A red on transparency.
`dark/{id}.png`: the identical drawing in white ink and the same red.

Both themes have exactly the same dimensions and alpha pixels. White paper,
including interior gaps, is transparent. These are PNG illustrations, not SVG.
Choose the file for the destination surface; never invert the entire image.
Use proportional scaling, preferably at least 240px wide for complex scenes.

`catalog.json` contains the Russian titles and meanings. Each image expresses
one simple metaphor, not an actual news event. All scenes are AI-generated.

In the repository, `sources/` holds generated source PNGs, `preview/` contains
640px lossless WebP files, `web/` holds 384px lossy WebP copies for the product
interface, and `generation.json` records generation prompts.
Rebuild exports with `node scripts/export-brand-illustrations.mjs`.
