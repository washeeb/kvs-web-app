import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listQuotes } from "@/server/modules/quotes";
import { Card, DateTime, EmptyState, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Quotations" };

export default async function QuotesPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "quotes.read")) return <EmptyState title="You can't open this page" />;
  const rows = await listQuotes(getDb(), actor);
  return (
    <>
      <PageHeader title="Quotations" description="Prepare, send and record the customer's decision. Accepting creates the order, invoice and (optionally) a service job." actions={<><LiveRefresh topics={["quotes"]} />{can(actor, "quotes.write") && <Link href="/admin/quotes/new" className="btn btn-primary">New quotation</Link>}</>} />
      <Card>
        {rows.length === 0 ? <EmptyState title="No quotations yet" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Quotation</th><th>Customer</th><th>Status</th><th className="text-right">Total</th><th>Valid until</th></tr></thead>
              <tbody>
                {rows.map(({ q, customerName, company }) => (
                  <tr key={q.id}>
                    <td><Link href={`/admin/quotes/${q.id}`} className="font-medium text-teal-700 hover:underline">{q.number}</Link></td>
                    <td>{customerName}{company && <span className="block text-xs text-slate-600">{company}</span>}</td>
                    <td><StatusBadge status={q.status} /></td>
                    <td className="text-right"><Money minor={q.totalMinor} currency={q.currency} /></td>
                    <td className="text-xs"><DateTime value={q.validUntil} dateOnly /></td>
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
