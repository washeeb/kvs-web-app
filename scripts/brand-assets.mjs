// Generates web-ready brand assets from the master files in /logo (copied from KingsView's Identity folder).
// Re-run after replacing a master:  npm run brand:build
import sharp from "sharp";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const SRC = "logo";
const OUT = "src/assets/brand";
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
mkdirSync(OUT, { recursive: true });

const trimmed = (file) => sharp(file).trim().png().toBuffer();

const landscape = await trimmed(`${SRC}/kvs-landscape.png`);
await sharp(landscape).resize({ height: 120 }).png({ compressionLevel: 9 }).toFile(`${OUT}/kvs-landscape.png`);
await sharp(await trimmed(`${SRC}/kvs-stacked.png`)).resize({ width: 560 }).png({ compressionLevel: 9 }).toFile(`${OUT}/kvs-stacked.png`);
const crest = await trimmed(`${SRC}/kvs-crest.png`);
await sharp(crest).resize({ width: 256 }).png({ compressionLevel: 9 }).toFile(`${OUT}/kvs-crest.png`);

// Versions for dark backgrounds: black and grey become white/light grey, and the red is lifted slightly so it
// stays vivid on near-black. Transparency is kept.
async function forDark(file, out) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 48) {
      const v = 255 - Math.round((r + g + b) / 3);
      data[i] = data[i + 1] = data[i + 2] = Math.max(v, 40);
    } else {
      data[i] = Math.min(255, Math.round(r * 1.18 + 24));
      data[i + 1] = Math.min(255, Math.round(g * 1.18 + 18));
      data[i + 2] = Math.min(255, Math.round(b * 1.18 + 18));
    }
  }
  await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toFile(out);
}
for (const name of ["kvs-landscape", "kvs-stacked", "kvs-crest"]) await forDark(`${OUT}/${name}.png`, `${OUT}/${name}-dark.png`);

// App icons (Next.js file conventions in src/app, plus home-screen icons in public/icons).
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
const crestDark = await sharp(`${OUT}/kvs-crest-dark.png`).toBuffer();
const square = async (size, pad, background, art = crest) => {
  const inner = Math.round(size * (1 - pad * 2));
  const fitted = await sharp(art).resize({ width: inner, height: inner, fit: "contain", background: CLEAR }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } }).composite([{ input: fitted, gravity: "center" }]).png({ compressionLevel: 9 });
};
const roundedWhite = async (size, pad) => {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#fff"/></svg>`);
  const art = await (await square(size, pad, CLEAR)).toBuffer();
  return sharp(mask).composite([{ input: art }]).png({ compressionLevel: 9 });
};
rmSync("src/app/icon.png", { force: true });
// Browser tab: the plain crest, switching to the light-on-dark version when the browser uses a dark theme.
const tab = async (art) => (await (await square(64, 0.02, CLEAR, art)).toBuffer()).toString("base64");
writeFileSync(
  "src/app/icon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><style>.d{display:none}@media (prefers-color-scheme:dark){.l{display:none}.d{display:inline}}</style><image class="l" width="64" height="64" href="data:image/png;base64,${await tab(crest)}"/><image class="d" width="64" height="64" href="data:image/png;base64,${await tab(crestDark)}"/></svg>`,
);
// Older browsers: favicon.ico with the crest on a white tile, readable on light and dark tab bars (PNG-in-ICO).
const ico = await Promise.all([16, 32, 48].map(async (n) => (await roundedWhite(n, 0.08)).toBuffer()));
const head = Buffer.alloc(6 + 16 * ico.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(ico.length, 4);
let offset = head.length;
ico.forEach((png, i) => {
  const n = [16, 32, 48][i];
  const e = 6 + i * 16;
  head[e] = n;
  head[e + 1] = n;
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(png.length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
writeFileSync("src/app/favicon.ico", Buffer.concat([head, ...ico]));
await (await square(180, 0.1, WHITE)).toFile("src/app/apple-icon.png");
// Home-screen / install icons: crest on white, and a "maskable" one with safe padding on brand black.
mkdirSync("public/icons", { recursive: true });
await (await roundedWhite(192, 0.08)).toFile("public/icons/icon-192.png");
await (await roundedWhite(512, 0.08)).toFile("public/icons/icon-512.png");
await (await square(512, 0.2, { r: 17, g: 17, b: 17, alpha: 1 }, crestDark)).toFile("public/icons/maskable-512.png");

// Social sharing image (1200x630): landscape logo on white.
const og = await sharp(landscape).resize({ width: 1000 }).toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 4, background: WHITE } }).composite([{ input: og, gravity: "center" }]).png().toFile("src/app/opengraph-image.png");

console.log("Brand assets written to", OUT, "and src/app/{icon.svg,favicon.ico,apple-icon.png,opengraph-image.png}, public/icons");
