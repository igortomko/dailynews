/**
 * Обложки выпуска голосом: 320×320 JPEG из наших иллюстраций.
 *
 * Telegram рисует у аудио серую ноту-заглушку, пока не дашь свою картинку,
 * и берёт он только JPEG не больше 200 КБ и не больше 320 по стороне.
 * Иллюстрации лежат PNG на прозрачности и любых пропорций, поэтому здесь
 * они кладутся на бумагу (`--reporta-paper`) и центрируются в квадрате:
 * плеер показывает обложку квадратом и вписал бы её сам — без полей
 * и обрезав по краям.
 *
 * Светлая тема, а не тёмная: обложка попадает и в тёмный чат, но чёрные
 * чернила на бумаге там узнаются, а белые чернила на светлом фоне исчезли бы.
 *
 * Пересобрать после новой иллюстрации: node scripts/export-podcast-covers.mjs
 */
import { readdir, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SIDE = 320;
// Поле в 8% стороны: иллюстрация, прижатая к краю квадрата, в плеере
// выглядит обрезанной, даже когда цела.
const INSET = Math.round(SIDE * 0.08);
const PAPER = "#f5f5f2";

const brand = resolve(dirname(fileURLToPath(import.meta.url)), "../public/brand");
const from = join(brand, "illustrations/light");
const to = join(brand, "podcast-covers");

await mkdir(to, { recursive: true });
const files = (await readdir(from)).filter((name) => name.endsWith(".png")).sort();
for (const file of files) {
  const id = file.replace(/\.png$/, "");
  const art = await sharp(join(from, file))
    .resize({ width: SIDE - INSET * 2, height: SIDE - INSET * 2, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const { size } = await sharp({
    create: { width: SIDE, height: SIDE, channels: 3, background: PAPER },
  })
    .composite([{ input: art, gravity: "centre" }])
    .jpeg({ quality: 82, chromaSubsampling: "4:4:4" })
    .toFile(join(to, `${id}.jpg`));
  console.log(`${id}.jpg — ${Math.round(size / 1024)} КБ`);
}
console.log(`${files.length} обложек в public/brand/podcast-covers`);
