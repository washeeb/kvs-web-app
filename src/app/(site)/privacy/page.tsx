import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { getSettings } from "@/server/modules/settings";

export const metadata: Metadata = { title: "Privacy" };

export default async function PrivacyPage() {
  const s = await getSettings(getDb());
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold text-slate-900">Privacy notice</h1>
      <p className="mt-3 text-sm text-slate-600">
        {s.companyName} processes personal data in line with Ghana&apos;s Data Protection Act, 2012 (Act 843).
        {s.dpcRegistrationNumber && <> Registered with the Data Protection Commission, registration no. <strong>{s.dpcRegistrationNumber}</strong>.</>}
      </p>
      <div className="mt-6 space-y-4 text-slate-700">
        <p>We collect the details you give us in request and order forms — name, phone, e-mail, organisation, delivery address and your message — to reply to you, deliver orders and provide services.</p>
        <p>Online payments are processed by Paystack; we never see or store card details. Mobile money and bank payments are recorded with their transaction reference only.</p>
        <p>We do not sell personal data. When Synclytics Enterprise Systems orders goods from us for its own customers, we receive only the items and quantities — not their customers&apos; personal details.</p>
        <p>Staff access to personal data is limited to what each role needs and is logged.</p>
        <p>
          To ask for a copy, correction or deletion of your data, contact <a className="text-teal-700 underline" href={`mailto:${s.contactEmail}`}>{s.contactEmail}</a>.
        </p>
      </div>
    </div>
  );
}
