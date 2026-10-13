import Link from "next/link";
import { Logo } from "@/components/logo";
import { can } from "@/server/authz/policy";
import type { Permission } from "@/server/authz/permissions";
import { requireActor } from "@/server/web/session";
import { logout } from "../(auth)/actions";
import { NotificationBell } from "@/components/notifications";
import { SideNav } from "@/components/side-nav";

type Entry = { href: string; label: string; perm?: Permission; exact?: boolean };
/** Menu groups; an entry shows when the user holds its permission, and empty groups are hidden. */
const NAV: { label: string | null; items: Entry[] }[] = [
  { label: null, items: [{ href: "/admin", label: "Dashboard", exact: true }] },
  {
    label: "Sales",
    items: [
      { href: "/admin/enquiries", label: "Enquiries", perm: "enquiries.read" },
      { href: "/admin/customers", label: "Customers", perm: "customers.read" },
      { href: "/admin/quotes", label: "Quotations", perm: "quotes.read" },
      { href: "/admin/orders", label: "Orders", perm: "orders.read" },
    ],
  },
  { label: "Services", items: [{ href: "/admin/jobs", label: "Service jobs", perm: "jobs.read" }] },
  { label: "Catalogue & inventory", items: [{ href: "/admin/products", label: "Products & stock", perm: "catalogue.read" }] },
  { label: "Finance", items: [{ href: "/admin/invoices", label: "Invoices & payments", perm: "finance.read" }] },
  { label: "Reports", items: [{ href: "/admin/exports", label: "Data exports", perm: "data.export" }] },
  {
    label: "Administration",
    items: [
      { href: "/admin/approvals", label: "Approvals", perm: "approvals.read" },
      { href: "/admin/users", label: "Staff & roles", perm: "users.read" },
      { href: "/admin/ses", label: "Synclytics link", perm: "integrations.read" },
      { href: "/admin/settings", label: "Settings", perm: "settings.manage" },
      { href: "/admin/audit", label: "Audit log", perm: "audit.read" },
    ],
  },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("operator", "/admin");
  const groups = NAV.map((g) => ({ label: g.label, items: g.items.filter((n) => !n.perm || can(actor, n.perm)).map(({ href, label, exact }) => ({ href, label, exact })) })).filter((g) => g.items.length > 0);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[230px_1fr] print:block">
      <aside className="border-b border-slate-200 bg-white print:hidden lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="px-4 py-3"><Logo href="/admin" height={36} /></div>
        <SideNav groups={groups} label="Back office" />
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3 print:hidden">
          <p className="text-sm text-slate-600">
            Back office · <span className="font-medium text-slate-900">{actor.name}</span>
            {actor.mfaVerified && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800">2-step verified</span>}
          </p>
          <div className="flex items-center gap-3">
            <NotificationBell actor={actor} href="/admin/notifications" />
            <Link href="/" className="text-sm text-slate-600 hover:underline">Website</Link>
            <form action={logout}><button className="btn btn-ghost">Sign out</button></form>
          </div>
        </header>
        <main id="main" className="min-w-0 px-4 py-8 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
