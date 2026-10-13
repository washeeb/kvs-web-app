import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getOrder, ORDER_STATUS_LABEL } from "@/server/modules/orders";
import { balanceOf, invoiceForOrder } from "@/server/modules/invoices";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, Field, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { orderAction } from "../../actions";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const o = await getOrder(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const invoice = await invoiceForOrder(db, o.id);
  const write = can(actor, "orders.write");
  const hidden = (op: string) => <><input type="hidden" name="id" value={o.id} /><input type="hidden" name="op" value={op} /></>;
  const ses = o.source === "ses";
  return (
    <>
      <Link href="/admin/orders" className="text-sm text-teal-700 hover:underline">← Orders</Link>
      <div className="mt-4">
        <PageHeader
          title={`Order ${o.number}`}
          description={<>{ses ? <>Synclytics order <strong>{o.sesOrderNumber}</strong></> : o.customer ? <Link href={`/admin/customers/${o.customer.id}`} className="text-teal-700 underline">{o.contactName}</Link> : o.contactName} · placed <DateTime value={o.createdAt} /></>}
          actions={<><LiveRefresh topics={["orders", "invoices"]} /><StatusBadge status={o.status} /><StatusBadge status={o.paymentStatus} /></>}
        />
      </div>
      <p className="-mt-3 mb-6 text-sm text-slate-600">{ORDER_STATUS_LABEL[o.status]}</p>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Card title="Items">
            <TableWrap>
              <table className="table">
                <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Amount</th>{ses && <th>SES line</th>}</tr></thead>
                <tbody>
                  {o.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.description}</td>
                      <td className="text-right">{l.quantity}</td>
                      <td className="text-right"><Money minor={l.lineTotalMinor} currency={o.currency} /></td>
                      {ses && <td>{l.fulfilmentStatus && <StatusBadge status={l.fulfilmentStatus} />}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd><Money minor={o.subtotalMinor} currency={o.currency} /></dd></div>
              {o.discountMinor > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>−<Money minor={o.discountMinor} currency={o.currency} /></dd></div>}
              <div className="flex justify-between"><dt>Taxes</dt><dd><Money minor={o.taxMinor} currency={o.currency} /></dd></div>
              <div className="flex justify-between font-bold"><dt>Total</dt><dd><Money minor={o.totalMinor} currency={o.currency} /></dd></div>
            </dl>
            {o.notes && <p className="mt-4 whitespace-pre-line text-sm text-slate-700">Note: {o.notes}</p>}
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card title={ses ? "Supply to Synclytics" : "Customer"}>
            <dl className="space-y-2 text-sm">
              {!ses && <div><dt className="font-semibold">Contact</dt><dd>{o.contactName} · {o.contactPhone ? <a href={`tel:${o.contactPhone}`} className="text-teal-700">{o.contactPhone}</a> : "—"}{o.contactEmail && <span className="block">{o.contactEmail}</span>}</dd></div>}
              <div><dt className="font-semibold">{o.fulfilmentMethod === "delivery" ? "Delivery" : "Pickup"}</dt><dd>{o.fulfilmentMethod === "delivery" ? o.deliveryAddress ?? (ses ? "To Synclytics as agreed" : "—") : "From the shop"}</dd></div>
            </dl>
          </Card>
          <Card title="Invoice">
            {invoice ? (
              <p className="text-sm">
                {can(actor, "finance.read") ? <Link href={`/admin/invoices/${invoice.id}`} className="font-medium text-teal-700 underline">{invoice.number}</Link> : invoice.number} · <StatusBadge status={invoice.status} />
                <span className="block text-slate-600">Balance <Money minor={balanceOf(invoice)} currency={invoice.currency} /></span>
              </p>
            ) : (
              <>
                <p className="text-sm text-slate-600">No open invoice.</p>
                {can(actor, "finance.write") && !["cancelled", "expired"].includes(o.status) && <ActionForm action={orderAction} submitLabel="Issue invoice" submitClassName="btn btn-ghost">{hidden("invoice")}</ActionForm>}
              </>
            )}
          </Card>
          {write && ["pending", "confirmed", "ready"].includes(o.status) && (
            <Card title="Next step">
              <div className="space-y-3">
                {o.status === "pending" && <ActionForm action={orderAction} submitLabel="Confirm order" submitClassName="btn btn-primary w-full">{hidden("confirm")}</ActionForm>}
                {o.status === "confirmed" && (
                  <ActionForm action={orderAction} submitLabel={o.fulfilmentMethod === "delivery" ? "Out for delivery" : "Ready for pickup"} submitClassName="btn btn-primary w-full">
                    {hidden("ready")}
                    {ses && <Field label="Dispatch reference (optional)" htmlFor="trackingReference"><input id="trackingReference" name="trackingReference" className="field" maxLength={120} /></Field>}
                  </ActionForm>
                )}
                {["confirmed", "ready"].includes(o.status) && <ActionForm action={orderAction} submitLabel={o.fulfilmentMethod === "delivery" ? "Delivered — complete" : "Collected — complete"} submitClassName="btn btn-accent w-full">{hidden("fulfil")}</ActionForm>}
                <ActionForm action={orderAction} submitLabel="Cancel order" submitClassName="btn btn-danger w-full" confirm="Cancel this order and release its stock?">
                  {hidden("cancel")}
                  <Field label="Reason" htmlFor="reason"><input id="reason" name="reason" className="field" required minLength={3} maxLength={300} /></Field>
                </ActionForm>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
