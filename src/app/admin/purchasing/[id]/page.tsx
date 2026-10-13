import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getPurchaseOrder } from "@/server/modules/purchasing";
import { getSettings, phoneNumbers } from "@/server/modules/settings";
import { ActionForm } from "@/components/action-form";
import { PrintButton } from "@/components/print-button";
import { Card, DateTime, Field, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { poAction } from "../../inventory-actions";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const [d, co] = await Promise.all([
    getPurchaseOrder(db, actor, id).catch((e) => {
      if (e instanceof AppError) notFound();
      throw e;
    }),
    getSettings(db),
  ]);
  const { po, supplier, lines } = d;
  const write = can(actor, "purchasing.write");
  const receiving = write && can(actor, "inventory.adjust") && ["sent", "partially_received"].includes(po.status);
  const hidden = (op: string) => <><input type="hidden" name="id" value={po.id} /><input type="hidden" name="op" value={op} /></>;
  return (
    <>
      <Link href="/admin/purchasing" className="text-sm text-teal-700 hover:underline print:hidden">← Purchase orders</Link>
      <div className="mt-4">
        <PageHeader title={`Purchase order ${po.number}`} description={<><Link href={`/admin/suppliers/${supplier.id}`} className="text-teal-700 underline">{supplier.name}</Link> · deliver to {d.locationName}</>} actions={<><StatusBadge status={po.status} /><PrintButton /></>} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <div className="mb-4 hidden justify-between gap-6 text-sm print:flex">
              <div><p className="text-lg font-bold">{co.companyName}</p><p>{co.companyAddress}</p><p>{[...phoneNumbers(co), co.contactEmail].join(" · ")}</p>{co.companyTin && <p>TIN {co.companyTin}</p>}</div>
              <div className="text-right"><p className="font-semibold">To: {supplier.name}</p>{supplier.address && <p>{supplier.address}</p>}{supplier.phone && <p>{supplier.phone}</p>}</div>
            </div>
            <TableWrap>
              <table className="table">
                <thead><tr><th>Item</th><th className="text-right">Ordered</th><th className="text-right">Received</th><th className="text-right">Unit cost</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {lines.map(({ line }) => (
                    <tr key={line.id}>
                      <td>{line.description}</td>
                      <td className="text-right tabular-nums">{line.quantity}</td>
                      <td className={`text-right tabular-nums ${line.receivedQuantity >= line.quantity ? "text-emerald-700" : ""}`}>{line.receivedQuantity}</td>
                      <td className="text-right tabular-nums"><Money minor={line.unitCostMinor} currency={po.currency} /></td>
                      <td className="text-right tabular-nums"><Money minor={line.lineTotalMinor} currency={po.currency} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><th colSpan={4} className="text-right">Total</th><th className="text-right tabular-nums"><Money minor={po.totalMinor} currency={po.currency} /></th></tr></tfoot>
              </table>
            </TableWrap>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
              <div><dt className="font-semibold">Raised</dt><dd>{d.createdByName} · <DateTime value={po.createdAt} dateOnly /></dd></div>
              <div><dt className="font-semibold">Sent</dt><dd>{po.sentAt ? <DateTime value={po.sentAt} dateOnly /> : "—"}</dd></div>
              <div><dt className="font-semibold">Needed by</dt><dd>{po.expectedAt ? <DateTime value={po.expectedAt} dateOnly /> : "—"}</dd></div>
            </dl>
            {po.notes && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{po.notes}</p>}
          </Card>
          {d.receipts.length > 0 && (
            <Card title="Deliveries received" className="print:hidden">
              <ul className="space-y-2 text-sm">
                {d.receipts.map((r) => (
                  <li key={r.g.id}>
                    <strong>{r.g.number}</strong> · <DateTime value={r.g.createdAt} /> · {r.receivedByName}{r.g.reference && ` · ref ${r.g.reference}`} — {r.lines.reduce((a, l) => a + l.quantity, 0)} unit(s)
                    {r.lines.some((l) => l.serials.length) && <span className="block font-mono text-xs text-slate-600">{r.lines.flatMap((l) => l.serials).join(", ")}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        {write && (
          <div className="space-y-6 print:hidden">
            {po.status === "draft" && (
              <Card title="Send to supplier">
                <ActionForm action={poAction} submitLabel="Mark as sent" submitClassName="btn btn-primary w-full">
                  {hidden("send")}
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="email" defaultChecked={!!supplier.email} disabled={!supplier.email} /> E-mail it to {supplier.email ?? "the supplier (no e-mail address on file)"}</label>
                </ActionForm>
              </Card>
            )}
            {receiving && (
              <Card title="Receive a delivery">
                <ActionForm action={poAction} submitLabel="Receive into stock" submitClassName="btn btn-accent w-full" resetOnSuccess>
                  {hidden("receive")}
                  {lines.filter(({ line }) => line.receivedQuantity < line.quantity).map(({ line, serialTracked }) => (
                    <div key={line.id} className="rounded-lg border border-slate-200 p-2">
                      <Field label={`${line.description} — ${line.quantity - line.receivedQuantity} to come`} htmlFor={`recv_${line.id}`}>
                        <input id={`recv_${line.id}`} name={`recv_${line.id}`} type="number" min={0} max={line.quantity - line.receivedQuantity} className="field" placeholder="0" />
                      </Field>
                      {serialTracked && (
                        <Field label="Serial numbers" htmlFor={`serials_${line.id}`}><textarea id={`serials_${line.id}`} name={`serials_${line.id}`} rows={2} className="field font-mono text-sm uppercase" /></Field>
                      )}
                    </div>
                  ))}
                  <Field label="Delivery note / invoice no." htmlFor="reference"><input id="reference" name="reference" className="field" maxLength={80} /></Field>
                </ActionForm>
              </Card>
            )}
            {["draft", "sent", "partially_received"].includes(po.status) && (
              <Card title={po.status === "partially_received" ? "Close short" : "Cancel"}>
                <ActionForm action={poAction} submitLabel={po.status === "partially_received" ? "Close — nothing more is coming" : "Cancel purchase order"} submitClassName="btn btn-danger w-full" confirm="Close this purchase order?">
                  {hidden("cancel")}
                  <Field label="Reason" htmlFor="reason"><input id="reason" name="reason" className="field" required minLength={3} /></Field>
                </ActionForm>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}
