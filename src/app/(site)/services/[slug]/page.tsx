import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { listCategoriesTree } from "@/server/modules/taxonomy";
import { listMedia } from "@/server/modules/media";
import { Picture } from "@/components/picture";
import { serviceBySlug } from "@/content/services";
import { EnquiryForm } from "@/components/enquiry-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const s = serviceBySlug((await params).slug);
  return { title: s?.title ?? "Service", description: s?.summary };
}

export default async function ServicePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const s = serviceBySlug((await params).slug);
  if (!s) notFound();
  const db = getDb();
  const [allCats, images] = await Promise.all([
    listCategoriesTree(db),
    listMedia(db, "service", [s.slug]),
  ]);
  // Categories linked in Categories (service line) or listed in the service definition.
  const cats = allCats.filter(
    (c) =>
      c.active &&
      (c.serviceLine === s.slug || s.shopCategories?.includes(c.slug)),
  );
  const [banner, ...gallery] = images;
  return (
    <>
      {banner && (
        <div className="mx-auto max-w-6xl px-4 pt-6">
          <Picture
            m={banner}
            sizes="(min-width: 1152px) 1120px, 100vw"
            fallbackWidth={1600}
            priority
            className="aspect-[3/1] w-full rounded-xl object-cover"
            alt={banner.alt || s.title}
          />
        </div>
      )}
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1fr_1.1fr]">
        <div>
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <Link href="/services" className="hover:underline">
              Services
            </Link>{" "}
            / <span>{s.title}</span>
          </nav>
          <h1 className="mt-3 text-3xl font-bold text-slate-900">{s.title}</h1>
          <p className="mt-3 text-lg text-slate-700">{s.summary}</p>
          <h2 className="mt-8 text-lg font-semibold">Includes</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-slate-700">
            {s.includes.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
          {gallery.length > 0 && (
            <>
              <h2 className="mt-8 text-lg font-semibold">Our work</h2>
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {gallery.map((m) => (
                  <li key={m.id}>
                    <Picture
                      m={m}
                      sizes="(min-width: 768px) 180px, 45vw"
                      fallbackWidth={320}
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
          {cats.length > 0 && (
            <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="font-semibold">Buy online</h2>
              <p className="mt-1 text-sm text-slate-600">
                Ready-to-buy items for this service are in the shop.
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {cats.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/shop?category=${c.slug}`}
                      className="btn btn-primary"
                    >
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <section
          aria-labelledby="request-heading"
          className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 id="request-heading" className="text-xl font-semibold">
            {s.cta}
          </h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            Tell us what you need — quantities, dates, location — and we will
            get back to you within one working day.
          </p>
          <EnquiryForm serviceLine={s.slug} submitLabel={s.cta} />
        </section>
      </div>
    </>
  );
}
