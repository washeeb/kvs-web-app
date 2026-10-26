import Link from "next/link";
import { getDb } from "@/server/db/client";
import { listCategoriesTree } from "@/server/modules/taxonomy";
import { mainImages } from "@/server/modules/media";
import { searchShopProducts, shopCategoryCounts } from "@/server/modules/catalogue";
import { Picture } from "@/components/picture";
import { SERVICE_LINES } from "@/content/services";
import { Logo } from "@/components/logo";
import { HeroSlider } from "@/components/hero-slider";
import { ProductCard } from "@/components/shop-ui";
import { liveSlides } from "@/server/modules/slides";

export default async function Home() {
  const db = getDb();
  const [tree, counts] = await Promise.all([listCategoriesTree(db), shopCategoryCounts(db)]);
  // Top-level categories with products on sale (their own and their sub-categories').
  const cats = tree
    .filter((c) => c.active && c.depth === 0)
    .map((c) => ({ ...c, count: (counts.get(c.id) ?? 0) + tree.filter((k) => k.parentId === c.id).reduce((n, k) => n + (counts.get(k.id) ?? 0), 0) }))
    .filter((c) => c.count > 0);
  const [serviceImages, catImages, slides, latest] = await Promise.all([
    mainImages(db, "service", SERVICE_LINES.map((s) => s.slug)),
    mainImages(db, "category", cats.map((c) => c.id)),
    liveSlides(db),
    searchShopProducts(db, { sort: "newest" }, 48),
  ]);
  const newest = latest.items.filter((p) => p.image).slice(0, 4);
  return (
    <>
      {slides.length > 0 ? (
        <HeroSlider slides={slides} />
      ) : (
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-[1.3fr_1fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">KingsView Solutions</p>
              <h1 className="mt-2 text-4xl font-bold leading-tight text-slate-900 md:text-5xl">Technology, design and supplies — handled in one place.</h1>
              <p className="mt-4 max-w-xl text-lg text-slate-700">
                Websites and software, branding and printing, CCTV installation, photography, training, branded items, office supplies and IT equipment for businesses, schools, churches and homes.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/contact" className="btn btn-accent">Request a quotation</Link>
                <Link href="/shop" className="btn btn-primary">Visit the shop</Link>
              </div>
            </div>
            <div className="flex justify-center">
              <Logo variant="stacked" href={null} height={240} />
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 py-16" aria-labelledby="services-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Services</p>
            <h2 id="services-heading" className="mt-1 text-3xl font-bold tracking-tight text-slate-900">What we do</h2>
          </div>
          <Link href="/services" className="plain text-sm font-semibold text-teal-700 hover:underline">All services →</Link>
        </div>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_LINES.map((s) => {
            const img = serviceImages.get(s.slug);
            return (
              <li key={s.slug} className="lift reveal group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="overflow-hidden">
                  {img ? <Picture m={img} sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw" fallbackWidth={800} className="zoom aspect-[3/2] w-full object-cover" alt="" /> : <div className="aspect-[3/2] bg-slate-100" />}
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <h3 className="text-lg font-semibold text-slate-900">
                    {/* The whole card is clickable through this link's stretched overlay. */}
                    <Link href={`/services/${s.slug}`} className="plain after:absolute after:inset-0 group-hover:text-teal-700">{s.title}</Link>
                  </h3>
                  <p className="mt-1 flex-1 text-sm text-slate-600">{s.short}</p>
                  <p className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-teal-700" aria-hidden="true">
                    Find out more <span className="transition-transform group-hover:translate-x-1">→</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {cats.length > 0 && (
        <section className="border-y border-slate-200 bg-white py-16" aria-labelledby="shop-heading">
          <div className="mx-auto max-w-6xl px-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Shop</p>
                <h2 id="shop-heading" className="mt-1 text-3xl font-bold tracking-tight text-slate-900">Shop online</h2>
                <p className="mt-1 text-slate-600">Order for pickup or delivery and pay by mobile money, card or transfer.</p>
              </div>
              <Link href="/shop" className="btn btn-primary">Browse all products</Link>
            </div>
            <ul className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
              {cats.map((c) => {
                const img = catImages.get(c.id);
                return (
                  <li key={c.id} className="lift reveal group relative overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="overflow-hidden">
                      {img ? <Picture m={img} sizes="(min-width: 1024px) 160px, (min-width: 768px) 25vw, 45vw" fallbackWidth={320} className="zoom aspect-[3/2] w-full object-cover" alt="" /> : <div className="aspect-[3/2] w-full bg-slate-100" aria-hidden="true" />}
                    </div>
                    <div className="p-3">
                      <Link href={`/shop?category=${c.slug}`} className="plain text-sm font-semibold leading-snug text-slate-900 after:absolute after:inset-0 group-hover:text-teal-700">{c.name}</Link>
                      <p className="text-xs text-slate-500">{c.count} item{c.count === 1 ? "" : "s"}</p>
                    </div>
                  </li>
                );
              })}
            </ul>

            {newest.length > 0 && (
              <div className="mt-14">
                <h3 className="text-xl font-semibold text-slate-900">New in the shop</h3>
                <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  {newest.map((p) => <ProductCard key={p.id} p={p} heading="h4" />)}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
