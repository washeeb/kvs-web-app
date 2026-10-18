import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listProductsAdmin } from "@/server/modules/catalogue";
import { AvailabilityBadge } from "@/components/availability";
import { Badge, Card, EmptyState, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Products & stock" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "catalogue.read")) return <EmptyState title="You can't open this page" />;
  const { q } = await searchParams;
  const rows = await listProductsAdmin(getDb(), actor, q);
  return (
    <>
      <PageHeader title="Products & stock" description="Shop items, prices, costs and stock. Products marked “Synclytics” are offered to SES through the partner link." actions={<><LiveRefresh topics={["catalogue", "stock"]} />{can(actor, "catalogue.write") && <Link href="/admin/products/new" className="btn btn-primary">New product</Link>}</>} />
      <form role="search" className="mb-4 flex max-w-md gap-2">
        <label htmlFor="q" className="sr-only">Search products</label>
        <input id="q" name="q" defaultValue={q} placeholder="Product name" className="field" />
        <button className="btn btn-primary" type="submit">Search</button>
      </form>
      <Card>
        {rows.length === 0 ? <EmptyState title="No products yet" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Product</th><th>Status</th><th>Options</th><th>Stock</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/admin/products/${p.id}`} className="font-medium text-teal-700 hover:underline">{p.name}</Link>
                      <span className="block text-xs text-slate-600">{p.categoryName ?? "No category"}</span>
                      <span className="flex gap-1">{p.sesSync && <Badge tone="purple">Synclytics</Badge>}{p.isDemo && <Badge tone="amber">demo</Badge>}</span>
                    </td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="text-xs">{p.variants.map((v) => <span key={v.id} className="block">{v.sku} · {v.priceMinor === null ? <span className="text-amber-800">price on request</span> : <Money minor={v.priceMinor} currency={v.currency} />}</span>)}</td>
                    <td className="space-y-1">{p.variants.map((v) => <span key={v.id} className="block"><AvailabilityBadge a={v.availability} showCount /></span>)}</td>
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
