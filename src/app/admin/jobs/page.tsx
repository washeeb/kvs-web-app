import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listJobs } from "@/server/modules/service-jobs";
import { serviceTitle } from "@/content/services";
import { Card, DateTime, EmptyState, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Service jobs" };

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "mine", label: "Mine" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
] as const;

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "jobs.read")) return <EmptyState title="You can't open this page" />;
  const wanted = (await searchParams).show;
  const show = FILTERS.find((f) => f.key === wanted)?.key ?? "open";
  const rows = await listJobs(getDb(), actor, show);
  return (
    <>
      <PageHeader title="Service jobs" description="Installations, shoots, training sessions and design or development work, by date." actions={<><LiveRefresh topics={["jobs"]} />{can(actor, "jobs.write") && <Link href="/admin/jobs/new" className="btn btn-primary">New job</Link>}</>} />
      <nav aria-label="Job filters" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/admin/jobs?show=${f.key}`} aria-current={f.key === show ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm font-medium ${f.key === show ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{f.label}</Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? <EmptyState title="No jobs here" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Job</th><th>Customer</th><th>Service</th><th>When</th><th>Who</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map(({ j, customerName, assigneeName }) => (
                  <tr key={j.id}>
                    <td><Link href={`/admin/jobs/${j.id}`} className="font-medium text-teal-700 hover:underline">{j.number}</Link><span className="block max-w-xs truncate text-xs text-slate-600">{j.title}</span></td>
                    <td>{customerName}</td>
                    <td className="text-xs">{serviceTitle(j.serviceLine)}</td>
                    <td className="text-xs">{j.scheduledAt ? <DateTime value={j.scheduledAt} /> : "Not scheduled"}{j.location && <span className="block text-slate-600">{j.location}</span>}</td>
                    <td className="text-xs">{assigneeName ?? "—"}</td>
                    <td><StatusBadge status={j.status} /></td>
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
