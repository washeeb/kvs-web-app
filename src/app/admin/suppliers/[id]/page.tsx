import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getSupplier } from "@/server/modules/purchasing";
import { ActionForm } from "@/components/action-form";
import { SupplierFields } from "@/components/supplier-fields";
import { Card, DateTime, EmptyState, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { supplierAction } from "../../inventory-actions";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const d = await getSupplier(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const write = can(actor, "purchasing.write");
  return (
    <>
      <Link href="/admin/suppliers" className="text-sm text-teal-700 hover:underline">← Suppliers</Link>
      <div className="mt-4"><PageHeader title={d.supplier.name} actions={write ? <Link href={`/admin/purchasing/new?supplier=${d.supplier.id}`} className="btn btn-primary">New purchase order</Link> : undefined} /></div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Details">
          {write ? <ActionForm action={supplierAction} submitLabel="Save"><SupplierFields s={d.supplier} /></ActionForm> : <p className="text-sm">{[d.supplier.contactName, d.supplier.phone, d.supplier.email, d.supplier.address].filter(Boolean).join(" · ")}</p>}
        </Card>
        <div className="space-y-6">
          <Card title="Purchase orders">
            {d.purchaseOrders.length === 0 ? <EmptyState title="None yet" /> : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Number</th><th>Status</th><th className="text-right">Total</th><th>Date</th></tr></thead>
                  <tbody>
                    {d.purchaseOrders.map((po) => (
                      <tr key={po.id}>
                        <td><Link href={`/admin/purchasing/${po.id}`} className="text-teal-700 hover:underline">{po.number}</Link></td>
                        <td><StatusBadge status={po.status} /></td>
                        <td className="text-right"><Money minor={po.totalMinor} currency={po.currency} /></td>
                        <td className="text-xs"><DateTime value={po.createdAt} dateOnly /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
          <Card title="Items usually bought here">
            {d.items.length === 0 ? <p className="text-sm text-slate-600">Set a preferred supplier on a product&apos;s stock settings to list it here and include it in reorder drafts.</p> : (
              <ul className="space-y-1 text-sm">{d.items.map((i) => <li key={i.id}><Link href={`/admin/products/${i.productId}`} className="text-teal-700 hover:underline">{i.name}</Link> <span className="font-mono text-xs text-slate-600">{i.sku}</span></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
