import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { parseHTML } from 'linkedom';

const brand = resolve(dirname(fileURLToPath(import.meta.url)), '../public/brand');
const { document } = parseHTML(await readFile(join(brand, 'mark-reporta.svg'), 'utf8'));
const sourceImage = document.querySelector('image');
const source = sourceImage.getAttribute('href') ?? sourceImage.getAttribute('xlink:href');
assert(source.startsWith('data:image/png;base64,'));
const original = Buffer.from(source.slice('data:image/png;base64,'.length), 'base64');
const eyes = [{ x: 236, y: 39.5 }, { x: 265.5, y: 39.5 }];
const circles = eyes.map(({ x, y }) => `<circle cx="${x}" cy="${y}" r="7.5" fill="#00B8EC"/>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="152" viewBox="0 0 300 152" role="img" aria-labelledby="title"><title id="title">Reporta snake mark</title>${sourceImage.toString()}<g id="reporta-eyes">${circles}</g></svg>\n`;
await writeFile(join(brand, 'mark-reporta.svg'), svg);

const base = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const rendered = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
const corrected = Buffer.from(base.data);
let changedPixels = 0;
// Copy only iris pixels; the approved body and its alpha stay byte-identical.
for (let y = 0; y < base.info.height; y++) {
  for (let x = 0; x < base.info.width; x++) {
    if (!eyes.some(eye => Math.hypot(x + .5 - eye.x, y + .5 - eye.y) <= 8.5)) continue;
    const offset = (y * base.info.width + x) * 4;
    if (!corrected.subarray(offset, offset + 4).equals(rendered.subarray(offset, offset + 4))) changedPixels++;
    rendered.copy(corrected, offset, offset, offset + 4);
  }
}
await sharp(corrected, { raw: base.info }).png().toFile(join(brand, 'mark-reporta.png'));
const actual = await sharp(join(brand, 'mark-reporta.png')).raw().toBuffer();
for (let y = 0; y < base.info.height; y++) {
  for (let x = 0; x < base.info.width; x++) {
    const offset = (y * base.info.width + x) * 4;
    if (!eyes.some(eye => Math.hypot(x + .5 - eye.x, y + .5 - eye.y) <= 8.5)) {
      assert(actual.subarray(offset, offset + 4).equals(base.data.subarray(offset, offset + 4)), 'Body pixel changed');
    }
  }
}
for (const size of [16, 32, 180, 512]) {
  await sharp(Buffer.from(svg), { density: 288 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toFile(join(brand, `favicon-${size}.png`));
}
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title"><title id="title">Reporta</title><svg x="2" y="16" width="60" height="30" viewBox="0 0 300 152">${sourceImage.toString()}<g id="reporta-eyes">${circles}</g></svg></svg>\n`;
await writeFile(join(brand, 'favicon.svg'), favicon);
console.log(JSON.stringify({ changedPixels, outsideIrisPixelsChanged: 0, eyeColor: '#00B8EC', faviconSizes: [16, 32, 180, 512] }));
