import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getQuote } from "@/server/modules/quotes";
import { getSettings } from "@/server/modules/settings";
import { SERVICE_LINES, serviceTitle } from "@/content/services";
import { ActionForm } from "@/components/action-form";
import { PrintButton } from "@/components/print-button";
import { Card, DateTime, Field, Money, StatusBadge } from "@/components/ui";
import { quoteAction } from "../../actions";

export const metadata: Metadata = { title: "Quotation" };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const q = await getQuote(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const s = await getSettings(db);
  const write = can(actor, "quotes.write");
  const hidden = (op: string) => <><input type="hidden" name="id" value={q.id} /><input type="hidden" name="op" value={op} /></>;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/quotes" className="text-sm text-teal-700 hover:underline">← Quotations</Link>
        <PrintButton />
      </div>
      <h1 className="sr-only">Quotation {q.number}</h1>
      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_320px] print:block">
        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-lg font-bold">{s.companyName}</p>
              {s.companyAddress && <p className="text-sm text-slate-600">{s.companyAddress}</p>}
              <p className="text-sm text-slate-600">{[s.contactPhone, s.contactEmail].filter(Boolean).join(" · ")}</p>
              {s.companyTin && <p className="text-sm text-slate-600">TIN {s.companyTin}</p>}
            </div>
            <div className="text-right">
              <h2 className="text-2xl font-bold">Quotation {q.number}</h2>
              <StatusBadge status={q.status} />
            </div>
          </div>
          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
            <div><dt className="font-semibold">For</dt><dd><Link href={`/admin/customers/${q.customer.id}`} className="text-teal-700 print:text-slate-900">{q.customer.name}</Link>{q.customer.company && <span className="block">{q.customer.company}</span>}</dd></div>
            <div><dt className="font-semibold">Date</dt><dd><DateTime value={q.createdAt} dateOnly /></dd></div>
            <div><dt className="font-semibold">Valid until</dt><dd><DateTime value={q.validUntil} dateOnly /></dd></div>
          </dl>
          {q.serviceLine && <p className="mt-2 text-sm text-slate-600">{serviceTitle(q.serviceLine)}</p>}
          <div className="mt-6 overflow-x-auto">
            <table className="table">
              <thead><tr><th>Description</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {q.lines.map((l) => (
                  <tr key={l.id}><td>{l.description}{!l.taxable && <span className="ml-1 text-xs text-slate-600">(tax exempt)</span>}</td><td className="text-right">{l.quantity}</td><td className="text-right"><Money minor={l.unitPriceMinor} currency={q.currency} /></td><td className="text-right"><Money minor={l.lineTotalMinor} currency={q.currency} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd><Money minor={q.subtotalMinor} currency={q.currency} /></dd></div>
            {q.discountMinor > 0 && <div className="flex justify-between"><dt>Discount ({q.discountBp / 100}%)</dt><dd>−<Money minor={q.discountMinor} currency={q.currency} /></dd></div>}
            {q.taxBreakdown.map((t) => <div key={t.code} className="flex justify-between"><dt>{t.name}</dt><dd><Money minor={t.amountMinor} currency={q.currency} /></dd></div>)}
            <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold"><dt>Total</dt><dd><Money minor={q.totalMinor} currency={q.currency} /></dd></div>
          </dl>
          {q.notes && <p className="mt-6 whitespace-pre-line text-sm text-slate-700">{q.notes}</p>}
        </article>
        <div className="min-w-0 space-y-6 print:hidden">
          {(q.order || q.job) && (
            <Card title="Result">
              <ul className="space-y-1 text-sm">
                {q.order && <li>Order <Link href={`/admin/orders/${q.order.id}`} className="text-teal-700 underline">{q.order.number}</Link></li>}
                {q.job && <li>Job <Link href={`/admin/jobs/${q.job.id}`} className="text-teal-700 underline">{q.job.number}</Link></li>}
              </ul>
            </Card>
          )}
          {write && ["draft", "sent"].includes(q.status) && (
            <Card title="Actions">
              <div className="space-y-4">
                <ActionForm action={quoteAction} submitLabel={q.status === "draft" ? "Mark as sent (and e-mail)" : "Send again"} submitClassName="btn btn-primary w-full">{hidden("send")}</ActionForm>
                {q.status === "sent" && (
                  <ActionForm action={quoteAction} submitLabel="Customer accepted" submitClassName="btn btn-accent w-full">
                    {hidden("accept")}
                    {can(actor, "jobs.write") && (
                      <>
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="createJob" defaultChecked={!!q.serviceLine} /> Also create a service job</label>
                        <Field label="Job title" htmlFor="jobTitle"><input id="jobTitle" name="jobTitle" className="field" maxLength={160} placeholder={`Work for ${q.number}`} /></Field>
                        {!q.serviceLine && (
                          <Field label="Job service" htmlFor="serviceLine">
                            <select id="serviceLine" name="serviceLine" className="field" defaultValue="">
                              <option value="">Choose…</option>
                              {SERVICE_LINES.map((l) => <option key={l.slug} value={l.slug}>{l.title}</option>)}
                            </select>
                          </Field>
                        )}
                      </>
                    )}
                  </ActionForm>
                )}
                <ActionForm action={quoteAction} submitLabel="Customer declined" submitClassName="btn btn-ghost w-full" confirm="Mark this quotation as declined?">{hidden("decline")}</ActionForm>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
