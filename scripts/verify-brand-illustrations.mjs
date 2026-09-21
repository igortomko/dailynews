import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public/brand');
const catalog = JSON.parse(await readFile(join(root, 'illustrations/catalog.json'), 'utf8'));
assert.equal(catalog.length, 20);
assert.equal(new Set(catalog.map(item => item.id)).size, 20);
for (const { id } of catalog) {
  const light = await sharp(join(root, 'illustrations/light', `${id}.png`)).raw().toBuffer({ resolveWithObject: true });
  const dark = await sharp(join(root, 'illustrations/dark', `${id}.png`)).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(light.info, dark.info, `${id}: dimensions`);
  assert.equal(light.info.channels, 4, `${id}: alpha channel`);
  let visible = 0, red = 0, transparent = 0;
  for (let p = 0; p < light.data.length; p += 4) {
    const a = light.data[p + 3];
    assert.equal(a, dark.data[p + 3], `${id}: alpha at ${p}`);
    if (!a) { transparent++; continue; }
    visible++;
    const color = [...light.data.subarray(p, p + 3)];
    if (color[0] === 255) {
      red++;
      assert.deepEqual(color, [255, 70, 42], `${id}: brand red`);
      assert.deepEqual(light.data.subarray(p, p + 4), dark.data.subarray(p, p + 4), `${id}: red changed`);
    } else {
      assert.deepEqual(color, [0, 0, 0], `${id}: light ink`);
      assert.deepEqual([...dark.data.subarray(p, p + 3)], [255, 255, 255], `${id}: dark ink`);
    }
  }
  assert(visible > 1000 && red > 100, `${id}: blank art or missing accent`);
  assert(transparent > light.info.width * light.info.height * .2, `${id}: opaque matte`);
  assert.equal(light.data[3], 0, `${id}: corner`);
  console.log(`${id}: transparent, identical alpha, unchanged red`);
}
for (const name of ['logo-reporta', 'logo-reporta-dark', 'snake-reporta', 'mark-reporta', 'favicon']) {
  const svg = await readFile(join(root, `${name}.svg`), 'utf8');
  assert(!/<(?:image|text)\b/.test(svg) && !/base64|data:image/.test(svg), `${name}: embedded raster or text`);
}
const snake = await readFile(join(root, 'snake-reporta.svg'), 'utf8');
assert(snake.length < 2000, 'Snake contains unexpected trace complexity');
console.log('Verified 20 theme pairs and 5 outline SVG masters.');
