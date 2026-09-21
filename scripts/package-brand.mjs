import { access, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const brand = resolve(dirname(fileURLToPath(import.meta.url)), '../public/brand');
const files = [
  'index.html', 'brand.css', 'brand.js', 'tokens.css',
  'GUIDELINES.md', 'ASSETS.md', 'generation-prompts.json', 'brand-preview.png',
  'logo-reporta-approved-transparent.png', 'logo-reporta.png', 'logo-reporta.svg',
  'logo-reporta-380.png', 'logo-reporta-190.png', 'logo-reporta-on-dark.png',
  'mark-reporta.png', 'mark-reporta.svg', 'favicon.svg',
  'favicon-16.png', 'favicon-32.png', 'favicon-180.png', 'favicon-512.png',
  'illustrations', 'photography', 'icons', 'fonts',
];
for (const file of files) await access(join(brand, file));
const temporary = await mkdtemp(join(tmpdir(), 'reporta-kit-'));
try {
  const archive = join(temporary, 'reporta-brand-kit.zip');
  const result = spawnSync('zip', ['-q', '-r', '-X', archive, ...files], { cwd: brand, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `zip exited ${result.status}`);
  await copyFile(archive, join(brand, 'reporta-brand-kit.zip'));
  console.log('Created public/brand/reporta-brand-kit.zip from canonical assets.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
