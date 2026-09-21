import './prepare-brand-reference.mjs';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { parseHTML } from 'linkedom';

const brand = resolve(dirname(fileURLToPath(import.meta.url)), '../public/brand');
const temporary = await mkdtemp(join(tmpdir(), 'reporta-vector-'));
const scale = 4;
const reports = [];

async function trace(mask, width, height, id, fill) {
  const pixels = await sharp(mask, { raw: { width, height, channels: 1 } })
    .resize(width * scale, height * scale).negate().toColourspace('b-w').raw().toBuffer();
  const input = join(temporary, `${id}.pgm`);
  const output = join(temporary, `${id}.svg`);
  await writeFile(input, Buffer.concat([Buffer.from(`P5\n${width * scale} ${height * scale}\n255\n`), pixels]));
  const result = spawnSync('potrace', ['--svg', '--flat', '--turdsize', '4', '--alphamax', '.8', '--opttolerance', '.05', '--unit', '100', '-o', output, input], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  const { document } = parseHTML(await readFile(output, 'utf8'));
  const group = document.querySelector('svg > g');
  assert(group, `Missing traced contours: ${id}`);
  group.setAttribute('fill', fill);
  return `<g id="${id}" transform="scale(${1 / scale})">${group.toString()}</g>`;
}

async function makeVector(name, source, isMark) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const masks = Object.fromEntries(['body', 'red', 'eyes', 'iris'].map(key => [key, Buffer.alloc(width * height)]));
  for (let p = 0; p < width * height; p++) {
    const [r, g, b, a] = data.subarray(p * 4, p * 4 + 4);
    const x = p % width;
    const y = Math.floor(p / width);
    const inEyes = isMark ? x > 220 && x < 282 && y > 22 && y < 57 : x > 1415 && x < 1491 && y > 182 && y < 225;
    masks.body[p] = a;
    if (r - g > 45 && r - b > 45) masks.red[p] = a;
    if (inEyes && g > r - 35 && b > r - 35) masks.eyes[p] = a;
    if (inEyes && b - r > 50 && g - r > 50) masks.iris[p] = a;
  }
  const body = await trace(masks.body, width, height, `${name}-body`, isMark ? '#FF462A' : '#080808');
  const red = isMark ? '' : await trace(masks.red, width, height, `${name}-red`, '#FF462A');
  const eyes = isMark
    ? '<g fill="#FFFFFF"><circle cx="236" cy="39.5" r="13"/><circle cx="265.5" cy="39.5" r="13"/></g>'
    : await trace(masks.eyes, width, height, `${name}-eyes`, '#FFFFFF');
  const iris = isMark
    ? '<g id="reporta-irises" fill="#00B8EC"><circle cx="236" cy="39.5" r="7.5"/><circle cx="265.5" cy="39.5" r="7.5"/></g>'
    : await trace(masks.iris, width, height, `${name}-irises`, '#00B8EC');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title"><title id="title">Reporta ${isMark ? 'mark' : 'logo'}</title>${body}${red}${eyes}${iris}</svg>\n`;
  assert(!svg.includes('<image') && !svg.includes('base64'), 'SVG must contain only vector geometry');
  await writeFile(join(brand, `${name}.svg`), svg);
  const raster = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
  let intersection = 0;
  let union = 0;
  let mismatch = 0;
  let farMismatch = 0;
  for (let p = 0; p < masks.body.length; p++) {
    const before = masks.body[p] >= 128;
    const after = raster[p * 4 + 3] >= 128;
    if (before && after) intersection++;
    if (before || after) union++;
    if (before === after) continue;
    mismatch++;
    const x = p % width;
    const y = Math.floor(p / width);
    let nearEdge = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      if ((masks.body[(y + dy) * width + x + dx] >= 128) !== before) nearEdge = true;
    }
    if (!nearEdge) farMismatch++;
  }
  const silhouetteIoU = intersection / union;
  assert(silhouetteIoU > .985, `Contour drift: ${name} ${silhouetteIoU}`);
  assert.equal(farMismatch, 0, `Changes away from contour: ${name}`);
  reports.push({ name, width, height, silhouetteIoU, mismatchedBoundaryPixels: mismatch, changedPixelsBeyondOnePixelBoundary: farMismatch, svgBytes: Buffer.byteLength(svg) });
  return svg;
}

try {
  const logo = await makeVector('logo-reporta', join(brand, 'logo-reporta-approved-transparent.png'), false);
  await writeFile(join(brand, 'sources/logo-reporta-traced.svg'), logo);
  const dark = logo.replace('fill="#080808"', 'fill="#F5F5F2"');
  await writeFile(join(brand, 'logo-reporta-dark.svg'), dark);
  for (const [file, svg] of [['logo-reporta-approved-transparent.png', logo], ['logo-reporta-dark.png', dark]]) {
    await sharp(Buffer.from(svg)).png().toFile(join(brand, file));
  }
  await sharp(Buffer.from(dark)).flatten({ background: '#171716' }).png().toFile(join(brand, 'logo-reporta-on-dark.png'));
  for (const width of [1529, 760, 380, 190]) {
    const file = width === 760 ? 'logo-reporta.png' : `logo-reporta-${width}.png`;
    await sharp(Buffer.from(logo), { density: 144 }).resize({ width }).png().toFile(join(brand, file));
  }
  const { markReport } = await import('./build-brand-mark.mjs');
  reports.push(markReport);
  reports[0].name = 'sources/logo-reporta-traced.svg';
  const fontBuild = spawnSync('uv', ['run', '--with-requirements', resolve(brand, '../../scripts/brand-font-requirements.txt'), 'python', resolve(brand, '../../scripts/build-brand-wordmark.py')], { encoding: 'utf8' });
  if (fontBuild.error) throw fontBuild.error;
  if (fontBuild.status !== 0) throw new Error(fontBuild.stderr);
  await import('./export-brand-logo.mjs');
  await writeFile(join(brand, 'vector-report.json'), `${JSON.stringify({ tool: 'Potrace 1.16', supersampling: scale, note: 'Flat-color contours, not raster texture. IoU measures alpha silhouettes at source resolution.', assets: reports }, null, 2)}\n`);
  console.log(JSON.stringify(reports, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
