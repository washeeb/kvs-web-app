import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { listCategories } from "@/server/modules/catalogue";
import { serviceBySlug } from "@/content/services";
import { EnquiryForm } from "@/components/enquiry-form";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const s = serviceBySlug((await params).slug);
  return { title: s?.title ?? "Service", description: s?.summary };
}

export default async function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const s = serviceBySlug((await params).slug);
  if (!s) notFound();
  const cats = s.shopCategories ? (await listCategories(getDb())).filter((c) => s.shopCategories!.includes(c.slug)) : [];
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1fr_1.1fr]">
      <div>
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600"><Link href="/services" className="hover:underline">Services</Link> / <span>{s.title}</span></nav>
        <h1 className="mt-3 text-3xl font-bold text-slate-900">{s.title}</h1>
        <p className="mt-3 text-lg text-slate-700">{s.summary}</p>
        <h2 className="mt-8 text-lg font-semibold">Includes</h2>
        <ul className="mt-2 list-inside list-disc space-y-1 text-slate-700">
          {s.includes.map((i) => <li key={i}>{i}</li>)}
        </ul>
        {cats.length > 0 && (
          <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold">Buy online</h2>
            <p className="mt-1 text-sm text-slate-600">Ready-to-buy items for this service are in the shop.</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {cats.map((c) => <li key={c.id}><Link href={`/shop?category=${c.slug}`} className="btn btn-primary">{c.name}</Link></li>)}
            </ul>
          </div>
        )}
      </div>
      <section aria-labelledby="request-heading" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 id="request-heading" className="text-xl font-semibold">{s.cta}</h2>
        <p className="mt-1 mb-4 text-sm text-slate-600">Tell us what you need — quantities, dates, location — and we will get back to you within one working day.</p>
        <EnquiryForm serviceLine={s.slug} submitLabel={s.cta} />
      </section>
    </div>
  );
}
