import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { listShopProducts, type ShopSort } from "@/server/modules/catalogue";
import { listBrands, listCategoriesTree, listTags } from "@/server/modules/taxonomy";
import { AvailabilityBadge } from "@/components/availability";
import { NoPicture, Picture } from "@/components/picture";
import { Badge, EmptyState, Money } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Shop", description: "Computers, networking, CCTV, office supplies and promotional items from KingsView Solutions, Accra." };

const SORTS: { value: ShopSort; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "newest", label: "Newest" },
];

type SP = { q?: string; category?: string; brand?: string; tag?: string; sort?: string };

export default async function ShopPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sort = (SORTS.find((s) => s.value === sp.sort)?.value ?? "name") as ShopSort;
  const db = getDb();
  const [items, cats, brands, tags] = await Promise.all([
    listShopProducts(db, { q: sp.q, category: sp.category, brand: sp.brand, tag: sp.tag, sort }),
    listCategoriesTree(db),
    listBrands(db),
    listTags(db),
  ]);
  const shownCats = cats.filter((c) => c.active);
  const shownBrands = brands.filter((b) => b.active && b.productCount > 0);
  const activeTag = sp.tag ? tags.find((t) => t.slug === sp.tag) : null;
  const activeCat = cats.find((c) => c.slug === sp.category);
  const demo = items.some((i) => i.isDemo);
  const link = (change: Partial<SP>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...change })) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/shop?${qs}` : "/shop";
  };
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{activeCat?.name ?? "Shop"}</h1>
          <p className="mt-1 max-w-2xl text-slate-600">{activeCat?.description || "Prices in GHS, excluding taxes. Pickup or delivery; pay by mobile money, card or transfer."}</p>
        </div>
        <LiveRefresh topics={["catalogue", "stock"]} />
      </div>
      {demo && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="note"><strong>Demonstration items.</strong> Listings marked “Demonstration” are samples, not KingsView&apos;s real products or prices.</p>}
      <div className="mt-6 grid gap-8 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Shop categories" className="text-sm">
          <h2 className="font-semibold text-slate-900">Categories</h2>
          <ul className="mt-2 space-y-0.5">
            <li><Link href={link({ category: undefined })} aria-current={!sp.category ? "page" : undefined} className={`block rounded px-2 py-1 ${!sp.category ? "bg-teal-50 font-semibold text-teal-900" : "hover:bg-slate-100"}`}>All products</Link></li>
            {shownCats.map((c) => (
              <li key={c.id}>
                <Link
                  href={link({ category: c.slug })}
                  aria-current={sp.category === c.slug ? "page" : undefined}
                  className={`block rounded px-2 py-1 ${c.depth ? "pl-5" : ""} ${sp.category === c.slug ? "bg-teal-50 font-semibold text-teal-900" : "hover:bg-slate-100"}`}
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <form role="search" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[2fr_1fr_1fr_auto]">
            {sp.category && <input type="hidden" name="category" value={sp.category} />}
            {sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
            <label className="sr-only" htmlFor="q">Search products</label>
            <input id="q" name="q" type="search" defaultValue={sp.q} placeholder="Search name, brand or SKU" className="field" />
            <label className="sr-only" htmlFor="brand">Brand</label>
            <select id="brand" name="brand" defaultValue={sp.brand ?? ""} className="field">
              <option value="">All brands</option>
              {shownBrands.map((b) => <option key={b.id} value={b.slug}>{b.name}</option>)}
            </select>
            <label className="sr-only" htmlFor="sort">Sort by</label>
            <select id="sort" name="sort" defaultValue={sort} className="field">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button className="btn btn-primary" type="submit">Show</button>
          </form>
          {activeTag && (
            <p className="mt-3 text-sm">
              Tagged <Badge tone="teal">{activeTag.name}</Badge> <Link href={link({ tag: undefined })} className="ml-1 text-teal-700 underline">clear</Link>
            </p>
          )}
          <p className="mt-4 text-sm text-slate-600" aria-live="polite">{items.length} product{items.length === 1 ? "" : "s"}</p>
          {items.length === 0 ? (
            <div className="mt-4"><EmptyState title="No products found">Try another search, or <Link href="/contact" className="text-teal-700 underline">ask us for a quotation</Link>.</EmptyState></div>
          ) : (
            <ul className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((p, i) => {
                const from = p.variants[0]!;
                return (
                  <li key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <Link href={`/shop/${p.slug}`} tabIndex={-1} aria-hidden="true">
                      {p.image ? (
                        <Picture m={p.image} sizes="(min-width: 1280px) 300px, (min-width: 640px) 45vw, 100vw" fallbackWidth={800} priority={i < 3} className="aspect-[4/3] w-full bg-slate-50 object-contain" alt="" />
                      ) : (
                        <NoPicture label={p.name} className="aspect-[4/3] w-full" />
                      )}
                    </Link>
                    <div className="flex flex-1 flex-col p-5">
                      <div className="flex flex-wrap gap-1.5">
                        {p.brandName && <Badge tone="blue">{p.brandName}</Badge>}
                        {p.categoryName && <Badge>{p.categoryName}</Badge>}
                        {p.isDemo && <Badge tone="amber">Demonstration</Badge>}
                      </div>
                      <h2 className="mt-3 text-lg font-semibold"><Link href={`/shop/${p.slug}`} className="hover:text-teal-700">{p.name}</Link></h2>
                      <p className="mt-1 flex-1 text-sm text-slate-600">{p.summary}</p>
                      <div className="mt-4 flex items-end justify-between gap-2">
                        <p className="font-semibold">{p.variants.length > 1 && <span className="text-xs font-normal text-slate-600">From </span>}<Money minor={from.priceMinor} currency={from.currency} /></p>
                        <AvailabilityBadge a={from.availability} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
