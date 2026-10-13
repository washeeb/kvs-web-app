import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listPurchaseOrders } from "@/server/modules/purchasing";
import { Card, DateTime, EmptyState, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Purchase orders" };

const FILTERS: [string, string][] = [["", "All"], ["draft", "Draft"], ["sent", "Sent"], ["partially_received", "Part received"], ["received", "Received"], ["cancelled", "Cancelled"]];

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "purchasing.read")) return <EmptyState title="You can't open this page" />;
  const { status = "" } = await searchParams;
  const rows = await listPurchaseOrders(getDb(), actor, status || undefined);
  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Order stock from suppliers, e-mail the order, and receive deliveries against it (in parts if needed). Receiving updates stock and the average cost."
        actions={
          <>
            <LiveRefresh topics={["purchasing", "stock"]} />
            {can(actor, "data.export") && <a className="btn btn-ghost" href={`/api/exports/purchase-orders`} download>Export CSV</a>}
            <Link href="/admin/inventory/reorder" className="btn btn-ghost">Reorder list</Link>
            {can(actor, "purchasing.write") && <Link href="/admin/purchasing/new" className="btn btn-primary">New purchase order</Link>}
          </>
        }
      />
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2 text-sm">
        {FILTERS.map(([v, l]) => (
          <Link key={v} href={v ? `?status=${v}` : "?"} aria-current={status === v ? "page" : undefined} className={`rounded-full px-3 py-1 ${status === v ? "bg-teal-700 text-white" : "bg-white ring-1 ring-slate-200 hover:bg-slate-50"}`}>{l}</Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? <EmptyState title="No purchase orders" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Number</th><th>Supplier</th><th>Status</th><th className="text-right">Total</th><th>Expected</th><th>Created</th></tr></thead>
              <tbody>
                {rows.map(({ po, supplierName }) => (
                  <tr key={po.id}>
                    <td><Link href={`/admin/purchasing/${po.id}`} className="font-medium text-teal-700 hover:underline">{po.number}</Link></td>
                    <td>{supplierName}</td>
                    <td><StatusBadge status={po.status} /></td>
                    <td className="text-right tabular-nums"><Money minor={po.totalMinor} currency={po.currency} /></td>
                    <td className="text-xs">{po.expectedAt ? <DateTime value={po.expectedAt} dateOnly /> : "—"}</td>
                    <td className="text-xs"><DateTime value={po.createdAt} dateOnly /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
