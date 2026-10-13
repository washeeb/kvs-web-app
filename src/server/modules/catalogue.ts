import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { categories, products, productVariants } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, notFound } from "../lib/errors";
import { audit } from "./audit";
import { publish } from "./events";
import { computeAvailability, levelsForVariants, type Availability } from "./inventory";
import { queueProductSync } from "./ses-link";

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

/** Public shop: active products with at least one active option. */
export async function listShopProducts(db: DB, filter: { q?: string; category?: string } = {}) {
  const conds = [eq(products.status, "active")];
  if (filter.q) {
    const q = `%${filter.q.replace(/[%_\\]/g, "\\$&").slice(0, 80)}%`;
    conds.push(or(ilike(products.name, q), ilike(products.summary, q))!);
  }
  if (filter.category) {
    const [cat] = await db.select().from(categories).where(eq(categories.slug, filter.category));
    if (cat) conds.push(eq(products.categoryId, cat.id));
  }
  const rows = await db
    .select({ product: products, categoryName: categories.name, categorySlug: categories.slug })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(...conds))
    .orderBy(asc(products.name));
  const variants = await attachVariants(db, rows.map((r) => r.product.id));
  return rows.map((r) => ({ ...r.product, categoryName: r.categoryName, categorySlug: r.categorySlug, variants: variants.get(r.product.id) ?? [] })).filter((p) => p.variants.length > 0);
}

export async function getShopProduct(db: DB, slug: string) {
  const [row] = await db
    .select({ product: products, categoryName: categories.name, categorySlug: categories.slug })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.slug, slug), eq(products.status, "active")));
  if (!row) return null;
  const variants = await attachVariants(db, [row.product.id]);
  const v = variants.get(row.product.id) ?? [];
  return v.length ? { ...row.product, categoryName: row.categoryName, categorySlug: row.categorySlug, variants: v } : null;
}

// ───────────────────────────── Management ─────────────────────────────

export async function listProductsAdmin(db: DB, actor: Actor, q?: string) {
  authorize(actor, "catalogue.read");
  const where = q ? or(ilike(products.name, `%${q.replace(/[%_\\]/g, "\\$&").slice(0, 80)}%`)) : undefined;
  const rows = await db
    .select({ product: products, categoryName: categories.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(where)
    .orderBy(desc(products.updatedAt))
    .limit(500);
  const variants = await attachVariants(db, rows.map((r) => r.product.id), false);
  return rows.map((r) => ({ ...r.product, categoryName: r.categoryName, variants: variants.get(r.product.id) ?? [] }));
}

export async function getProductAdmin(db: DB, actor: Actor, id: string) {
  authorize(actor, "catalogue.read");
  const [product] = await db.select().from(products).where(eq(products.id, id));
  if (!product) throw notFound("Product not found.");
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, id)).orderBy(asc(productVariants.sku));
  const levels = await levelsForVariants(db, variants.map((v) => v.id));
  return {
    product,
    variants: variants.map((v) => {
      const ls = levels.filter((l) => l.variantId === v.id);
      return { ...v, onHand: ls.reduce((a, l) => a + l.onHand, 0), reserved: ls.reduce((a, l) => a + l.reserved, 0), availability: computeAvailability(ls, v.tracksStock) };
    }),
  };
}

const RESERVED_SLUGS = new Set(["cart", "checkout", "order"]);
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

export const productInput = z.object({
  name: z.string().trim().min(3).max(160),
  summary: z.string().trim().max(300).optional().default(""),
  description: z.string().trim().max(5000).optional().default(""),
  categoryId: z.string().uuid().nullable().optional(),
  status: z.enum(["draft", "active", "retired"]).default("draft"),
  sesSync: z.boolean().default(false),
});

const money = z.number().int().min(0).max(100_000_000_000);
export const variantInput = z.object({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,40}$/, "SKU: 3–41 capital letters, digits or dashes."),
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
    const [skuClash] = await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, v.sku));
    if (skuClash) throw conflict(`SKU ${v.sku} is already in use.`);
    const [product] = await tx.insert(products).values({ ...p, summary: p.summary || null, description: p.description || null, slug, categoryId: p.categoryId ?? null }).returning();
    const [variant] = await tx.insert(productVariants).values({ ...v, costMinor: v.costMinor ?? null, productId: product!.id }).returning();
    await audit(tx, { actor, action: "product.created", targetType: "product", targetId: product!.id, data: { name: p.name, sku: v.sku, priceMinor: v.priceMinor } });
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
    await tx.update(products).set({ ...p, summary: p.summary || null, description: p.description || null, categoryId: p.categoryId ?? null }).where(eq(products.id, id));
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
    const [skuClash] = await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, v.sku));
    if (skuClash) throw conflict(`SKU ${v.sku} is already in use.`);
    const [row] = await tx.insert(productVariants).values({ ...v, costMinor: v.costMinor ?? null, productId }).returning();
    await audit(tx, { actor, action: "variant.created", targetType: "variant", targetId: row!.id, data: { sku: v.sku, priceMinor: v.priceMinor } });
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
