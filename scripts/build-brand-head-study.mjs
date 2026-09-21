import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DOMParser } from 'linkedom';
import sharp from 'sharp';

const brand = resolve(dirname(fileURLToPath(import.meta.url)), '../public/brand');
const output = join(brand, 'head-study');
await mkdir(output, { recursive: true });
const master = await readFile(join(brand, 'logo-reporta.svg'), 'utf8');
const document = new DOMParser().parseFromString(master, 'image/svg+xml');
const head = '<path fill="#FF462A" d="M1348 188 C1372 188 1380 174 1402 168 C1426 161 1458 165 1478 177 C1497 188 1500 208 1486 223 C1471 239 1446 240 1421 234 C1397 228 1384 225 1348 225 Z"/>';
const eye = (x, y, rx, ry, dx = 0, dy = 0, pupil = 7) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#FFFFFF"/><ellipse cx="${x + dx}" cy="${y + dy}" rx="${pupil}" ry="${Math.min(pupil, ry - 2)}" fill="#00B8EC"/>`;
const mouth = d => `<path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round"/>`;
const variants = [
  { id: 'curious', title: 'Любопытная', note: 'Разный размер глаз, взгляд вперёд и чуть вверх. Мой выбор для основного знака.', face: eye(1418, 190, 13, 15, 3, -2) + eye(1455, 193, 15, 17, 3, -2) },
  { id: 'happy', title: 'Довольная', note: 'Прищур и короткая улыбка. Для удачного результата и готового выпуска.', face: eye(1419, 191, 14, 10, 1, -1, 6) + eye(1456, 191, 14, 10, 1, -1, 6) + mouth('M1430 215 Q1440 225 1452 214') },
  { id: 'surprised', title: 'Удивлённая', note: 'Большие открытые глаза и маленькое «о». Для неожиданной находки.', face: eye(1418, 188, 15, 17, 1, 0, 6) + eye(1457, 189, 15, 17, 1, 0, 6) + '<ellipse cx="1439" cy="219" rx="5" ry="6" fill="#FFFFFF"/>' },
  { id: 'ironic', title: 'Ироничная', note: 'Один глаз прищурен, улыбка асимметричная. Для редакционной иронии.', face: eye(1418, 189, 14, 16, 3, 1) + eye(1457, 197, 14, 8, 3, 0, 6) + mouth('M1435 219 Q1447 222 1456 214') },
  { id: 'focused', title: 'Сосредоточенная', note: 'Узкие глаза и уверенный взгляд вперёд. Для поиска и отбора.', face: '<path fill="#FFFFFF" d="M1404 186 L1432 192 Q1433 204 1419 205 Q1405 203 1404 186 Z M1443 192 L1471 186 Q1470 203 1456 205 Q1442 204 1443 192 Z"/><ellipse cx="1422" cy="197" rx="6" ry="6" fill="#00B8EC"/><ellipse cx="1460" cy="197" rx="6" ry="6" fill="#00B8EC"/>' },
  { id: 'calm', title: 'Спокойная', note: 'Мягкий взгляд и едва заметная улыбка. Для повседневного присутствия.', face: eye(1419, 195, 14, 11, 0, 2, 6) + eye(1456, 195, 14, 11, 0, 2, 6) + mouth('M1433 219 Q1441 223 1449 219') },
];

for (const variant of variants) {
  const face = head + variant.face;
  const svg = document.querySelector('svg').cloneNode(true);
  const body = svg.querySelector('#snake > path').cloneNode(true);
  const faceDocument = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${face}</svg>`, 'image/svg+xml');
  for (const group of [svg.querySelector('#snake'), svg.querySelector('g[clip-path]')]) {
    group.replaceChildren(body.cloneNode(true), ...[...faceDocument.documentElement.children].map(el => el.cloneNode(true)));
  }
  const logo = svg.outerHTML;
  const isolated = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="1335 145 175 105" width="350" height="210" role="img"><title>${variant.title}</title>${face}</svg>`;
  for (const [name, svg] of [[variant.id, isolated], [`${variant.id}-logo`, logo], [`${variant.id}-logo-dark`, logo.replace('fill="#080808"', 'fill="#F5F5F2"')]]) {
    await writeFile(join(output, `${name}.svg`), svg);
    await sharp(Buffer.from(svg)).png().toFile(join(output, `${name}.png`));
  }
}

const cards = variants.map((v, i) => `<article><div class="heading"><span class="number">0${i + 1}</span><h2>${v.title}</h2></div><div class="head"><img src="./${v.id}.svg" alt="${v.title} голова"></div><img class="logo" data-variant="${v.id}" src="./${v.id}-logo.svg" alt="${v.title} змейка в логотипе Reporta"><p>${v.note}</p><div class="downloads"><a href="./${v.id}.svg" download>Голова SVG</a><a data-download="${v.id}" href="./${v.id}-logo.svg" download>Логотип SVG</a><a data-png="${v.id}" href="./${v.id}-logo.png" download>PNG</a></div></article>`).join('');
await writeFile(join(output, 'index.html'), `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporta / Выражения головы</title><link rel="stylesheet" href="../fonts/fonts.css"><style>
*{box-sizing:border-box;letter-spacing:0}body{margin:0;--bg:#fff;--fg:#171716;--muted:#62625c;--line:#dadad6;background:var(--bg);color:var(--fg);font:15px/1.5 Inter,Arial,sans-serif}body.dark{--bg:#171716;--fg:#f5f5f2;--muted:#b4b4ac;--line:#454540}main{max-width:1280px;margin:auto;padding:28px 24px}header{padding-bottom:24px;border-bottom:1px solid var(--line)}nav{display:flex;align-items:center;justify-content:space-between;gap:16px}a{color:inherit;text-underline-offset:4px}h1{font-size:28px;line-height:1.2;margin:24px 0 10px}header p{max-width:72ch;margin:0;color:var(--muted)}.controls{display:flex;gap:4px}button{width:40px;height:40px;display:grid;place-items:center;border:1px solid var(--line);background:transparent;border-radius:4px;cursor:pointer}button[aria-pressed=true]{background:#d8f4fb;border-color:#00b8ec}button img{width:20px;height:20px}.dark button:not([aria-pressed=true]) img{filter:invert(1)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 28px;margin-top:8px}article{min-width:0;padding:24px 0;border-bottom:1px solid var(--line)}.heading{display:flex;align-items:center;gap:12px}h2{font-size:18px;margin:0}.number{color:var(--muted);font-size:13px}.head{height:150px;display:grid;place-items:center}.head img{width:230px;height:138px;max-width:100%}.logo{display:block;width:100%;aspect-ratio:1529/434;object-fit:contain}article p{font-size:13px;min-height:60px;color:var(--muted);margin:14px 0}.downloads{display:flex;flex-wrap:wrap;gap:14px;font-size:12px}footer{padding:28px 0;display:flex;flex-wrap:wrap;gap:20px}.reference{border-top:1px solid var(--line);padding-top:24px}.reference img{width:min(100%,760px);height:auto;display:block;margin-top:16px}@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){main{padding:20px 16px}h1{font-size:24px}.grid{grid-template-columns:1fr}article p{min-height:0}.head{height:140px}}
</style></head><body><main><header><nav><a href="../index.html#identity">К брендбуку</a><div class="controls" aria-label="Фон"><button data-theme="light" aria-pressed="true" title="Светлая тема" aria-label="Светлая тема"><img src="../icons/sun.svg" alt=""></button><button data-theme="dark" aria-pressed="false" title="Тёмная тема" aria-label="Тёмная тема"><img src="../icons/moon.svg" alt=""></button></div></nav><h1>Reporta / Шесть характеров</h1><p>Вытянутая голова с плавным переходом от тела. Буквы, кернинг и траектория змейки одинаковые во всех вариантах. Текущий логотип пока не заменён.</p></header><section class="grid" aria-label="Варианты головы">${cards}</section><footer><a href="./reporta-head-variants.zip" download>Все варианты: SVG + PNG</a><a href="../type-study/index.html#snake-flow">Предыдущие итерации</a></footer><section class="reference"><h2>Текущий вариант / для сравнения</h2><img id="reference" src="../logo-reporta.svg" alt="Текущий логотип без изменений"></section></main><script>
document.querySelectorAll('[data-theme]').forEach(button=>button.addEventListener('click',()=>{const dark=button.dataset.theme==='dark';document.body.classList.toggle('dark',dark);document.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('[data-variant]').forEach(img=>img.src='./'+img.dataset.variant+'-logo'+(dark?'-dark':'')+'.svg');document.querySelectorAll('[data-download]').forEach(a=>a.href='./'+a.dataset.download+'-logo'+(dark?'-dark':'')+'.svg');document.querySelectorAll('[data-png]').forEach(a=>a.href='./'+a.dataset.png+'-logo'+(dark?'-dark':'')+'.png');document.querySelector('#reference').src='../logo-reporta'+(dark?'-dark':'')+'.svg';}));
</script></body></html>`);
await writeFile(join(output, 'README.md'), '# Reporta head study\n\nSix exploratory vector expressions. The canonical logo is unchanged.\nEach variant includes a transparent head SVG/PNG and light/dark full logo SVG/PNG.\nLettering, kerning and body paths are identical to the master. The new elongated\nhead overlaps the final body segment to remove the abrupt round-head junction.\nRed #FF462A, white #FFFFFF and cyan #00B8EC are unchanged across themes.\n');
const files = variants.flatMap(v => [v.id, `${v.id}-logo`, `${v.id}-logo-dark`].flatMap(name => [`${name}.svg`, `${name}.png`]));
const zip = spawnSync('zip', ['-q', '-X', 'reporta-head-variants.zip', 'README.md', ...files], { cwd: output, encoding: 'utf8' });
if (zip.error) throw zip.error;
if (zip.status !== 0) throw new Error(zip.stderr);
console.log(`Built ${variants.length} head concepts, 36 SVG/PNG exports, and ZIP. Canonical logo untouched.`);
