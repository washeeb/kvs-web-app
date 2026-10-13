import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { brands, categories, products, productVariants, sequences, tags, productTags } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, notFound } from "../lib/errors";
import { slugify } from "../lib/slug";
import { audit } from "./audit";
import { publish } from "./events";
import { computeAvailability, levelsForVariants, type Availability } from "./inventory";
import { queueProductSync } from "./ses-link";
import { listMedia, mainImages } from "./media";
import { categoryAndChildren, parseSpecs, setProductTags, tagsForProducts } from "./taxonomy";

/** Short category codes used in SKUs; other categories use the first three letters of their slug. */
const SKU_CATEGORY_CODES: Record<string, string> = {
  "computers-accessories": "CMP",
  networking: "NET",
  cctv: "CTV",
  "office-supplies": "OFF",
  "souvenirs-promotional": "PRO",
};

export function skuCategoryCode(categorySlug: string | null | undefined) {
  if (!categorySlug) return "GEN";
  return SKU_CATEGORY_CODES[categorySlug] ?? (categorySlug.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase().padEnd(3, "X"));
}

/**
 * Assigns the next SKU, e.g. KV-NET-00012. One counter for all categories, so the number alone is unique and a SKU
 * stays valid if the product later moves category. Runs inside the caller's transaction (the counter row is locked
 * until it commits, so two staff saving at once get different numbers). SKUs never change once assigned.
 */
export async function nextSku(db: DB, categoryId: string | null | undefined) {
  const [cat] = categoryId ? await db.select({ slug: categories.slug, skuCode: categories.skuCode }).from(categories).where(eq(categories.id, categoryId)) : [];
  const code = cat?.skuCode || skuCategoryCode(cat?.slug);
  for (let attempt = 0; attempt < 20; attempt++) {
    const [row] = await db
      .insert(sequences)
      .values({ key: "SKU", value: 1 })
      .onConflictDoUpdate({ target: sequences.key, set: { value: sql`${sequences.value} + 1` } })
      .returning();
    const sku = `KV-${code}-${String(row!.value).padStart(5, "0")}`;
    const [clash] = await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, sku));
    if (!clash) return sku;
  }
  throw conflict("Could not assign a free SKU. Try again.");
}

export async function listCategories(db: DB) {
  return db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
}

export interface ShopVariant {
  id: string;
  sku: string;
  name: string;
  priceMinor: number;
  currency: string;
  tracksStock: boolean;
  availability: Availability;
}

async function attachVariants(db: DB, productIds: string[], onlyActive = true) {
  const map = new Map<string, ShopVariant[]>();
  if (productIds.length === 0) return map;
  const variants = await db
    .select()
    .from(productVariants)
    .where(and(inArray(productVariants.productId, productIds), onlyActive ? eq(productVariants.active, true) : undefined))
    .orderBy(asc(productVariants.priceMinor));
  const levels = await levelsForVariants(db, variants.map((v) => v.id));
  for (const v of variants) {
    map.set(v.productId, [
      ...(map.get(v.productId) ?? []),
      { id: v.id, sku: v.sku, name: v.name, priceMinor: v.priceMinor, currency: v.currency, tracksStock: v.tracksStock, availability: computeAvailability(levels.filter((l) => l.variantId === v.id), v.tracksStock) },
    ]);
  }
  return map;
}

export type ShopSort = "name" | "price-asc" | "price-desc" | "newest";

/** Public shop: active products with at least one active option, filtered by search, category (with its sub-categories), brand or tag. */
export async function listShopProducts(db: DB, filter: { q?: string; category?: string; brand?: string; tag?: string; sort?: ShopSort } = {}) {
  const conds = [eq(products.status, "active")];
  if (filter.q) {
    const q = `%${filter.q.replace(/[%_\\]/g, "\\$&").slice(0, 80)}%`;
    // Matches names, summaries, SKUs and brand names.
    const skuHits = db.select({ id: productVariants.productId }).from(productVariants).where(ilike(productVariants.sku, q));
    conds.push(or(ilike(products.name, q), ilike(products.summary, q), ilike(brands.name, q), inArray(products.id, skuHits))!);
  }
  if (filter.category) {
    const [cat] = await db.select().from(categories).where(eq(categories.slug, filter.category));
    conds.push(cat ? inArray(products.categoryId, await categoryAndChildren(db, cat.id)) : sql`false`);
  }
  if (filter.brand) {
    const [b] = await db.select().from(brands).where(eq(brands.slug, filter.brand));
    conds.push(b ? eq(products.brandId, b.id) : sql`false`);
  }
  if (filter.tag) {
    const tagged = db.select({ id: productTags.productId }).from(productTags).innerJoin(tags, eq(tags.id, productTags.tagId)).where(eq(tags.slug, filter.tag));
    conds.push(inArray(products.id, tagged));
  }
  const rows = await db
    .select({ product: products, categoryName: categories.name, categorySlug: categories.slug, brandName: brands.name, brandSlug: brands.slug })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(and(...conds))
    .orderBy(filter.sort === "newest" ? desc(products.createdAt) : asc(products.name));
  const ids = rows.map((r) => r.product.id);
  const [variants, images] = await Promise.all([attachVariants(db, ids), mainImages(db, "product", ids)]);
  const list = rows
    .map((r) => ({ ...r.product, categoryName: r.categoryName, categorySlug: r.categorySlug, brandName: r.brandName, brandSlug: r.brandSlug, image: images.get(r.product.id) ?? null, variants: variants.get(r.product.id) ?? [] }))
    .filter((p) => p.variants.length > 0);
  if (filter.sort === "price-asc") list.sort((a, b) => a.variants[0]!.priceMinor - b.variants[0]!.priceMinor);
  if (filter.sort === "price-desc") list.sort((a, b) => b.variants[0]!.priceMinor - a.variants[0]!.priceMinor);
  return list;
}

export async function getShopProduct(db: DB, slug: string) {
  const [row] = await db
    .select({ product: products, categoryName: categories.name, categorySlug: categories.slug, brandName: brands.name, brandSlug: brands.slug })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(and(eq(products.slug, slug), eq(products.status, "active")));
  if (!row) return null;
  const [variants, images, tagMap] = await Promise.all([attachVariants(db, [row.product.id]), listMedia(db, "product", [row.product.id]), tagsForProducts(db, [row.product.id])]);
  const v = variants.get(row.product.id) ?? [];
  return v.length
    ? { ...row.product, categoryName: row.categoryName, categorySlug: row.categorySlug, brandName: row.brandName, brandSlug: row.brandSlug, images, tags: tagMap.get(row.product.id) ?? [], variants: v }
    : null;
}

// ───────────────────────────── Management ─────────────────────────────

export async function listProductsAdmin(db: DB, actor: Actor, q?: string) {
  authorize(actor, "catalogue.read");
  const where = q ? or(ilike(products.name, `%${q.replace(/[%_\\]/g, "\\$&").slice(0, 80)}%`)) : undefined;
  const rows = await db
    .select({ product: products, categoryName: categories.name, brandName: brands.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(where)
    .orderBy(desc(products.updatedAt))
    .limit(500);
  const ids = rows.map((r) => r.product.id);
  const [variants, images] = await Promise.all([attachVariants(db, ids, false), mainImages(db, "product", ids)]);
  return rows.map((r) => ({ ...r.product, categoryName: r.categoryName, brandName: r.brandName, image: images.get(r.product.id) ?? null, variants: variants.get(r.product.id) ?? [] }));
}

export async function getProductAdmin(db: DB, actor: Actor, id: string) {
  authorize(actor, "catalogue.read");
  const [product] = await db.select().from(products).where(eq(products.id, id));
  if (!product) throw notFound("Product not found.");
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, id)).orderBy(asc(productVariants.sku));
  const [levels, images, tagMap] = await Promise.all([levelsForVariants(db, variants.map((v) => v.id)), listMedia(db, "product", [id]), tagsForProducts(db, [id])]);
  return {
    product,
    images,
    tags: tagMap.get(id) ?? [],
    variants: variants.map((v) => {
      const ls = levels.filter((l) => l.variantId === v.id);
      return { ...v, levels: ls, onHand: ls.reduce((a, l) => a + l.onHand, 0), reserved: ls.reduce((a, l) => a + l.reserved, 0), availability: computeAvailability(ls, v.tracksStock, v.reorderPoint ?? undefined) };
    }),
  };
}

const RESERVED_SLUGS = new Set(["cart", "checkout", "order"]);

export const productInput = z.object({
  name: z.string().trim().min(3).max(160),
  summary: z.string().trim().max(300).optional().default(""),
  description: z.string().trim().max(5000).optional().default(""),
  categoryId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  /** One "Name: value" per line. */
  specsText: z.string().max(10_000).optional().default(""),
  /** Comma-separated tag names; new tags are created. */
  tagsText: z.string().max(1000).optional().default(""),
  status: z.enum(["draft", "active", "retired"]).default("draft"),
  sesSync: z.boolean().default(false),
});

async function productValues(tx: DB, p: z.output<typeof productInput>) {
  if (p.brandId) {
    const [b] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, p.brandId));
    if (!b) throw notFound("Unknown brand.");
  }
  const { specsText, tagsText: _tags, ...rest } = p;
  return { ...rest, summary: p.summary || null, description: p.description || null, categoryId: p.categoryId ?? null, brandId: p.brandId ?? null, specs: parseSpecs(specsText) };
}

const money = z.number().int().min(0).max(100_000_000_000);
export const variantInput = z.object({
  /** Normally left out: the system assigns the next SKU (see nextSku). */
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,40}$/, "SKU: 3–41 capital letters, digits or dashes.").optional(),
  name: z.string().trim().min(1).max(120),
  priceMinor: money,
  costMinor: money.nullable().optional(),
  currency: z.string().length(3).default("GHS"),
  taxable: z.boolean().default(true),
  tracksStock: z.boolean().default(true),
  active: z.boolean().default(true),
});

export async function createProduct(db: DB, actor: Actor, input: z.input<typeof productInput>, firstVariant: z.input<typeof variantInput>) {
  authorize(actor, "catalogue.write");
  const p = productInput.parse(input);
  const v = variantInput.parse(firstVariant);
  const created = await db.transaction(async (tx) => {
    let slug = slugify(p.name) || "product";
    const [clash] = await tx.select({ id: products.id }).from(products).where(eq(products.slug, slug));
    if (clash || RESERVED_SLUGS.has(slug)) slug = `${slug}-${Date.now().toString(36)}`;
    const sku = v.sku ?? (await nextSku(tx, p.categoryId));
    const [skuClash] = await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, sku));
    if (skuClash) throw conflict(`SKU ${sku} is already in use.`);
    const [product] = await tx.insert(products).values({ ...(await productValues(tx, p)), slug }).returning();
    await setProductTags(tx, product!.id, p.tagsText);
    const [variant] = await tx.insert(productVariants).values({ ...v, sku, costMinor: v.costMinor ?? null, productId: product!.id }).returning();
    await audit(tx, { actor, action: "product.created", targetType: "product", targetId: product!.id, data: { name: p.name, sku, priceMinor: v.priceMinor } });
    await queueProductSync(tx, product!.id);
    return { product: product!, variant: variant! };
  });
  publish({ topic: "catalogue" });
  return created;
}

export async function updateProduct(db: DB, actor: Actor, id: string, input: z.input<typeof productInput>) {
  authorize(actor, "catalogue.write");
  const p = productInput.parse(input);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(eq(products.id, id));
    if (!before) throw notFound("Product not found.");
    await tx.update(products).set(await productValues(tx, p)).where(eq(products.id, id));
    await setProductTags(tx, id, p.tagsText);
    await audit(tx, { actor, action: "product.updated", targetType: "product", targetId: id, data: { name: p.name, status: p.status, sesSync: p.sesSync } });
    // Stopping the SES offer retires the SKUs at SES; otherwise SES gets the new state.
    await queueProductSync(tx, id, { retire: before.sesSync && !p.sesSync });
  });
  publish({ topic: "catalogue" });
}

export async function addVariant(db: DB, actor: Actor, productId: string, input: z.input<typeof variantInput>) {
  authorize(actor, "catalogue.write");
  const v = variantInput.parse(input);
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(products).where(eq(products.id, productId));
    if (!p) throw notFound("Product not found.");
    const sku = v.sku ?? (await nextSku(tx, p.categoryId));
    const [skuClash] = await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, sku));
    if (skuClash) throw conflict(`SKU ${sku} is already in use.`);
    const [row] = await tx.insert(productVariants).values({ ...v, sku, costMinor: v.costMinor ?? null, productId }).returning();
    await audit(tx, { actor, action: "variant.created", targetType: "variant", targetId: row!.id, data: { sku, priceMinor: v.priceMinor } });
    await queueProductSync(tx, productId);
  });
  publish({ topic: "catalogue" });
}

/** Price, cost and availability changes take effect for new orders only; existing orders keep their prices. */
export async function updateVariant(db: DB, actor: Actor, variantId: string, input: { name: string; priceMinor: number; costMinor: number | null; taxable: boolean; active: boolean }) {
  authorize(actor, "catalogue.write");
  const data = variantInput.pick({ name: true, priceMinor: true, costMinor: true, taxable: true, active: true }).parse(input);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(productVariants).where(eq(productVariants.id, variantId));
    if (!before) throw notFound("Product option not found.");
    await tx.update(productVariants).set({ ...data, costMinor: data.costMinor ?? null }).where(eq(productVariants.id, variantId));
    await audit(tx, { actor, action: "variant.updated", targetType: "variant", targetId: variantId, data: { sku: before.sku, from: { priceMinor: before.priceMinor, costMinor: before.costMinor, active: before.active }, to: data } });
    await queueProductSync(tx, before.productId);
  });
  publish({ topic: "catalogue" });
}
