import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { categories, products, productVariants, suppliers } from "@/server/db/schema";
import { createProduct, listShopProducts } from "@/server/modules/catalogue";
import { listMedia } from "@/server/modules/media";
import { priceCart } from "@/server/modules/shop";
import { createQuote } from "@/server/modules/quotes";
import { createCustomer } from "@/server/modules/customers";
import { importProducts } from "@/server/modules/product-import";

let db: DB;
let close: () => Promise<void>;
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "kvs-import-"));
  process.env.UPLOAD_DIR = path.join(dir, "uploads");
  ({ db, close } = await setupDb());
});
afterAll(async () => {
  await close();
  await rm(dir, { recursive: true, force: true });
});
const as = (email: string) => actorFor(db, email, true);

describe("price on request", () => {
  it("shows without a price, cannot be bought online or quoted from the catalogue, and sorts last", async () => {
    const store = await as("store@kingsview.demo");
    const cat = (await db.select().from(categories).where(eq(categories.slug, "networking")))[0]!;
    const { product, variant } = await createProduct(db, store, { name: "On request router", categoryId: cat.id, status: "active" }, { name: "Standard", priceMinor: null });
    expect(variant.priceMinor).toBeNull();
    const shown = (await listShopProducts(db, { category: "networking", sort: "price-asc" })).filter((p) => !p.isDemo || p.id === product.id);
    expect(shown.at(-1)!.id).toBe(product.id);
    const cart = await priceCart(db, [{ v: variant.id, q: 1 }]);
    expect(cart.ok).toBe(false);
    expect(cart.lines[0]!.problem).toMatch(/on request/);
    const sales = await as("sales@kingsview.demo");
    const customer = await createCustomer(db, sales, { name: "Kofi Mensah", phone: "0240000099" });
    await expect(createQuote(db, sales, { customerId: customer.id, discountBp: 0, lines: [{ variantId: variant.id, quantity: 1 }] })).rejects.toThrow(/no price yet/);
  });
});

describe("supplier product import", () => {
  it("creates categories, suppliers, brands and priced-on-request products with pictures, and skips them next time", async () => {
    const owner = await as("owner@kingsview.demo");
    const src = path.join(dir, "import");
    await mkdir(path.join(src, "media", "0123456789abcdef"), { recursive: true });
    // A small original: its "800" copy is really 600 px wide, as prepare.mjs writes it (never enlarged).
    const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#b00101" } }).png().toBuffer();
    await writeFile(path.join(src, "media", "0123456789abcdef", "320.webp"), await sharp(png).resize({ width: 320 }).webp().toBuffer());
    await writeFile(path.join(src, "media", "0123456789abcdef", "800.webp"), await sharp(png).webp().toBuffer());
    const data = {
      tree: {
        networking: { name: "Networking & IT supplies", existing: true, children: { "test-switches": ["Test switches", "TSW"] } },
        "test-alarms": { name: "Test alarms", skuCode: "TAL", children: { "test-wireless-alarms": ["Wireless alarms", "TWA"] } },
      },
      products: [
        { supplier: "Bridge Technologies", name: "Test 8-port PoE switch", description: "Managed switch for small offices. Eight PoE ports.", brand: "MikroTik", category: "test-switches", parent: "networking", variants: [{ name: "Standard", supplierCode: null }], images: [{ file: "0123456789abcdef" }] },
        { supplier: "Compu", name: "Test wireless alarm kit", description: null, brand: "Hikvision", category: "test-wireless-alarms", parent: "test-alarms", variants: [{ name: "Standard", supplierCode: "DS-TEST-1" }], images: [] },
      ],
    };
    await writeFile(path.join(src, "products.json"), JSON.stringify(data));
    const r = await importProducts(db, owner, src);
    expect(r.problems).toEqual([]);
    expect(r.productsCreated).toBe(2);
    expect(r.categoriesCreated).toEqual(expect.arrayContaining(["Test alarms", "Test alarms › Wireless alarms", "Networking & IT supplies › Test switches"]));
    expect(r.suppliersCreated).toEqual(["Bridge Technologies", "Compu"]);
    expect(r.pictures).toBe(1);

    const [sw] = await db.select().from(products).where(eq(products.name, "Test 8-port PoE switch"));
    expect(sw).toMatchObject({ status: "active", sesSync: false, summary: "Managed switch for small offices." });
    const [v] = await db.select().from(productVariants).where(eq(productVariants.productId, sw!.id));
    expect(v).toMatchObject({ priceMinor: null, tracksStock: false });
    expect(v!.sku).toMatch(/^KV-TSW-\d{5}$/);
    const [bridge] = await db.select().from(suppliers).where(eq(suppliers.name, "Bridge Technologies"));
    expect(v!.preferredSupplierId).toBe(bridge!.id);
    const pics = await listMedia(db, "product", [sw!.id]);
    expect(pics[0]!.widths).toEqual([320, 600]);
    const [kit] = await db.select().from(products).where(eq(products.name, "Test wireless alarm kit"));
    expect(kit!.specs).toEqual([{ name: "Model", value: "DS-TEST-1" }]);

    const again = await importProducts(db, owner, src);
    expect(again).toMatchObject({ productsCreated: 0, productsSkipped: 2, categoriesCreated: [], suppliersCreated: [], pictures: 0 });
  });
});

describe("shop paging", () => {
  it("returns one page at a time with the total, sorts priced items before items on request, and clamps the page", async () => {
    const { searchShopProducts } = await import("@/server/modules/catalogue");
    const all = await searchShopProducts(db, { sort: "price-asc" }, 1000);
    const two = await searchShopProducts(db, { sort: "price-asc", page: 2 }, 2);
    expect(two.total).toBe(all.total);
    expect(two.pages).toBe(Math.ceil(all.total / 2));
    expect(two.items.map((p) => p.id)).toEqual(all.items.slice(2, 4).map((p) => p.id));
    const prices = all.items.map((p) => p.variants.find((v) => v.priceMinor !== null)?.priceMinor ?? null);
    const firstNull = prices.indexOf(null);
    if (firstNull >= 0) expect(prices.slice(firstNull).every((x) => x === null)).toBe(true);
    const priced = prices.filter((x): x is number => x !== null);
    expect([...priced].sort((a, b) => a - b)).toEqual(priced);
    expect((await searchShopProducts(db, { page: 9999 }, 2)).page).toBe(two.pages);
  });
});
