import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public/brand');
const catalog = JSON.parse(await readFile(join(root, 'illustrations/catalog.json'), 'utf8'));
const report = [];
for (const folder of ['light', 'dark', 'preview']) await mkdir(join(root, 'illustrations', folder), { recursive: true });
for (const item of catalog) {
  const { data, info } = await sharp(join(root, 'illustrations/sources', `${item.id}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const light = Buffer.alloc(data.length);
  const dark = Buffer.alloc(data.length);
  let visible = 0;
  let accent = 0;
  // Treat the generated art as two printing inks; paper becomes transparent.
  // Both theme exports share one alpha mask, and red pixels are byte-identical.
  for (let p = 0; p < data.length; p += 4) {
    const [r, g, b, sourceAlpha] = data.subarray(p, p + 4);
    const isRed = r > 150 && r - Math.max(g, b) > 40;
    const coverage = isRed ? Math.max((r - b) / 213, 1 - r / 255) : 1 - Math.max(r, g, b) / 255;
    const alpha = Math.round(Math.min(1, Math.max(0, coverage)) * sourceAlpha);
    const cleanAlpha = alpha < 8 ? 0 : alpha;
    light.set(isRed ? [255, 70, 42, cleanAlpha] : [0, 0, 0, cleanAlpha], p);
    dark.set(isRed ? [255, 70, 42, cleanAlpha] : [255, 255, 255, cleanAlpha], p);
    if (cleanAlpha) { visible++; if (isRed) accent++; }
  }
  const raw = { width: info.width, height: info.height, channels: 4 };
  for (const [theme, pixels] of [['light', light], ['dark', dark]]) {
    await sharp(pixels, { raw }).png().toFile(join(root, 'illustrations', theme, `${item.id}.png`));
    await sharp(pixels, { raw }).resize({ width: 640 }).webp({ lossless: true }).toFile(join(root, 'illustrations/preview', `${item.id}-${theme}.webp`));
  }
  if (['observer', 'attention', 'city'].includes(item.id)) {
    await sharp(light, { raw }).webp({ lossless: true }).toFile(join(root, 'illustrations', `${item.id}.webp`));
  }
  report.push({ id: item.id, width: info.width, height: info.height, visiblePixels: visible, redPixels: accent, sharedAlpha: true, unchangedRed: true });
}
await writeFile(join(root, 'illustrations/export-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Exported ${catalog.length} transparent light/dark pairs.`);
