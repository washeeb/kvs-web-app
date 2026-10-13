import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { dashboard, topItems } from "@/server/modules/reports";
import { dpcStatus, getSettings } from "@/server/modules/settings";
import { can } from "@/server/authz/policy";
import { BarList } from "@/components/bar-list";
import { Card, Money, PageHeader, Stat } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminHome() {
  const actor = await requireActor("operator");
  const db = getDb();
  const [d, top, s] = await Promise.all([dashboard(db, actor), topItems(db, actor), getSettings(db)]);
  const dpc = dpcStatus(s);
  const tiles = [
    d.newEnquiries !== null && { label: "New enquiries", value: d.newEnquiries, href: "/admin/enquiries", tone: d.newEnquiries ? ("amber" as const) : undefined },
    d.ordersToConfirm !== null && { label: "Orders to confirm", value: d.ordersToConfirm, href: "/admin/orders", tone: d.ordersToConfirm ? ("amber" as const) : undefined },
    d.ordersInProgress !== null && { label: "Orders being prepared", value: d.ordersInProgress, href: "/admin/orders" },
    d.salesLast30Minor !== null && { label: "Orders, last 30 days", value: <Money minor={d.salesLast30Minor} />, href: "/admin/orders?show=all" },
    d.jobsThisWeek !== null && { label: "Jobs in the next 7 days", value: d.jobsThisWeek, href: "/admin/jobs" },
    d.unscheduledJobs !== null && { label: "Jobs not yet scheduled", value: d.unscheduledJobs, href: "/admin/jobs", tone: d.unscheduledJobs ? ("amber" as const) : undefined },
    d.lowStock !== null && { label: "Items low on stock", value: d.lowStock, href: "/admin/products", tone: d.lowStock ? ("amber" as const) : undefined },
    d.money && { label: "Owed to us", value: <Money minor={d.money.outstandingMinor} />, href: "/admin/invoices" },
    d.money && { label: "Overdue", value: <Money minor={d.money.overdueMinor} />, href: "/admin/invoices?show=overdue", tone: d.money.overdueMinor ? ("red" as const) : undefined },
    d.pendingApprovals !== null && d.pendingApprovals > 0 && { label: "Approvals waiting", value: d.pendingApprovals, href: "/admin/approvals", tone: "amber" as const },
    d.sesProblems !== null && d.sesProblems > 0 && { label: "Synclytics updates failed", value: d.sesProblems, href: "/admin/ses", tone: "red" as const },
  ].filter(Boolean) as { label: string; value: React.ReactNode; href: string; tone?: "amber" | "red" }[];
  return (
    <>
      <PageHeader title={`Hello, ${actor.name.split(" ")[0]}`} description="What needs attention today. Figures only include what your role can see." actions={<LiveRefresh topics={["leads", "orders", "jobs", "invoices", "stock"]} />} />
      {can(actor, "settings.manage") && dpc.state !== "valid" && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">
          {dpc.state === "missing" ? "Data Protection Commission registration has not been recorded yet." : dpc.state === "expired" ? "The Data Protection Commission certificate has expired." : `The Data Protection Commission certificate expires in ${dpc.daysLeft} day(s).`}{" "}
          <Link href="/admin/settings" className="font-semibold underline">Settings</Link>
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => <Stat key={t.label} {...t} />)}
      </div>
      {top && (
        <Card title="Best sellers, last 30 days" className="mt-6">
          <BarList data={top} money label="Best sellers by value" />
        </Card>
      )}
    </>
  );
}
