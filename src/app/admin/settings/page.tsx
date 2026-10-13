import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { authorize } from "@/server/authz/policy";
import { getSettings, listTaxes } from "@/server/modules/settings";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader } from "@/components/ui";
import { updateSettingsAction, upsertTaxAction } from "../actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requireActor("operator");
  authorize(actor, "settings.manage");
  const db = getDb();
  const [s, taxes] = await Promise.all([getSettings(db), listTaxes(db)]);
  return (
    <>
      <PageHeader title="Settings" description="Company details appear on the website, invoices and quotations. Every change is recorded in the audit log." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Company & shop">
          <ActionForm action={updateSettingsAction} submitLabel="Save settings">
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-sm font-semibold">Company details</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company name" htmlFor="companyName"><input id="companyName" name="companyName" className="field" required defaultValue={s.companyName} /></Field>
                <Field label="GRA taxpayer ID (TIN)" htmlFor="companyTin" hint="Printed on invoices once set."><input id="companyTin" name="companyTin" className="field" maxLength={40} defaultValue={s.companyTin} /></Field>
                <Field label="Address" htmlFor="companyAddress"><input id="companyAddress" name="companyAddress" className="field" maxLength={300} defaultValue={s.companyAddress} /></Field>
                <Field label="Opening hours" htmlFor="openingHours"><input id="openingHours" name="openingHours" className="field" maxLength={200} defaultValue={s.openingHours} placeholder="Mon–Sat 8:00–18:00" /></Field>
                <Field label="Phone" htmlFor="contactPhone"><input id="contactPhone" name="contactPhone" type="tel" className="field" maxLength={40} defaultValue={s.contactPhone} /></Field>
                <Field label="Second phone" htmlFor="contactPhoneAlt"><input id="contactPhoneAlt" name="contactPhoneAlt" type="tel" className="field" maxLength={40} defaultValue={s.contactPhoneAlt} /></Field>
                <Field label="WhatsApp" htmlFor="whatsappNumber"><input id="whatsappNumber" name="whatsappNumber" className="field" maxLength={40} defaultValue={s.whatsappNumber} /></Field>
                <Field label="E-mail" htmlFor="contactEmail"><input id="contactEmail" name="contactEmail" type="email" className="field" required defaultValue={s.contactEmail} /></Field>
                <Field label="Instagram link" htmlFor="instagramUrl"><input id="instagramUrl" name="instagramUrl" type="url" className="field" defaultValue={s.instagramUrl} /></Field>
                <Field label="Facebook link" htmlFor="facebookUrl"><input id="facebookUrl" name="facebookUrl" type="url" className="field" defaultValue={s.facebookUrl} /></Field>
              </div>
            </fieldset>
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-sm font-semibold">Payments & shop</legend>
              <p className="mb-3 text-xs text-slate-600">Shown on invoices, on the customer&apos;s order page and in order e-mails. Leave a field empty to hide it.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Mobile money number" htmlFor="momoNumber"><input id="momoNumber" name="momoNumber" type="tel" className="field" maxLength={40} defaultValue={s.momoNumber} /></Field>
                <Field label="Mobile money account name" htmlFor="momoName" hint="Optional."><input id="momoName" name="momoName" className="field" maxLength={120} defaultValue={s.momoName} /></Field>
                <Field label="Bank" htmlFor="bankName"><input id="bankName" name="bankName" className="field" maxLength={120} defaultValue={s.bankName} /></Field>
                <Field label="Branch" htmlFor="bankBranch"><input id="bankBranch" name="bankBranch" className="field" maxLength={120} defaultValue={s.bankBranch} /></Field>
                <Field label="Account name" htmlFor="bankAccountName"><input id="bankAccountName" name="bankAccountName" className="field" maxLength={120} defaultValue={s.bankAccountName} /></Field>
                <Field label="Account number" htmlFor="bankAccountNumber"><input id="bankAccountNumber" name="bankAccountNumber" className="field" maxLength={40} defaultValue={s.bankAccountNumber} /></Field>
              </div>
              <div className="mt-4"><Field label="Other payment notes" htmlFor="paymentInstructions" hint="Optional, e.g. cheque payee or cash at the office."><textarea id="paymentInstructions" name="paymentInstructions" rows={2} className="field" maxLength={1000} defaultValue={s.paymentInstructions} /></Field></div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Delivery note at checkout" htmlFor="deliveryNote"><input id="deliveryNote" name="deliveryNote" className="field" maxLength={500} defaultValue={s.deliveryNote} /></Field>
                <Field label="Online order limit (GHS)" htmlFor="shopOrderLimit" hint="Bigger orders must go through a quotation."><input id="shopOrderLimit" name="shopOrderLimit" className="field" defaultValue={(s.shopOrderLimitMinor / 100).toFixed(2)} /></Field>
                <Field label="Hold stock for unconfirmed orders (hours)" htmlFor="reservationHoldHours"><input id="reservationHoldHours" name="reservationHoldHours" type="number" min={1} className="field" defaultValue={s.reservationHoldHours} /></Field>
                <Field label="Invoice payment terms (days)" htmlFor="invoiceDueDays"><input id="invoiceDueDays" name="invoiceDueDays" type="number" min={0} className="field" defaultValue={s.invoiceDueDays} /></Field>
                <Field label="Quotation validity (days)" htmlFor="quoteValidityDays"><input id="quoteValidityDays" name="quoteValidityDays" type="number" min={1} className="field" defaultValue={s.quoteValidityDays} /></Field>
              </div>
            </fieldset>
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-sm font-semibold">Data Protection Commission (Ghana)</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Registration number" htmlFor="dpcRegistrationNumber"><input id="dpcRegistrationNumber" name="dpcRegistrationNumber" className="field" maxLength={60} defaultValue={s.dpcRegistrationNumber} /></Field>
                <Field label="Certificate expires" htmlFor="dpcRegistrationExpires"><input id="dpcRegistrationExpires" name="dpcRegistrationExpires" type="date" className="field" defaultValue={s.dpcRegistrationExpires} /></Field>
              </div>
            </fieldset>
          </ActionForm>
        </Card>
        <Card title="Taxes">
          <p className="mb-4 rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Seeded with Ghana&apos;s standard rates (VAT Act, 2025): VAT 15%, NHIL 2.5%, GETFund 2.5%, not compounded. <strong>Confirm KingsView&apos;s VAT registration with your accountant</strong> — if KingsView is not VAT-registered, untick “Active” on these taxes.
          </p>
          <div className="space-y-4">
            {[...taxes, null].map((t) => (
              <ActionForm key={t?.id ?? "new"} action={upsertTaxAction} className="grid items-end gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[6rem_1fr_6rem_auto]" submitLabel={t ? "Save" : "Add tax"} submitClassName="btn btn-ghost">
                <input type="hidden" name="id" value={t?.id ?? ""} />
                <input type="hidden" name="sortOrder" value={t?.sortOrder ?? taxes.length + 1} />
                <Field label="Code" htmlFor={`tc-${t?.id ?? "n"}`}><input id={`tc-${t?.id ?? "n"}`} name="code" className="field" defaultValue={t?.code} required /></Field>
                <Field label="Name" htmlFor={`tn-${t?.id ?? "n"}`}><input id={`tn-${t?.id ?? "n"}`} name="name" className="field" defaultValue={t?.name} required /></Field>
                <Field label="Rate %" htmlFor={`tr-${t?.id ?? "n"}`}><input id={`tr-${t?.id ?? "n"}`} name="ratePercent" type="number" step="0.01" className="field" defaultValue={t ? t.rateBp / 100 : ""} required /></Field>
                <div className="flex flex-col gap-1 text-xs sm:col-span-4 sm:flex-row sm:gap-4">
                  <label className="flex items-center gap-1"><input type="checkbox" name="compound" defaultChecked={t?.compound} /> Compound</label>
                  <label className="flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={t?.active ?? true} /> Active</label>
                </div>
              </ActionForm>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
