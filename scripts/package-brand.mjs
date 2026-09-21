import { access, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const brand = resolve(dirname(fileURLToPath(import.meta.url)), '../public/brand');
const files = [
  'index.html', 'brand.css', 'brand.js', 'tokens.css',
  'GUIDELINES.md', 'ASSETS.md', 'generation-prompts.json', 'brand-preview.png', 'vector-report.json', 'wordmark-spec.json',
  'logo-reporta-approved-transparent.png', 'logo-reporta.png', 'logo-reporta.svg',
  'logo-reporta-1529.png', 'logo-reporta-380.png', 'logo-reporta-190.png', 'logo-reporta-on-dark.png', 'logo-reporta-dark.svg', 'logo-reporta-dark.png', 'snake-reporta.svg',
  'mark-reporta.png', 'mark-reporta.svg', 'favicon.svg',
  'favicon-16.png', 'favicon-32.png', 'favicon-180.png', 'favicon-512.png',
  'illustrations', 'photography', 'icons', 'fonts', 'sources', 'type-study', 'head-study', 'logo-reporta-approved.png',
];
for (const file of files) await access(join(brand, file));
const temporary = await mkdtemp(join(tmpdir(), 'reporta-kit-'));
try {
  const archive = join(temporary, 'reporta-brand-kit.zip');
  const result = spawnSync('zip', ['-q', '-r', '-X', archive, ...files], { cwd: brand, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `zip exited ${result.status}`);
  await copyFile(archive, join(brand, 'reporta-brand-kit.zip'));
  const illustrations = join(temporary, 'reporta-illustrations.zip');
  const artResult = spawnSync('zip', ['-q', '-r', '-X', illustrations, 'illustrations/light', 'illustrations/dark', 'illustrations/catalog.json', 'illustrations/README.md'], { cwd: brand, encoding: 'utf8' });
  if (artResult.error) throw artResult.error;
  if (artResult.status !== 0) throw new Error(artResult.stderr || `zip exited ${artResult.status}`);
  await copyFile(illustrations, join(brand, 'reporta-illustrations.zip'));
  console.log('Created public/brand/reporta-brand-kit.zip from canonical assets.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
