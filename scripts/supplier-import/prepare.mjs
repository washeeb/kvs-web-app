// Prepares a KingsView product import from the supplier lists (Bridge Technologies, Compu), read from the
// workbooks as JSON (see read-xlsx.mjs). Keeps the "core range", maps supplier categories onto the KingsView
// tree, normalises brands, and downloads and resizes the pictures (WebP 320 and 800 px).
//
//   node scripts/supplier-import/prepare.mjs <bridge.json> <compu.json> <out dir> [--no-images]
//
// The output folder (products.json + media/) is uploaded to the server and loaded with
//   node ops/import-products.mjs <folder> <staff e-mail>
// Nothing here is committed with the data: supplier lists stay outside the repository.
import sharp from "sharp";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [bridgeFile, compuFile, outDir] = process.argv.slice(2);
const noImages = process.argv.includes("--no-images");
if (!bridgeFile || !compuFile || !outDir) {
  console.error("Usage: node scripts/supplier-import/prepare.mjs <bridge.json> <compu.json> <out dir> [--no-images]");
  process.exit(1);
}

// ---------- KingsView category tree for the import (parent slug → children) ----------
export const TREE = {
  cctv: { name: "CCTV cameras & recorders", existing: true, children: { "ip-cameras": ["IP cameras", "CAM"], "ptz-cameras": ["PTZ cameras", "PTZ"], "turbo-hd-cameras": ["Turbo HD cameras", "THD"], recorders: ["Recorders (NVR & DVR)", "REC"], "cctv-kits": ["CCTV kits", "KIT"], "cctv-accessories": ["CCTV accessories", "CAC"], "video-intercom": ["Video intercom", "INT"] } },
  "alarms-access-control": { name: "Alarms & access control", skuCode: "ALM", serviceLine: "cctv-installation", children: { "wireless-alarms": ["Wireless alarms", "WAL"], "wired-alarms": ["Wired alarms & detectors", "WDA"], "access-control": ["Access control", "ACS"] } },
  networking: { name: "Networking & IT supplies", existing: true, children: { switches: ["Switches", "SWI"], routers: ["Routers", "RTR"], "wireless-access-points": ["Wireless & access points", "WLS"], antennas: ["Antennas", "ANT"], "network-cables-accessories": ["Cables & accessories", "CBL"], storage: ["Storage & NAS", "STO"], "ups-power": ["UPS & power", "UPS"], "ip-phones": ["IP phones & PBX", "VOI"] } },
  "computers-accessories": { name: "Computers & accessories", existing: true, children: { laptops: ["Laptops", "LAP"], "desktops-all-in-ones": ["Desktops & all-in-ones", "DSK"], "monitors-displays": ["Monitors & displays", "MON"], "pos-equipment": ["POS equipment", "POS"], "computer-accessories-software": ["Accessories & software", "CPA"] } },
  "printers-ink": { name: "Printers, toner & ink", skuCode: "PRT", serviceLine: "tech-networking-it-supplies", children: { "printers-scanners": ["Printers & scanners", "PRN"], toner: ["Toner & drums", "TON"], ink: ["Ink & printheads", "INK"] } },
};

// Supplier category → KingsView sub-category slug. Anything not listed is outside the core range and skipped.
export const MAP = {
  // CCTV
  "Network Cameras": "ip-cameras", "Solar Powered Series": "ip-cameras", "PT/PTZ Cameras": "ptz-cameras", "Turbo HD Cameras": "turbo-hd-cameras",
  "Network Video Recorders": "recorders", DVR: "recorders", "Video recorders": "recorders", Kits: "cctv-kits", "CCTV kits": "cctv-kits",
  "CCTV Accessories": "cctv-accessories", "Peripheral Products": "cctv-accessories",
  "IP Video Intercom": "video-intercom", "Video Intercom Kits": "video-intercom", "Video Intercom Accessories": "video-intercom", "4-Wire Series": "video-intercom", "2-Wire Series": "video-intercom", "Emergency Intercom": "video-intercom", "SIP-Phone": "video-intercom",
  // Alarms & access control
  "Wireless Alarm": "wireless-alarms", "Wired Alarms": "wired-alarms", Detectors: "wired-alarms", "Alarm Cables": "wired-alarms",
  "Access Control Readers": "access-control", "Access Control Controllers": "access-control", "Access Control Accessories": "access-control", "Access Control Kits": "access-control", "Card Terminals": "access-control", "FingerPrint Terminals": "access-control", "Face Recognition Terminals": "access-control", "Visitor Terminals": "access-control", "Electrical Locks": "access-control", "Gate Opener": "access-control", "Access control": "access-control",
  // Networking
  Switches: "switches", "Access Switches": "switches", "Aggregation Switches": "switches", "Network switches": "switches",
  "Ethernet Routers": "routers", RouterBOARD: "routers", "Access Routers": "routers", "Home Routers": "routers", Routers: "routers", "LTE Products": "routers",
  "Wireless Systems": "wireless-access-points", "Wireless for home and office": "wireless-access-points", "Outdoor Access Points (AP)": "wireless-access-points", "Indoor Access Points (AP)": "wireless-access-points", "Access Points": "wireless-access-points", "Wifi Extender": "wireless-access-points", "Wireless bridges": "wireless-access-points", "Point to Point": "wireless-access-points", "Mimosa Series 5 PTP": "wireless-access-points", "Mimosa Series 5 PTM": "wireless-access-points", "Mimosa Series 6 PTM": "wireless-access-points", "Mimosa Series 6 PTP": "wireless-access-points",
  "Symmetrical Horn": "antennas", "Asymmetrical Horn": "antennas", "Array Sector": "antennas", UltraDish: "antennas", StarterDish: "antennas", StarterHorn: "antennas", UltraHorn: "antennas", "TwistPort Adaptor": "antennas", StarterAdaptor: "antennas", Antennas: "antennas",
  Accessories: "network-cables-accessories", "Copper Cables": "network-cables-accessories", "Fiber Cables": "network-cables-accessories", Cabling: "network-cables-accessories", "Wall Plates": "network-cables-accessories",
  Storages: "storage", "NAS Drives": "storage", "NAS enclosures": "storage", "Hard drives": "storage", "Solid-state drives": "storage",
  "Online UPS": "ups-power", "Back-up type UPS": "ups-power", UPS: "ups-power", "Power supplies": "ups-power", Chargers: "ups-power",
  "IP phones": "ip-phones", "IP phone accessories": "ip-phones", "IP PBX systems": "ip-phones",
  // Computers
  Laptops: "laptops", "Desktop computers": "desktops-all-in-ones", "All-in-one computers": "desktops-all-in-ones",
  Monitors: "monitors-displays", Projectors: "monitors-displays", "WonderHub Interactive Display": "monitors-displays",
  "POS terminals": "pos-equipment", "Barcode scanners": "pos-equipment", "Receipt printers": "pos-equipment", "Label printers": "pos-equipment",
  Webcams: "computer-accessories-software", "USB hubs & docks": "computer-accessories-software", "Security software": "computer-accessories-software",
  // Printers
  Printers: "printers-scanners", "Multifunction printers": "printers-scanners", "Document scanners": "printers-scanners",
  "Toner cartridges": "toner", "Imaging drums": "toner", "Ink supplies": "ink", Printheads: "ink",
};

const BRANDS = { APPLE: "Apple", LENOVO: "Lenovo", DELL: "Dell", BIRCH: "Birch", BRICH: "Birch", HIKVISION: "Hikvision", Mikrotik: "MikroTik", SEAGATE: "Seagate", "WESTERN DIGITAL": "Western Digital", SYNOLOGY: "Synology", SAMSUNG: "Samsung", CANON: "Canon", TECNO: "Tecno", TRENDNET: "TRENDnet", GRANDSTREAM: "Grandstream", AMAZON: "Amazon", HUAWEI: "Huawei", MICROSOFT: "Microsoft", BLUTEK: "Blutek" };
const brand = (b) => (b && b !== "Not listed" ? BRANDS[b] ?? b : null);
const childParent = Object.fromEntries(Object.entries(TREE).flatMap(([p, t]) => Object.keys(t.children).map((c) => [c, p])));
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const rows = (file, sheet) => {
  const all = JSON.parse(readFileSync(file, "utf8"))[sheet] ?? [];
  return all.slice(1);
};

// ---------- products ----------
const products = [];
const skipped = {};
const seen = new Set();
function add(supplier, r, extra) {
  const cat = MAP[clean(r.D)];
  if (!cat) return void (skipped[clean(r.D)] = (skipped[clean(r.D)] ?? 0) + 1);
  const name = clean(r.A);
  if (!name || seen.has(name.toLowerCase())) return;
  seen.add(name.toLowerCase());
  products.push({ supplier, name, description: clean(r.B) || null, brand: brand(clean(r.C)), category: cat, parent: childParent[cat], ...extra });
}
for (const r of rows(bridgeFile, "Products")) add("Bridge Technologies", r, { variants: [{ name: "Standard", supplierCode: null }], images: [] });
const compuVariants = rows(compuFile, "Variants");
for (const r of rows(compuFile, "Products")) {
  const vs = compuVariants.filter((v) => clean(v.A) === clean(r.A)).map((v) => ({ name: clean(v.B) || "Standard", supplierCode: clean(v.C) && clean(v.C) !== "Not listed" ? clean(v.C) : null }));
  add("Compu", r, { variants: vs.length ? vs : [{ name: "Standard", supplierCode: null }], images: [] });
}

// ---------- pictures: main first, then up to two more; Compu pictures only when the file name fits the product ----------
const words = (s) => new Set(clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3 && !["the", "and", "for", "with", "inch", "series", "original", "jpg", "png", "webp", "jpeg"].includes(w)));
// File names that name another brand or product type are wrong pictures (seen in the Compu list: a toner shown
// with "Hikvisioncamera…", a laptop with "MIDEA…", a UPS with "lg_tv…").
const FOREIGN = ["hikvision", "hikvisioncamera", "camera", "midea", "lg", "tv", "birch", "pos", "hp", "dell", "lenovo", "apple", "mac", "samsung", "canon", "epson", "apc", "toner", "laptop", "printer", "monitor", "ups"];
function plausible(p, url) {
  const file = decodeURIComponent(url.split("/").pop().split("?")[0]).toLowerCase().replace(/\.(jpe?g|png|webp)$/, "");
  const fileWords = file.replace(/[^a-z0-9]+/g, " ").replace(/([a-z])(\d)/g, "$1 $2").split(" ").filter(Boolean);
  const own = words(p.name + " " + (p.brand ?? "") + " " + p.variants.map((v) => v.supplierCode ?? "").join(" ") + " " + (p.category ?? ""));
  const ownText = (p.name + " " + (p.brand ?? "") + " " + p.variants.map((v) => v.supplierCode ?? "").join(" ")).toLowerCase();
  // Another brand or product type named in the file, and not in this product's name: wrong picture.
  if (fileWords.some((w) => FOREIGN.includes(w) && !ownText.includes(w) && !(w === "mac" && /macbook|imac/.test(ownText)))) return false;
  // Otherwise accept when a file word and a product word share a stem of 3+ letters (apc2 ~ apc, mack ~ macbook).
  return fileWords.some((w) => w.length >= 3 && [...own].some((x) => x.slice(0, 3) === w.slice(0, 3)));
}
const review = [];
for (const [supplier, file, urlCol] of [["Bridge Technologies", bridgeFile, "D"], ["Compu", compuFile, "E"]]) {
  const imgs = rows(file, "Images");
  for (const p of products.filter((x) => x.supplier === supplier)) {
    const urls = imgs.filter((i) => clean(i.A) === p.name).sort((x, y) => Number(x.B) - Number(y.B)).map((i) => clean(i[urlCol])).filter((u) => /^https:\/\//.test(u));
    const unique = [...new Set(urls)].slice(0, 3);
    for (const u of unique) {
      if (supplier === "Compu" && !plausible(p, u)) review.push({ product: p.name, url: u });
      else p.images.push({ url: u });
    }
  }
}

// ---------- download and resize ----------
mkdirSync(path.join(outDir, "media"), { recursive: true });
const cacheDir = path.join(outDir, "cache");
mkdirSync(cacheDir, { recursive: true });
async function fetchImage(url) {
  const key = createHash("sha1").update(url).digest("hex");
  const cached = path.join(cacheDir, key);
  if (existsSync(cached)) return readFileSync(cached);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "KingsView catalogue import (info@kingsviewsolutions.com)" }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(cached, buf);
      return buf;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}
const failed = [];
let done = 0;
if (!noImages) {
  const jobs = products.flatMap((p) => p.images.map((img) => ({ p, img })));
  const run = async ({ img }) => {
    try {
      const buf = await fetchImage(img.url);
      const id = createHash("sha1").update(img.url).digest("hex").slice(0, 16);
      const dir = path.join(outDir, "media", id);
      mkdirSync(dir, { recursive: true });
      for (const w of [320, 800]) {
        if (!existsSync(path.join(dir, `${w}.webp`))) {
          // White background for transparent product shots; never enlarge a small original.
          await sharp(buf).flatten({ background: "#ffffff" }).resize({ width: w, height: w, fit: "inside", withoutEnlargement: true }).webp({ quality: w === 320 ? 72 : 80 }).toFile(path.join(dir, `${w}.webp`));
        }
      }
      img.file = id;
    } catch (e) {
      failed.push({ url: img.url, error: String(e.message ?? e) });
    }
    if (++done % 100 === 0) console.log(`  pictures ${done}/${jobs.length}`);
  };
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await run(queue.shift()); }));
  for (const p of products) p.images = p.images.filter((i) => i.file).map((i) => ({ file: i.file }));
}

const counts = {};
for (const p of products) counts[p.category] = (counts[p.category] ?? 0) + 1;
writeFileSync(path.join(outDir, "products.json"), JSON.stringify({ tree: TREE, products }, null, 1));
writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ products: products.length, bySubCategory: counts, skippedSupplierCategories: skipped, compuPicturesToReview: review, failedDownloads: failed }, null, 1));
console.log(`${products.length} products prepared (${products.filter((p) => p.images.length).length} with pictures). Skipped categories: ${Object.keys(skipped).length}. Compu pictures held back for review: ${review.length}. Failed downloads: ${failed.length}.`);
