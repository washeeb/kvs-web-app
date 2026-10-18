import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { brands, categories, productVariants, products, suppliers } from "../db/schema";
import type { Actor } from "../authz/policy";
import { addVariant, createProduct } from "./catalogue";
import { addImage, inspectImage } from "./media";
import { saveSupplier } from "./purchasing";
import { saveBrand, saveCategory } from "./taxonomy";

/**
 * Loads a supplier product import prepared by scripts/supplier-import/prepare.mjs (products.json + media/).
 * Products arrive priced on request (no selling price) and not stock-tracked, so the shop shows
 * "Request a quote" until staff set a price. Safe to run again: categories, brands and suppliers are reused by
 * slug or name, and a product whose name already exists is skipped (staff edits are never overwritten).
 */
type Tree = Record<string, { name: string; existing?: boolean; skuCode?: string; serviceLine?: string; children: Record<string, [string, string]> }>;
type ImportProduct = {
  supplier: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string;
  parent: string;
  variants: { name: string; supplierCode: string | null }[];
  images: { file: string }[];
};

/** First sentence of the description, for the shop card. */
const summaryOf = (d: string | null) => (d ? (d.match(/^.+?[.!?](\s|$)/)?.[0] ?? d).trim().slice(0, 300) : "");

export async function importProducts(db: DB, actor: Actor, dir: string, opts: { limit?: number } = {}) {
  const data = JSON.parse(await readFile(path.join(dir, "products.json"), "utf8")) as { tree: Tree; products: ImportProduct[] };
  const result = { categoriesCreated: [] as string[], brandsCreated: [] as string[], suppliersCreated: [] as string[], productsCreated: 0, productsSkipped: 0, pictures: 0, problems: [] as string[] };

  // Categories: parents, then their sub-categories.
  const catId = new Map<string, string>();
  const bySlug = async (slug: string) => (await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)))[0]?.id;
  let order = 100;
  for (const [slug, t] of Object.entries(data.tree)) {
    let id = await bySlug(slug);
    if (!id) {
      id = (await saveCategory(db, actor, null, { name: t.name, slug, skuCode: t.skuCode ?? "", serviceLine: t.serviceLine ?? null, active: true, sortOrder: order })).id;
      result.categoriesCreated.push(t.name);
    }
    order += 10;
    catId.set(slug, id);
    let sub = 0;
    for (const [childSlug, [name, code]] of Object.entries(t.children)) {
      let cid = await bySlug(childSlug);
      if (!cid) {
        cid = (await saveCategory(db, actor, null, { name, slug: childSlug, parentId: id, skuCode: code, active: true, sortOrder: sub })).id;
        result.categoriesCreated.push(`${t.name} › ${name}`);
      }
      sub += 10;
      catId.set(childSlug, cid);
    }
  }

  // Suppliers and brands, matched by name (case-insensitive).
  const supplierId = new Map<string, string>();
  for (const name of [...new Set(data.products.map((p) => p.supplier))]) {
    const [hit] = await db.select({ id: suppliers.id }).from(suppliers).where(sql`lower(${suppliers.name}) = ${name.toLowerCase()}`);
    if (hit) supplierId.set(name, hit.id);
    else {
      supplierId.set(name, (await saveSupplier(db, actor, null, { name, notes: "Created by the supplier product import." })).id);
      result.suppliersCreated.push(name);
    }
  }
  const brandId = new Map<string, string>();
  for (const name of [...new Set(data.products.map((p) => p.brand).filter((b): b is string => !!b))]) {
    const [hit] = await db.select({ id: brands.id }).from(brands).where(sql`lower(${brands.name}) = ${name.toLowerCase()}`);
    if (hit) brandId.set(name, hit.id);
    else {
      brandId.set(name, (await saveBrand(db, actor, null, { name, active: true })).id);
      result.brandsCreated.push(name);
    }
  }

  // Products.
  const existing = new Set((await db.select({ name: products.name }).from(products)).map((p) => p.name.trim().toLowerCase()));
  const list = opts.limit ? data.products.slice(0, opts.limit) : data.products;
  for (const p of list) {
    const name = p.name.slice(0, 160);
    if (existing.has(name.toLowerCase())) {
      result.productsSkipped++;
      continue;
    }
    try {
      const codes = p.variants.map((v) => v.supplierCode).filter(Boolean);
      const { product } = await createProduct(
        db,
        actor,
        {
          name,
          summary: summaryOf(p.description),
          description: p.description ?? "",
          categoryId: catId.get(p.category) ?? null,
          brandId: p.brand ? (brandId.get(p.brand) ?? null) : null,
          specsText: p.variants.length === 1 && codes[0] ? `Model: ${codes[0]}` : "",
          status: "active",
          sesSync: false,
        },
        { name: p.variants[0]!.name, priceMinor: null, tracksStock: false, taxable: true },
      );
      for (const v of p.variants.slice(1)) await addVariant(db, actor, product.id, { name: v.name, priceMinor: null, tracksStock: false, taxable: true });
      await db.update(productVariants).set({ preferredSupplierId: supplierId.get(p.supplier)! }).where(eq(productVariants.productId, product.id));
      existing.add(name.toLowerCase());
      result.productsCreated++;
      for (const img of p.images) {
        if (!/^[a-f0-9]{16}$/.test(img.file)) continue;
        // Each copy is labelled with its real width: a small original was never enlarged, so its "800" copy may be
        // narrower, and two copies of the same width are stored once.
        const files: { width: number; bytes: Buffer }[] = [];
        for (const label of [320, 800]) {
          const bytes = await readFile(path.join(dir, "media", img.file, `${label}.webp`)).catch(() => null);
          const width = bytes ? inspectImage(bytes)?.width : undefined;
          if (bytes && width && !files.some((f) => f.width === width)) files.push({ width, bytes });
        }
        if (files.length === 0) continue;
        try {
          await addImage(db, actor, "product", product.id, { files, alt: name });
          result.pictures++;
        } catch (e) {
          result.problems.push(`${name}: picture skipped (${(e as Error).message})`);
        }
      }
    } catch (e) {
      result.problems.push(`${name}: ${(e as Error).message}`);
    }
  }
  return result;
}
