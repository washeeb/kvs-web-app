import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { balanceOf, isOverdue, listInvoices, receivables, type InvoiceFilter } from "@/server/modules/invoices";
import { Badge, Card, DateTime, EmptyState, Money, PageHeader, Stat, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Invoices & payments" };

const FILTERS: { key: InvoiceFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
  { key: "all", label: "All" },
];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "finance.read")) return <EmptyState title="You can't open this page" />;
  const wanted = (await searchParams).show;
  const filter = FILTERS.find((f) => f.key === wanted)?.key ?? "open";
  const db = getDb();
  const [rows, totals] = await Promise.all([listInvoices(db, actor, filter), receivables(db, actor)]);
  const now = new Date();
  return (
    <>
      <PageHeader title="Invoices & payments" description="Every order gets an invoice. Record mobile money, bank, cash and cheque payments here; Paystack payments record themselves once verified." actions={<LiveRefresh topics={["invoices"]} />} />
      {totals && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Stat label="Owed to us" value={<Money minor={totals.outstandingMinor} />} />
          <Stat label="Overdue" value={<Money minor={totals.overdueMinor} />} tone={totals.overdueMinor ? "red" : undefined} />
          <Stat label="Open invoices" value={totals.openCount} />
        </div>
      )}
      <nav aria-label="Invoice filters" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/admin/invoices?show=${f.key}`} aria-current={f.key === filter ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm font-medium ${f.key === filter ? "bg-brand-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{f.label}</Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? <EmptyState title="No invoices here" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Invoice</th><th>Bill to</th><th>Status</th><th>Due</th><th className="text-right">Total</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                {rows.map(({ invoice: inv, orderNumber }) => (
                  <tr key={inv.id}>
                    <td><Link href={`/admin/invoices/${inv.id}`} className="font-medium text-teal-700 hover:underline">{inv.number}</Link>{orderNumber && <span className="block text-xs text-slate-600">Order {orderNumber}</span>}</td>
                    <td>{inv.billToName}</td>
                    <td className="space-x-1"><StatusBadge status={inv.status} />{isOverdue(inv, now) && <Badge tone="red">overdue</Badge>}</td>
                    <td className="text-xs"><DateTime value={inv.dueAt} dateOnly /></td>
                    <td className="text-right"><Money minor={inv.totalMinor} currency={inv.currency} /></td>
                    <td className="text-right"><Money minor={inv.status === "void" ? 0 : balanceOf(inv)} currency={inv.currency} /></td>
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
