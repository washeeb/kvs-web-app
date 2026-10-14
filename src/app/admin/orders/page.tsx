import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listOrders } from "@/server/modules/orders";
import { Badge, Card, DateTime, EmptyState, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Orders" };

const FILTERS = [
  { key: "open", label: "To do" },
  { key: "ses", label: "From Synclytics" },
  { key: "done", label: "Completed & closed" },
  { key: "all", label: "All" },
] as const;
const SOURCE: Record<string, string> = { shop: "Website shop", quote: "Quotation", ses: "Synclytics" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "orders.read")) return <EmptyState title="You can't open this page" />;
  const wanted = (await searchParams).show;
  const show = FILTERS.find((f) => f.key === wanted)?.key ?? "open";
  const rows = await listOrders(getDb(), actor, show);
  return (
    <>
      <PageHeader title="Orders" description="Confirm new orders, prepare them, mark them ready, then completed when collected or delivered." actions={<LiveRefresh topics={["orders"]} />} />
      <nav aria-label="Order filters" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/admin/orders?show=${f.key}`} aria-current={f.key === show ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm font-medium ${f.key === show ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{f.label}</Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? <EmptyState title="No orders here" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Order</th><th>Customer</th><th>Source</th><th>Status</th><th>Payment</th><th className="text-right">Total</th><th>Placed</th></tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td><Link href={`/admin/orders/${o.id}`} className="font-medium text-teal-700 hover:underline">{o.number}</Link>{o.isDemo && <Badge tone="amber">demo</Badge>}</td>
                    <td>{o.contactName}<span className="block text-xs text-slate-600">{o.fulfilmentMethod === "delivery" ? "Delivery" : "Pickup"}</span></td>
                    <td className="text-xs">{SOURCE[o.source]}{o.sesOrderNumber && <span className="block">{o.sesOrderNumber}</span>}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td><StatusBadge status={o.paymentStatus} /></td>
                    <td className="text-right"><Money minor={o.totalMinor} currency={o.currency} /></td>
                    <td className="text-xs"><DateTime value={o.createdAt} /></td>
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
