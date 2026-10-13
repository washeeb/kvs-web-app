import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listCustomers } from "@/server/modules/customers";
import { Badge, Card, DateTime, EmptyState, PageHeader, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "customers.read")) return <EmptyState title="You can't open this page" />;
  const { q } = await searchParams;
  const rows = await listCustomers(getDb(), actor, q);
  return (
    <>
      <PageHeader title="Customers" description="Everyone who has ordered, asked for a quotation or booked a job." actions={can(actor, "customers.write") ? <Link href="/admin/customers/new" className="btn btn-primary">New customer</Link> : undefined} />
      <form role="search" className="mb-4 flex max-w-md gap-2">
        <label htmlFor="q" className="sr-only">Search customers</label>
        <input id="q" name="q" defaultValue={q} placeholder="Name, phone, e-mail or number" className="field" />
        <button className="btn btn-primary" type="submit">Search</button>
      </form>
      <Card>
        {rows.length === 0 ? <EmptyState title="No customers found" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Customer</th><th>Phone</th><th>E-mail</th><th>Since</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/admin/customers/${c.id}`} className="font-medium text-teal-700 hover:underline">{c.name}</Link>{c.company && <span className="block text-xs text-slate-600">{c.company}</span>}{c.isDemo && <Badge tone="amber">Demonstration</Badge>}</td>
                    <td>{c.phone ?? "—"}</td>
                    <td className="text-xs">{c.email ?? "—"}</td>
                    <td className="text-xs"><DateTime value={c.createdAt} dateOnly /></td>
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
