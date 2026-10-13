import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { listCategories, listShopProducts } from "@/server/modules/catalogue";
import { AvailabilityBadge } from "@/components/availability";
import { Badge, EmptyState, Money } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Shop" };

export default async function ShopPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const sp = await searchParams;
  const db = getDb();
  const [items, cats] = await Promise.all([listShopProducts(db, { q: sp.q, category: sp.category }), listCategories(db)]);
  const demo = items.some((i) => i.isDemo);
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Shop</h1>
          <p className="mt-1 text-slate-600">Prices in GHS, excluding taxes. Pickup or delivery; pay by mobile money, card or transfer.</p>
        </div>
        <LiveRefresh topics={["catalogue", "stock"]} />
      </div>
      {demo && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="note"><strong>Demonstration items.</strong> Listings marked “Demonstration” are samples, not KingsView&apos;s real products or prices.</p>}
      <form role="search" className="mt-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[2fr_1fr_auto]">
        <label className="sr-only" htmlFor="q">Search products</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Search products" className="field" />
        <label className="sr-only" htmlFor="category">Category</label>
        <select id="category" name="category" defaultValue={sp.category ?? ""} className="field">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
        </select>
        <button className="btn btn-primary" type="submit">Search</button>
      </form>
      {items.length === 0 ? (
        <div className="mt-8"><EmptyState title="No products found">Try another search, or <Link href="/contact" className="text-teal-700 underline">ask us for a quotation</Link>.</EmptyState></div>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => {
            const from = p.variants[0]!;
            return (
              <li key={p.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap gap-1.5">
                  {p.categoryName && <Badge>{p.categoryName}</Badge>}
                  {p.isDemo && <Badge tone="amber">Demonstration</Badge>}
                </div>
                <h2 className="mt-3 text-lg font-semibold"><Link href={`/shop/${p.slug}`} className="hover:text-teal-700">{p.name}</Link></h2>
                <p className="mt-1 flex-1 text-sm text-slate-600">{p.summary}</p>
                <div className="mt-4 flex items-end justify-between gap-2">
                  <p className="font-semibold">{p.variants.length > 1 && <span className="text-xs font-normal text-slate-600">From </span>}<Money minor={from.priceMinor} currency={from.currency} /></p>
                  <AvailabilityBadge a={from.availability} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
