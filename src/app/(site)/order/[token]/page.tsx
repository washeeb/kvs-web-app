import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { getOrderByTracking, ORDER_STATUS_LABEL } from "@/server/modules/orders";
import { getSettings } from "@/server/modules/settings";
import { paystackConfig, verifyAndApplyPayment } from "@/server/modules/payments/paystack";
import { balanceOf, OPEN_STATUSES } from "@/server/modules/invoices";
import { log } from "@/server/lib/log";
import { ActionForm } from "@/components/action-form";
import { InvoiceDocument } from "@/components/invoice-document";
import { PrintButton } from "@/components/print-button";
import { Field, Money, StatusBadge } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { payOnlineAction } from "../../actions";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

/** Private order page for shop customers, reached only through the link we give them (no account needed). */
export default async function OrderTrackingPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ placed?: string; payment?: string }> }) {
  const { token } = await params;
  const { placed, payment } = await searchParams;
  const db = getDb();
  let found = await getOrderByTracking(db, token);
  if (!found) notFound();

  // Back from Paystack: confirm with Paystack's API (the redirect alone proves nothing).
  let note: string | null = null;
  if (payment && paystackConfig() && /^KVS-[A-Za-z0-9-]+$/.test(payment)) {
    try {
      const r = await verifyAndApplyPayment(db, payment);
      note = r === "applied" || r === "already_applied" ? "Payment received — thank you." : r === "not_successful" ? "We have not received a successful payment yet. Mobile money approvals can take a minute; this page updates automatically." : r === "amount_mismatch" ? "The amount paid does not match. We will contact you." : null;
    } catch (err) {
      log.warn("paystack.return_verify_failed", { error: err instanceof Error ? err.message : String(err) });
      note = "We could not confirm the payment yet. It will update automatically.";
    }
    found = (await getOrderByTracking(db, token))!;
  }
  const { order: o, lines, invoice } = found;
  const s = await getSettings(db);
  const cfg = paystackConfig();
  const payable = !!invoice && OPEN_STATUSES.includes(invoice.status) && ["pending", "confirmed", "ready"].includes(o.status);
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-3xl font-bold text-slate-900">Order {o.number}</h1>
        <div className="flex items-center gap-3"><LiveRefresh topics={["orders", "invoices"]} /><PrintButton /></div>
      </div>
      {placed && <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Thank you — your order is placed. <strong>Bookmark this page</strong>{o.contactEmail ? " (we have also e-mailed you the link)" : ""}: it is the only way to see your order online.</p>}
      {note && <p role="status" className="mt-4 rounded-lg bg-slate-100 px-4 py-3 text-sm">{note}</p>}
      <dl className="mt-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-5 text-sm sm:grid-cols-3 print:hidden">
        <div><dt className="font-semibold">Status</dt><dd className="mt-1"><StatusBadge status={o.status} /> <span className="block text-slate-600">{ORDER_STATUS_LABEL[o.status]}</span></dd></div>
        <div><dt className="font-semibold">Payment</dt><dd className="mt-1"><StatusBadge status={o.paymentStatus} /></dd></div>
        <div><dt className="font-semibold">{o.fulfilmentMethod === "delivery" ? "Delivery to" : "Pickup"}</dt><dd className="mt-1">{o.fulfilmentMethod === "delivery" ? o.deliveryAddress : s.companyAddress || "Our shop — we will call you when it is ready."}</dd></div>
      </dl>

      {payable && invoice && (
        <section aria-labelledby="pay-heading" className="mt-6 grid gap-6 md:grid-cols-2 print:hidden">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 id="pay-heading" className="text-lg font-semibold">Pay <Money minor={balanceOf(invoice)} currency={invoice.currency} /></h2>
            {cfg ? (
              <div className="mt-3">
                <ActionForm action={payOnlineAction} submitLabel="Pay online (card or mobile money)" submitClassName="btn btn-accent w-full">
                  <input type="hidden" name="token" value={token} />
                  {!o.contactEmail && <Field label="E-mail for your receipt" htmlFor="email"><input id="email" name="email" type="email" className="field" required maxLength={200} /></Field>}
                  <p className="text-xs text-slate-600">Secure payment by Paystack. You will come back here afterwards.</p>
                  {cfg.mode === "test" && <p className="text-xs font-semibold text-amber-800">Test mode — no real money is charged.</p>}
                </ActionForm>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-600">Online payment is coming soon. Please pay using the details opposite.</p>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
            <h2 className="text-lg font-semibold">Mobile money or bank transfer</h2>
            {s.paymentInstructions ? <p className="mt-2 whitespace-pre-line text-slate-700">{s.paymentInstructions}</p> : <p className="mt-2 text-slate-700">Call us{s.contactPhone ? ` on ${s.contactPhone}` : ""} for payment details.</p>}
            <p className="mt-2 text-slate-600">Use <strong>{invoice.number}</strong> as the reference.</p>
          </div>
        </section>
      )}

      <div className="mt-6">
        {invoice ? (
          <InvoiceDocument inv={{ ...invoice, orderNumber: o.number }} settings={s} orderHref={null} now={new Date()} />
        ) : (
          <ul className="rounded-xl border border-slate-200 bg-white p-5 text-sm">{lines.map((l) => <li key={l.id}>{l.quantity} × {l.description}</li>)}</ul>
        )}
      </div>
    </div>
  );
}
