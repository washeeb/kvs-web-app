import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { getSettings, phoneNumbers } from "@/server/modules/settings";
import { EnquiryForm } from "@/components/enquiry-form";

export const metadata: Metadata = { title: "Contact & quotations" };

export default async function ContactPage() {
  const s = await getSettings(getDb());
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 md:grid-cols-[1fr_1.4fr]">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Contact us</h1>
        <p className="mt-3 text-slate-600">Ask for a quotation, book a service or ask a question. We reply within one working day.</p>
        <dl className="mt-6 space-y-3 text-sm">
          {s.contactPhone && <div><dt className="font-semibold">Phone</dt><dd>{phoneNumbers(s).map((p, i) => <span key={p}>{i > 0 && ", "}<a href={`tel:${p.replace(/\s+/g, "")}`} className="text-teal-700">{p}</a></span>)}</dd></div>}
          {s.whatsappNumber && <div><dt className="font-semibold">WhatsApp</dt><dd>{s.whatsappNumber}</dd></div>}
          <div><dt className="font-semibold">E-mail</dt><dd><a href={`mailto:${s.contactEmail}`} className="text-teal-700">{s.contactEmail}</a></dd></div>
          {s.companyAddress && <div><dt className="font-semibold">Visit us</dt><dd>{s.companyAddress}</dd></div>}
          {s.openingHours && <div><dt className="font-semibold">Opening hours</dt><dd>{s.openingHours}</dd></div>}
        </dl>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold">Send a request</h2>
        <EnquiryForm />
      </div>
    </div>
  );
}
