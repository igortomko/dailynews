import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import sharp from 'sharp';

const brand = resolve(dirname(fileURLToPath(import.meta.url)), '../public/brand');
const { data, info } = await sharp(join(brand, 'sources/mark-reporta-approved.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
const mask = Buffer.alloc(width * height);
for (let p = 0; p < mask.length; p++) mask[p] = data[p * 4 + 3] >= 128 ? 255 : 0;
// Fill enclosed eye cutouts, leaving the open loop and exterior transparent.
const exterior = new Uint8Array(mask.length);
const queue = [];
function enqueue(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const p = y * width + x;
  if (mask[p] || exterior[p]) return;
  exterior[p] = 1;
  queue.push(p);
}
for (let x = 0; x < width; x++) { enqueue(x, 0); enqueue(x, height - 1); }
for (let y = 0; y < height; y++) { enqueue(0, y); enqueue(width - 1, y); }
for (let i = 0; i < queue.length; i++) {
  const x = queue[i] % width, y = Math.floor(queue[i] / width);
  enqueue(x - 1, y); enqueue(x + 1, y); enqueue(x, y - 1); enqueue(x, y + 1);
}
for (let p = 0; p < mask.length; p++) if (!exterior[p]) mask[p] = 255;
const temp = await mkdtemp(join(tmpdir(), 'reporta-mark-'));
let contour;
const headTransform = 'rotate(-8 210 65)';
try {
  const smooth = await sharp(mask, { raw: { width, height, channels: 1 } }).blur(0.55).threshold(128).negate().toColourspace('b-w').raw().toBuffer();
  await writeFile(join(temp, 'mask.pgm'), Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), smooth]));
  const result = spawnSync('potrace', ['--svg', '--flat', '--turdsize', '4', '--alphamax', '1.2', '--opttolerance', '0.35', '-o', join(temp, 'mark.svg'), join(temp, 'mask.pgm')], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  const traced = new DOMParser().parseFromString(await readFile(join(temp, 'mark.svg'), 'utf8'), 'image/svg+xml');
  const group = traced.querySelector('svg > g');
  assert(group, 'Missing mark contours');
  group.setAttribute('fill', '#FF462A');
  const path = group.querySelector('path');
  const subpaths = path.getAttribute('d').match(/M[^Mm]*?[zZ]/g);
  assert.equal(subpaths?.length, 2, 'Expected separate closed head and body contours');
  assert(subpaths[0].startsWith('M2323 '), 'Unexpected head contour; review trace before rotating');
  const head = group.cloneNode(true);
  head.querySelector('path').setAttribute('d', subpaths[0]);
  path.setAttribute('d', subpaths[1]);
  contour = `${group.outerHTML}<g transform="${headTransform}">${head.outerHTML}`;
} finally { await rm(temp, { recursive: true, force: true }); }
const source = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="152" viewBox="0 0 300 152" role="img" aria-labelledby="title"><title id="title">Reporta mark</title>${contour}<g fill="#FFFFFF"><circle cx="236" cy="39.5" r="13"/><circle cx="265.5" cy="39.5" r="13"/></g><g fill="#00B8EC"><circle cx="236" cy="39.5" r="7.5"/><circle cx="265.5" cy="39.5" r="7.5"/></g></g></svg>\n`;
await writeFile(join(brand, 'sources/mark-reporta-clean.svg'), source);
const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
assert.equal(doc.querySelectorAll('path').length, 2);
assert.equal(doc.querySelectorAll('circle').length, 4);
assert.equal(doc.querySelectorAll('image, mask, filter').length, 0);
await writeFile(join(brand, 'mark-reporta.svg'), source);
await sharp(Buffer.from(source), { density: 288 }).resize(300, 152).png().toFile(join(brand, 'mark-reporta.png'));
for (const size of [16, 32, 180, 512]) {
  await sharp(Buffer.from(source), { density: 288 }).resize(size, size, { fit: 'contain', background: '#00000000' }).png().toFile(join(brand, `favicon-${size}.png`));
}
const inner = doc.documentElement.innerHTML;
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><svg x="2" y="16" width="60" height="30" viewBox="0 0 300 152">${inner}</svg></svg>\n`;
await writeFile(join(brand, 'favicon.svg'), favicon);
export const markReport = {
  name: 'mark-reporta.svg', width: 300, height: 152,
  source: 'sources/mark-reporta-clean.svg',
  paths: 2, eyeCircles: 4, opaqueHead: true, headTransform,
  note: 'Approved silhouette with enclosed eye cutouts filled before smoothing and tracing. Head and eyes rotated together 8 degrees upward; body unchanged. No eye holes, masks or raster. Eye geometry retained in head coordinates. Historical tracing IoU does not apply to this master.',
};
await writeFile(join(brand, 'mark-spec.json'), `${JSON.stringify(markReport, null, 2)}\n`);
console.log('Exported clean vector mark and four favicon sizes.');
