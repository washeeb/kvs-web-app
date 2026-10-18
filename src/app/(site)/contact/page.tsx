import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { getSettings, phoneNumbers } from "@/server/modules/settings";
import { EnquiryForm } from "@/components/enquiry-form";
import { getShopProduct } from "@/server/modules/catalogue";

export const metadata: Metadata = { title: "Contact & quotations" };

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const db = getDb();
  const s = await getSettings(db);
  // "Request a quote" from a product priced on request pre-fills the message.
  const slug = (await searchParams).product;
  const product = slug && /^[a-z0-9-]{1,120}$/.test(slug) ? await getShopProduct(db, slug).catch(() => null) : null;
  const message = product ? `Please send me a quotation for: ${product.name} (SKU ${product.variants[0]?.sku ?? "-"}).\nQuantity: \nDelivery or pickup: ` : "";
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
        {product && <p className="mb-4 rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-900">Quotation request for <strong>{product.name}</strong>. Add the quantity and anything else we should know.</p>}
        <EnquiryForm message={message} />
      </div>
    </div>
  );
}
