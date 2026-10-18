import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "./client";
import {
  categories,
  currencies,
  customers,
  departments,
  enquiries,
  organizations,
  permissionSets,
  products,
  productVariants,
  roleAssignments,
  stockLevels,
  stockLocations,
  taxRates,
  users,
} from "./schema";
import { ROLE_TEMPLATES } from "../authz/roles";
import { hashPassword } from "../auth/password";

export const DEPARTMENTS: [string, string][] = [
  ["management", "Management"],
  ["sales", "Sales & front desk"],
  ["shop", "Shop & stock"],
  ["creative", "Design, branding & printing"],
  ["technical", "Technical (CCTV, networking, IT)"],
  ["media", "Photography & videography"],
  ["training", "Training & consultancy"],
  ["accounts", "Accounts"],
];

/** Shop categories, each tied to a service line (src/content/services.ts). */
export const CATEGORIES: [string, string, string][] = [
  ["computers-accessories", "Computers & accessories", "tech-networking-it-supplies"],
  ["networking", "Networking & IT supplies", "tech-networking-it-supplies"],
  ["cctv", "CCTV cameras & recorders", "cctv-installation"],
  ["office-supplies", "Office supplies", "office-supplies"],
  ["souvenirs-promotional", "Souvenirs, uniforms & promotional items", "souvenirs-uniforms-promotional"],
];

/** Demo staff, one per role. Only created outside production (`seed`), never by `seedReference`. */
export const DEMO_USERS: [string, string, string][] = [
  ["owner@kingsview.demo", "Demo Owner", "owner"],
  ["manager@kingsview.demo", "Demo Manager", "manager"],
  ["sales@kingsview.demo", "Demo Sales", "sales"],
  ["store@kingsview.demo", "Demo Store", "store"],
  ["tech@kingsview.demo", "Demo Technician", "technician"],
  ["accounts@kingsview.demo", "Demo Accounts", "accounts"],
  ["auditor@kingsview.demo", "Demo Auditor", "auditor"],
];

export interface SeedOptions {
  demoPassword: string;
  /** Demo customers and enquiries (skipped by tests that want a clean slate). */
  withDemoActivity?: boolean;
}

async function operatorOrg(db: DB) {
  const [existing] = await db.select().from(organizations).where(eq(organizations.slug, "kingsview"));
  if (existing) return existing;
  const [row] = await db.insert(organizations).values({ type: "operator", name: "KingsView Solutions", slug: "kingsview" }).returning();
  return row!;
}

/** Reference data for every environment, including production. Idempotent; keeps admin edits. */
export async function seedReference(db: DB) {
  await db
    .insert(currencies)
    .values([
      { code: "GHS", name: "Ghana cedi", symbol: "GH₵" },
      { code: "USD", name: "US dollar", symbol: "$", active: false },
    ])
    .onConflictDoNothing();
  const org = await operatorOrg(db);
  for (const [key, name] of DEPARTMENTS) await db.insert(departments).values({ organizationId: org.id, key, name }).onConflictDoNothing();

  // System roles stay in sync with code on every seed.
  for (const r of ROLE_TEMPLATES) {
    const [existing] = await db.select().from(permissionSets).where(and(eq(permissionSets.key, r.key), isNull(permissionSets.organizationId)));
    if (existing) await db.update(permissionSets).set({ name: r.name, description: r.description, permissions: r.permissions, domain: r.domain }).where(eq(permissionSets.id, existing.id));
    else await db.insert(permissionSets).values({ key: r.key, name: r.name, description: r.description, permissions: r.permissions, domain: r.domain, isSystem: true });
  }

  // Ghana standard rates (VAT Act, 2025 (Act 1151), from 1 January 2026): VAT 15%, NHIL 2.5%, GETFund 2.5%, not compounded.
  // Inserted only when no taxes exist, so changes made in the app are kept. KingsView must confirm its own VAT status.
  const existingTaxes = await db.select().from(taxRates).where(eq(taxRates.organizationId, org.id));
  if (existingTaxes.length === 0) {
    await db.insert(taxRates).values([
      { organizationId: org.id, code: "VAT", name: "VAT (15%)", rateBp: 1500, sortOrder: 1 },
      { organizationId: org.id, code: "NHIL", name: "NHIL (2.5%)", rateBp: 250, sortOrder: 2 },
      { organizationId: org.id, code: "GETFUND", name: "GETFund levy (2.5%)", rateBp: 250, sortOrder: 3 },
    ]);
  }

  const [loc] = await db.select().from(stockLocations).where(eq(stockLocations.code, "SHOP"));
  if (!loc) await db.insert(stockLocations).values({ code: "SHOP", name: "KingsView shop", kind: "shop", isDefault: true, organizationId: org.id });
  for (const [i, [slug, name, serviceLine]] of CATEGORIES.entries()) {
    await db.insert(categories).values({ slug, name, serviceLine, sortOrder: i }).onConflictDoNothing();
  }
  return org;
}

type DemoProduct = { slug: string; name: string; summary: string; cat: string; sesSync?: boolean; variants: { sku: string; name: string; price: number | null; cost?: number; stock?: number; tracks?: boolean }[] };

/** Clearly labelled demonstration catalogue (prices are illustrative, not KingsView's). */
const DEMO_PRODUCTS: DemoProduct[] = [
  { slug: "demo-wireless-mouse", name: "Wireless mouse", summary: "Demonstration listing.", cat: "computers-accessories", sesSync: true, variants: [{ sku: "KVS-MOUSE-WL", name: "Black", price: 12_000, cost: 8_500, stock: 25 }] },
  { slug: "demo-laptop-bag", name: "Laptop bag 15.6-inch", summary: "Demonstration listing.", cat: "computers-accessories", variants: [{ sku: "KVS-BAG-156", name: "Standard", price: 25_000, cost: 17_000, stock: 10 }] },
  { slug: "demo-cat6-cable", name: "Cat6 network cable", summary: "Demonstration listing.", cat: "networking", sesSync: true, variants: [{ sku: "KVS-CAT6-3M", name: "3 m", price: 3_500, cost: 2_000, stock: 60 }, { sku: "KVS-CAT6-10M", name: "10 m", price: 8_000, cost: 5_000, stock: 20 }] },
  { slug: "demo-wifi-router", name: "Wi-Fi router", summary: "Demonstration listing.", cat: "networking", sesSync: true, variants: [{ sku: "KVS-ROUTER-AC", name: "Dual band", price: 65_000, cost: 48_000, stock: 4 }] },
  { slug: "demo-cctv-kit", name: "CCTV starter kit (4 cameras)", summary: "Demonstration listing. Installation quoted separately.", cat: "cctv", variants: [{ sku: "KVS-CCTV-KIT4", name: "4 cameras + recorder", price: 380_000, cost: 290_000, stock: 3 }] },
  { slug: "demo-a4-paper", name: "A4 copier paper (ream)", summary: "Demonstration listing.", cat: "office-supplies", variants: [{ sku: "KVS-A4-REAM", name: "80 g/m², 500 sheets", price: 7_500, cost: 6_000, stock: 100 }] },
  { slug: "demo-outdoor-access-point", name: "Outdoor access point", summary: "Demonstration listing. Priced on request.", cat: "networking", variants: [{ sku: "KVS-AP-OUT", name: "Standard", price: null, tracks: false }] },
  { slug: "demo-branded-mug", name: "Branded mug", summary: "Demonstration listing. Your logo printed; minimum quantities apply.", cat: "souvenirs-promotional", variants: [{ sku: "KVS-MUG-WHT", name: "White, one-colour print", price: 4_500, tracks: false }] },
];

/** Reference data plus demo staff, catalogue and activity (never in production). */
export async function seed(db: DB, opts: SeedOptions) {
  if (process.env.NODE_ENV === "production") throw new Error("Demo data is not allowed in production. Use seedReference.");
  const org = await seedReference(db);
  const passwordHash = await hashPassword(opts.demoPassword);
  const sets = await db.select().from(permissionSets).where(isNull(permissionSets.organizationId));
  const created: Record<string, string> = {};
  for (const [email, name, role] of DEMO_USERS) {
    let [u] = await db.select().from(users).where(eq(users.email, email));
    if (!u) [u] = await db.insert(users).values({ email, name, organizationId: org.id, passwordHash, isDemo: true }).returning();
    const set = sets.find((s) => s.key === role)!;
    await db.insert(roleAssignments).values({ userId: u!.id, permissionSetId: set.id, organizationId: org.id }).onConflictDoNothing();
    created[email] = u!.id;
  }

  const cats = await db.select().from(categories);
  const [loc] = await db.select().from(stockLocations).where(eq(stockLocations.code, "SHOP"));
  for (const p of DEMO_PRODUCTS) {
    let [prod] = await db.select().from(products).where(eq(products.slug, p.slug));
    if (!prod) [prod] = await db.insert(products).values({ slug: p.slug, name: p.name, summary: p.summary, categoryId: cats.find((c) => c.slug === p.cat)!.id, status: "active", sesSync: !!p.sesSync, isDemo: true }).returning();
    for (const v of p.variants) {
      let [variant] = await db.select().from(productVariants).where(eq(productVariants.sku, v.sku));
      if (!variant) [variant] = await db.insert(productVariants).values({ productId: prod!.id, sku: v.sku, name: v.name, priceMinor: v.price, costMinor: v.cost ?? null, currency: "GHS", tracksStock: v.tracks ?? true }).returning();
      if ((v.tracks ?? true) && v.stock !== undefined) await db.insert(stockLevels).values({ variantId: variant!.id, locationId: loc!.id, onHand: v.stock }).onConflictDoNothing();
    }
  }

  if (opts.withDemoActivity) {
    const [c] = await db.select().from(customers).where(eq(customers.number, "C-DEMO-00001"));
    if (!c) {
      await db.insert(customers).values([
        { number: "C-DEMO-00001", name: "Demo Customer One", company: "Demo Pharmacy", phone: "0200000001", email: "customer1@example.com", isDemo: true },
        { number: "C-DEMO-00002", name: "Demo Customer Two", phone: "0200000002", isDemo: true },
      ]);
      await db.insert(enquiries).values([
        { number: "E-DEMO-00001", serviceLine: "cctv-installation", name: "Demo Enquirer", company: "Demo Hotel", phone: "0200000003", message: "Demonstration enquiry: 8 cameras for a small hotel, with phone viewing.", isDemo: true },
        { number: "E-DEMO-00002", serviceLine: "design-printing", name: "Demo Enquirer Two", email: "enquirer2@example.com", message: "Demonstration enquiry: 500 flyers and 2 roll-up banners for a church event.", isDemo: true },
      ]);
    }
  }
  return { org, users: created };
}
