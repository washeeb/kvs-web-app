// Generates web-ready brand assets from the master files in /logo (copied from KingsView's Identity folder).
// Re-run after replacing a master:  npm run brand:build
import sharp from "sharp";
import { mkdirSync } from "node:fs";

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

// App icons (Next.js file conventions in src/app).
const square = async (size, pad, background) => {
  const inner = Math.round(size * (1 - pad * 2));
  const art = await sharp(crest).resize({ width: inner, height: inner, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } }).composite([{ input: art, gravity: "center" }]).png();
};
await (await square(512, 0.04, { r: 0, g: 0, b: 0, alpha: 0 })).toFile("src/app/icon.png");
await (await square(180, 0.1, WHITE)).toFile("src/app/apple-icon.png");

// Social sharing image (1200x630): landscape logo on white.
const og = await sharp(landscape).resize({ width: 1000 }).toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 4, background: WHITE } }).composite([{ input: og, gravity: "center" }]).png().toFile("src/app/opengraph-image.png");

console.log("Brand assets written to", OUT, "and src/app/{icon,apple-icon,opengraph-image}.png");
