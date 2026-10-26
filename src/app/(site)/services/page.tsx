import Link from "next/link";
import type { Metadata } from "next";
import { SERVICE_LINES } from "@/content/services";
import { getDb } from "@/server/db/client";
import { mainImages } from "@/server/modules/media";
import { Picture } from "@/components/picture";

export const metadata: Metadata = { title: "Services", description: "Websites and software, branding, design and printing, CCTV, office supplies, photography, training, branded items and IT supplies in Ghana." };

export default async function ServicesPage() {
  const images = await mainImages(getDb(), "service", SERVICE_LINES.map((s) => s.slug));
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">KingsView Solutions</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Services</h1>
      <p className="mt-2 max-w-2xl text-slate-600">Tell us what you need and we will reply with a quotation. Supplies can also be ordered directly from the <Link href="/shop" className="text-teal-700 underline">shop</Link>.</p>
      <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICE_LINES.map((s) => {
          const img = images.get(s.slug);
          return (
            <li key={s.slug} className="lift reveal group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="overflow-hidden">
                {img ? <Picture m={img} sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw" fallbackWidth={800} className="zoom aspect-[3/2] w-full object-cover" alt="" /> : <div className="aspect-[3/2] bg-slate-100" />}
              </div>
              <div className="flex flex-1 flex-col p-5">
                <h2 className="text-lg font-semibold text-slate-900">
                  {/* The whole card is clickable through this link's stretched overlay. */}
                  <Link href={`/services/${s.slug}`} className="plain after:absolute after:inset-0 group-hover:text-teal-700">{s.title}</Link>
                </h2>
                <p className="mt-1 flex-1 text-sm text-slate-600">{s.summary}</p>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {s.includes.slice(0, 4).map((i) => <li key={i} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">{i}</li>)}
                </ul>
                <p className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-teal-700" aria-hidden="true">
                  Find out more <span className="transition-transform group-hover:translate-x-1">→</span>
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
