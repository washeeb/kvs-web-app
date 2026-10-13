import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listCustomers } from "@/server/modules/customers";
import { listProductsAdmin } from "@/server/modules/catalogue";
import { SERVICE_LINES } from "@/content/services";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { QuoteBuilder } from "./quote-builder";
import { createQuoteAction } from "../../actions";

export const metadata: Metadata = { title: "New quotation" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ customer?: string; enquiry?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "quotes.write")) return <EmptyState title="You can't open this page" />;
  const sp = await searchParams;
  const db = getDb();
  const [customers, products] = await Promise.all([listCustomers(db, actor), listProductsAdmin(db, actor)]);
  const variants = products.filter((p) => p.status === "active").flatMap((p) => p.variants.map((v) => ({ id: v.id, label: `${p.name} — ${v.name} (${v.sku})`, priceMinor: v.priceMinor })));
  return (
    <>
      <Link href="/admin/quotes" className="text-sm text-teal-700 hover:underline">← Quotations</Link>
      <div className="mt-4"><PageHeader title="New quotation" description="Add shop items and/or custom lines (design work, installation, training days). Prices exclude taxes; the system adds them." /></div>
      {customers.length === 0 ? (
        <EmptyState title="Add a customer first"><Link href="/admin/customers/new" className="text-teal-700 underline">New customer</Link></EmptyState>
      ) : (
        <Card>
          <ActionForm action={createQuoteAction} submitLabel="Create quotation">
            <input type="hidden" name="enquiryId" value={sp.enquiry ?? ""} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Customer" htmlFor="customerId">
                <select id="customerId" name="customerId" className="field" required defaultValue={sp.customer ?? ""}>
                  <option value="" disabled>Choose…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ""}</option>)}
                </select>
              </Field>
              <Field label="Service" htmlFor="serviceLine">
                <select id="serviceLine" name="serviceLine" className="field" defaultValue="">
                  <option value="">General / shop items</option>
                  {SERVICE_LINES.map((s) => <option key={s.slug} value={s.slug}>{s.title}</option>)}
                </select>
              </Field>
              <Field label="Discount (%)" htmlFor="discountPercent"><input id="discountPercent" name="discountPercent" type="number" min={0} max={50} step="0.5" defaultValue={0} className="field" /></Field>
            </div>
            <QuoteBuilder variants={variants} />
            <Field label="Notes shown on the quotation (optional)" htmlFor="notes"><textarea id="notes" name="notes" rows={3} className="field" maxLength={2000} placeholder="Delivery time, payment terms, what is not included…" /></Field>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
