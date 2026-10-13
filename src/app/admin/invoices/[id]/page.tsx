import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { balanceOf, getInvoice, OPEN_STATUSES, PAYMENT_METHOD_LABEL } from "@/server/modules/invoices";
import { getSettings } from "@/server/modules/settings";
import { ActionForm } from "@/components/action-form";
import { InvoiceDocument } from "@/components/invoice-document";
import { PrintButton } from "@/components/print-button";
import { Card, DateTime, Field, Money, StatusBadge } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { paymentAction } from "../../actions";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const inv = await getInvoice(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const s = await getSettings(db);
  const finance = can(actor, "finance.write");
  const open = OPEN_STATUSES.includes(inv.status);
  const today = new Date().toISOString().slice(0, 10);
  const hidden = (op: string) => <><input type="hidden" name="id" value={inv.id} /><input type="hidden" name="op" value={op} /></>;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/invoices" className="text-sm text-teal-700 hover:underline">← Invoices</Link>
        <div className="flex items-center gap-3"><LiveRefresh topics={["invoices"]} /><PrintButton /></div>
      </div>
      <h1 className="sr-only">Invoice {inv.number}</h1>
      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_340px] print:block">
        <InvoiceDocument inv={inv} settings={s} orderHref={inv.orderId ? `/admin/orders/${inv.orderId}` : null} now={new Date()} />
        <div className="min-w-0 space-y-6 print:hidden">
          <Card title="Payments">
            {inv.payments.length === 0 ? <p className="text-sm text-slate-600">No payments yet.</p> : (
              <ul className="space-y-3 text-sm">
                {inv.payments.map(({ p, recordedByName }) => (
                  <li key={p.id} className="border-b border-slate-100 pb-3 last:border-0">
                    <p className="flex flex-wrap items-center gap-2"><Money minor={p.amountMinor} currency={p.currency} /><StatusBadge status={p.status} /><span className="text-slate-600">{PAYMENT_METHOD_LABEL[p.method ?? ""] ?? p.method ?? p.provider}</span>{p.mode === "test" && <span className="text-xs text-amber-800">(test)</span>}</p>
                    <p className="text-xs text-slate-600">{p.externalReference ? `Ref. ${p.externalReference}` : p.reference} · {p.paidAt ? <DateTime value={p.paidAt} dateOnly /> : <DateTime value={p.createdAt} />}{recordedByName && ` · by ${recordedByName}`}</p>
                    {p.failureReason && <p className="text-xs text-slate-600">{p.failureReason}</p>}
                    {finance && p.provider === "manual" && p.status === "success" && p.recordedBy !== actor.userId && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-red-700 underline">Reverse this payment</summary>
                        <ActionForm action={paymentAction} submitLabel="Reverse" submitClassName="btn btn-danger" confirm="Reverse this payment? The balance goes back up.">
                          {hidden("reverse")}<input type="hidden" name="paymentId" value={p.id} />
                          <Field label="Reason" htmlFor={`rr-${p.id}`}><input id={`rr-${p.id}`} name="reason" className="field" required minLength={5} maxLength={300} /></Field>
                        </ActionForm>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {finance && open && (
            <Card title="Record a payment">
              <ActionForm action={paymentAction} submitLabel="Record payment" resetOnSuccess>
                {hidden("record")}
                <Field label="Amount (GHS)" htmlFor="amount" hint={`Balance ${(balanceOf(inv) / 100).toFixed(2)}`}><input id="amount" name="amount" className="field" inputMode="decimal" required defaultValue={(balanceOf(inv) / 100).toFixed(2)} /></Field>
                <Field label="Method" htmlFor="method">
                  <select id="method" name="method" className="field" defaultValue="mobile_money">
                    <option value="mobile_money">Mobile money</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option>
                  </select>
                </Field>
                <Field label="MoMo transaction ID / bank ref / receipt no." htmlFor="externalReference"><input id="externalReference" name="externalReference" className="field" required minLength={2} maxLength={100} /></Field>
                <Field label="Date received" htmlFor="paidOn"><input id="paidOn" name="paidOn" type="date" className="field" required max={today} defaultValue={today} /></Field>
                <Field label="Note (optional)" htmlFor="note"><input id="note" name="note" className="field" maxLength={500} /></Field>
              </ActionForm>
            </Card>
          )}
          {finance && open && inv.paidMinor === 0 && (
            <Card title="Void invoice">
              <ActionForm action={paymentAction} submitLabel="Void invoice" submitClassName="btn btn-danger" confirm="Void this invoice?">
                {hidden("void")}
                <Field label="Reason" htmlFor="voidReason"><input id="voidReason" name="reason" className="field" required minLength={5} maxLength={300} /></Field>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
