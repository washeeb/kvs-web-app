import Link from "next/link";
import type { Metadata } from "next";
import { SERVICE_LINES } from "@/content/services";

export const metadata: Metadata = { title: "Services" };

export default function ServicesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold text-slate-900">Services</h1>
      <p className="mt-2 max-w-2xl text-slate-600">Tell us what you need and we will reply with a quotation. Supplies can also be ordered directly from the shop.</p>
      <ul className="mt-8 space-y-4">
        {SERVICE_LINES.map((s) => (
          <li key={s.slug} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold"><Link href={`/services/${s.slug}`} className="hover:text-teal-700">{s.title}</Link></h2>
            <p className="mt-1 text-slate-700">{s.summary}</p>
            <p className="mt-2 text-sm text-slate-600">{s.includes.join(" · ")}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
