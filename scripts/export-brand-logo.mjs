import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const brand = resolve(dirname(fileURLToPath(import.meta.url)), '../public/brand');
const light = await readFile(join(brand, 'logo-reporta.svg'));
const dark = await readFile(join(brand, 'logo-reporta-dark.svg'));
for (const [file, source] of [['logo-reporta-approved-transparent.png', light], ['logo-reporta-dark.png', dark]]) {
  await sharp(source).png().toFile(join(brand, file));
}
for (const width of [1529, 760, 380, 190]) {
  await sharp(light, { density: 144 }).resize({ width }).png().toFile(join(brand, width === 760 ? 'logo-reporta.png' : `logo-reporta-${width}.png`));
}
await sharp(dark).flatten({ background: '#171716' }).png().toFile(join(brand, 'logo-reporta-on-dark.png'));
console.log('Exported transparent wordmark PNGs from the canonical vector.');
