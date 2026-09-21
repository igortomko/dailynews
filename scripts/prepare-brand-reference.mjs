import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const brand = resolve(dirname(fileURLToPath(import.meta.url)), '../public/brand');
const original = await readFile(join(brand, 'logo-reporta-approved.png'));
const { width, height } = await sharp(original).metadata();
const source = `data:image/png;base64,${original.toString('base64')}`;
const image = `<image width="${width}" height="${height}" href="${source}"/>`;
const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
// A luminance mask removes the paper without retracing the approved contours.
const defs = `<defs><filter id="paper" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 -.2126 -.7152 -.0722 0 1"/><feComponentTransfer><feFuncA type="linear" slope="16" intercept="-.5"/></feComponentTransfer></filter><mask id="cutout" mask-type="alpha"><g filter="url(#paper)">${image}</g><ellipse cx="1435" cy="205" rx="16" ry="16" fill="white"/><ellipse cx="1473" cy="203" rx="16" ry="16" fill="white"/></mask><filter id="ink" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 -.2126 -.7152 -.0722 0 1"/><feComponentTransfer><feFuncA type="linear" slope="5" intercept="-3.8"/></feComponentTransfer></filter><mask id="letters" mask-type="alpha"><g filter="url(#ink)">${image}</g></mask></defs>`;
const lightSvg = `${open}${defs}<g mask="url(#cutout)">${image}</g></svg>`;
const darkSvg = `${open}${defs}<g mask="url(#cutout)">${image}<rect width="100%" height="100%" fill="#F5F5F2" mask="url(#letters)"/></g></svg>`;
const light = await sharp(Buffer.from(lightSvg)).png().toBuffer();
const dark = await sharp(Buffer.from(darkSvg)).png().toBuffer();

await writeFile(join(brand, 'logo-reporta-approved-transparent.png'), light);
await writeFile(join(brand, 'logo-reporta-dark.png'), dark);
for (const [file, svg] of [['logo-reporta.svg', lightSvg], ['logo-reporta-dark.svg', darkSvg]]) {
  await writeFile(join(brand, file), `${svg}\n`);
}
for (const size of [760, 380, 190]) {
  await sharp(light).resize({ width: size }).png().toFile(join(brand, size === 760 ? 'logo-reporta.png' : `logo-reporta-${size}.png`));
}
await sharp(dark).flatten({ background: '#171716' }).png().toFile(join(brand, 'logo-reporta-on-dark.png'));

const { data, info } = await sharp(light).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
for (const [x, y] of [[0, 0], [1500, 145], [1360, 170], [1510, 280], [270, 80]]) {
  assert.equal(pixel(x, y)[3], 0, `Paper remains at ${x},${y}`);
}
assert.equal(pixel(1435, 193)[3], 255, 'Eye white must remain opaque');
assert.equal(pixel(1473, 191)[3], 255, 'Eye white must remain opaque');
console.log(JSON.stringify({ width, height, transparentPaper: true, eyeWhitesPreserved: true, contourRedrawn: false }));
