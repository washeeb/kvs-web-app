import type { MetadataRoute } from "next";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { products } from "@/server/db/schema";
import { SERVICE_LINES } from "@/content/services";

// Built per request from the database (never at build time, when there is no database).
export const dynamic = "force-dynamic";

/** Public pages only: services and live (non-demo) products. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const items = await getDb().select({ slug: products.slug, updatedAt: products.updatedAt }).from(products).where(and(eq(products.status, "active"), eq(products.isDemo, false)));
  return [
    ...["", "/services", "/shop", "/contact", "/privacy"].map((p) => ({ url: `${base}${p}` })),
    ...SERVICE_LINES.map((s) => ({ url: `${base}/services/${s.slug}` })),
    ...items.map((p) => ({ url: `${base}/shop/${p.slug}`, lastModified: p.updatedAt })),
  ];
}
