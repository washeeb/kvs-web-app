import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listEnquiries } from "@/server/modules/enquiries";
import { serviceTitle } from "@/content/services";
import { Card, DateTime, EmptyState, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Enquiries" };

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "new", label: "New" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "all", label: "All" },
];

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "enquiries.read")) return <EmptyState title="You can't open this page" />;
  const wanted = (await searchParams).show;
  const show = FILTERS.find((f) => f.key === wanted)?.key ?? "open";
  const rows = await listEnquiries(getDb(), actor, show === "all" ? undefined : show);
  return (
    <>
      <PageHeader title="Enquiries" description="Requests from the website. Assign them, call back, then create a customer and quotation." actions={<LiveRefresh topics={["leads"]} />} />
      <nav aria-label="Enquiry filters" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/admin/enquiries?show=${f.key}`} aria-current={f.key === show ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm font-medium ${f.key === show ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{f.label}</Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No enquiries here" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Enquiry</th><th>From</th><th>Service</th><th>Status</th><th>Assigned</th><th>Received</th></tr></thead>
              <tbody>
                {rows.map(({ e, assigneeName }) => (
                  <tr key={e.id}>
                    <td><Link href={`/admin/enquiries/${e.id}`} className="font-medium text-teal-700 hover:underline">{e.number}</Link></td>
                    <td>{e.name}{e.company && <span className="block text-xs text-slate-600">{e.company}</span>}</td>
                    <td className="text-xs">{serviceTitle(e.serviceLine)}</td>
                    <td><StatusBadge status={e.status} /></td>
                    <td className="text-xs">{assigneeName ?? <span className="text-slate-600">—</span>}</td>
                    <td className="text-xs"><DateTime value={e.createdAt} /></td>
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
