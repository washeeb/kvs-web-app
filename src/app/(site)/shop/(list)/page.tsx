import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { searchShopProducts, shopCategoryCounts, type ShopSort } from "@/server/modules/catalogue";
import { listBrands, listCategoriesTree, listTags } from "@/server/modules/taxonomy";
import { mainImages } from "@/server/modules/media";
import { Picture } from "@/components/picture";
import { EmptyState } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { ActiveFilters, CategoryChips, CategorySidebar, Pagination, ProductCard } from "@/components/shop-ui";

export const metadata: Metadata = { title: "Shop", description: "Computers, networking, CCTV, alarms, printers, office supplies and promotional items from KingsView Solutions, Accra." };

const SORTS: { value: ShopSort; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "newest", label: "Newest" },
];

type SP = { q?: string; category?: string; brand?: string; tag?: string; sort?: string; page?: string };

export default async function ShopPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sort = (SORTS.find((s) => s.value === sp.sort)?.value ?? "name") as ShopSort;
  const db = getDb();
  const [result, tree, counts, brands, tags] = await Promise.all([
    searchShopProducts(db, { q: sp.q, category: sp.category, brand: sp.brand, tag: sp.tag, sort, page: Number(sp.page) || 1 }),
    listCategoriesTree(db),
    shopCategoryCounts(db),
    listBrands(db),
    listTags(db),
  ]);
  // Categories with products on sale; a top level counts its sub-categories too.
  const cats = tree
    .filter((c) => c.active)
    .map((c) => ({ ...c, count: (counts.get(c.id) ?? 0) + (c.depth === 0 ? tree.filter((k) => k.parentId === c.id).reduce((n, k) => n + (counts.get(k.id) ?? 0), 0) : 0) }))
    .filter((c) => c.count > 0);
  const tops = cats.filter((c) => c.depth === 0);
  const catImages = await mainImages(db, "category", tops.map((c) => c.id));
  const activeCat = cats.find((c) => c.slug === sp.category);
  const parent = activeCat?.parentId ? cats.find((c) => c.id === activeCat.parentId) : activeCat;
  const subs = parent ? cats.filter((c) => c.parentId === parent.id) : [];
  const shownBrands = brands.filter((b) => b.active && b.productCount > 0);
  const activeBrand = shownBrands.find((b) => b.slug === sp.brand);
  const activeTag = sp.tag ? tags.find((t) => t.slug === sp.tag) : null;
  const browsing = !sp.q && !sp.category && !sp.brand && !sp.tag;
  const demo = result.items.some((i) => i.isDemo);

  const link = (change: Partial<SP>) => {
    const next = new URLSearchParams();
    // Any change of filter starts again from page 1.
    for (const [k, v] of Object.entries({ ...sp, page: undefined, ...change })) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/shop?${qs}` : "/shop";
  };
  const catHref = (slug?: string) => link({ category: slug });
  const filters = [
    ...(activeCat ? [{ label: activeCat.name, clear: link({ category: undefined }) }] : []),
    ...(activeBrand ? [{ label: activeBrand.name, clear: link({ brand: undefined }) }] : []),
    ...(activeTag ? [{ label: `#${activeTag.name}`, clear: link({ tag: undefined }) }] : []),
    ...(sp.q ? [{ label: `“${sp.q}”`, clear: link({ q: undefined }) }] : []),
  ];
  const first = (result.page - 1) * result.perPage + 1;

  return (
    <>
      <section className="border-b border-slate-200 bg-gradient-to-b from-white to-slate-50">
        <div className="mx-auto max-w-6xl px-4 pb-6 pt-10">
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <Link href="/shop" className="hover:underline">Shop</Link>
            {parent && parent.id !== activeCat?.id && <> / <Link href={catHref(parent.slug)} className="hover:underline">{parent.name}</Link></>}
            {activeCat && <> / <span aria-current="page">{activeCat.name}</span></>}
          </nav>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">{activeCat?.name ?? "Shop"}</h1>
              <p className="mt-1 max-w-2xl text-slate-600">{activeCat?.description || "Prices in GHS, excluding taxes. Pickup or delivery; pay by mobile money, card or transfer. Items without a price: ask us for a quotation."}</p>
            </div>
            <LiveRefresh topics={["catalogue", "stock"]} />
          </div>
          <div className="mt-6 space-y-3 lg:hidden">
            <CategoryChips items={[{ id: "all", slug: "", name: "All", parentId: null, depth: 0, count: tops.reduce((n, c) => n + c.count, 0) }, ...tops]} active={parent?.slug ?? ""} href={(slug) => catHref(slug || undefined)} images={catImages} label="Shop categories" />
            {subs.length > 0 && <CategoryChips items={subs} active={activeCat?.slug} href={catHref} label={`${parent!.name} sub-categories`} />}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-8">
        {browsing && tops.length > 0 && (
          <section aria-labelledby="by-category" className="mb-10">
            <h2 id="by-category" className="text-lg font-semibold text-slate-900">Shop by category</h2>
            <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {tops.map((c) => {
                const img = catImages.get(c.id);
                return (
                  <li key={c.id} className="lift reveal group relative overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="overflow-hidden">
                      {img ? <Picture m={img} sizes="(min-width: 1024px) 180px, (min-width: 640px) 30vw, 45vw" fallbackWidth={320} className="zoom aspect-[3/2] w-full object-cover" alt="" /> : <div className="aspect-[3/2] w-full bg-slate-100" />}
                    </div>
                    <div className="p-3">
                      <Link href={catHref(c.slug)} className="plain text-sm font-semibold leading-snug text-slate-900 after:absolute after:inset-0 group-hover:text-teal-700">{c.name}</Link>
                      <p className="text-xs text-slate-500">{c.count} item{c.count === 1 ? "" : "s"}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {demo && <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="note"><strong>Demonstration items.</strong> Listings marked “Demonstration” are samples, not KingsView&apos;s real products or prices.</p>}

        <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
          <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
            <CategorySidebar items={cats} active={sp.category} href={catHref} />
          </aside>
          <div className="min-w-0">
            <AutoSubmitForm action="/shop" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[2fr_1fr_1fr_auto]">
              {sp.category && <input type="hidden" name="category" value={sp.category} />}
              {sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
              <label className="sr-only" htmlFor="q">Search products</label>
              <div className="relative">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input id="q" name="q" type="search" defaultValue={sp.q} placeholder="Search name, brand or SKU" className="field" style={{ paddingLeft: "2.25rem" }} />
              </div>
              <label className="sr-only" htmlFor="brand">Brand</label>
              <select id="brand" name="brand" defaultValue={sp.brand ?? ""} className="field">
                <option value="">All brands</option>
                {shownBrands.map((b) => <option key={b.id} value={b.slug}>{b.name}</option>)}
              </select>
              <label className="sr-only" htmlFor="sort">Sort by</label>
              <select id="sort" name="sort" defaultValue={sort} className="field">
                {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <button className="btn btn-primary" type="submit">Search</button>
            </AutoSubmitForm>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600" aria-live="polite">
                {result.total === 0 ? "No products" : result.pages > 1 ? `Showing ${first}–${first + result.items.length - 1} of ${result.total} products` : `${result.total} product${result.total === 1 ? "" : "s"}`}
              </p>
              <ActiveFilters filters={filters} />
            </div>

            {result.items.length === 0 ? (
              <div className="mt-6"><EmptyState title="No products found">Try another search, or <Link href="/contact" className="text-teal-700 underline">ask us for a quotation</Link>.</EmptyState></div>
            ) : (
              <ul className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {result.items.map((p, i) => <ProductCard key={p.id} p={p} priority={i < 3} />)}
              </ul>
            )}
            <Pagination page={result.page} pages={result.pages} href={(n) => { const u = link({}); return n === 1 ? u : `${u}${u.includes("?") ? "&" : "?"}page=${n}`; }} />
          </div>
        </div>
      </div>
    </>
  );
}
