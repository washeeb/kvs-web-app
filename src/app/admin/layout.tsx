import Link from "next/link";
import { Logo } from "@/components/logo";
import { can } from "@/server/authz/policy";
import type { Permission } from "@/server/authz/permissions";
import { requireActor } from "@/server/web/session";
import { logout } from "../(auth)/actions";
import { NotificationBell } from "@/components/notifications";

const NAV: { href: string; label: string; perm?: Permission }[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/enquiries", label: "Enquiries", perm: "enquiries.read" },
  { href: "/admin/customers", label: "Customers", perm: "customers.read" },
  { href: "/admin/quotes", label: "Quotations", perm: "quotes.read" },
  { href: "/admin/orders", label: "Orders", perm: "orders.read" },
  { href: "/admin/jobs", label: "Service jobs", perm: "jobs.read" },
  { href: "/admin/products", label: "Products & stock", perm: "catalogue.read" },
  { href: "/admin/invoices", label: "Invoices & payments", perm: "finance.read" },
  { href: "/admin/ses", label: "Synclytics link", perm: "integrations.read" },
  { href: "/admin/exports", label: "Data exports", perm: "data.export" },
  { href: "/admin/approvals", label: "Approvals", perm: "approvals.read" },
  { href: "/admin/users", label: "Staff & roles", perm: "users.read" },
  { href: "/admin/settings", label: "Settings", perm: "settings.manage" },
  { href: "/admin/audit", label: "Audit log", perm: "audit.read" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("operator", "/admin");
  const items = NAV.filter((n) => !n.perm || can(actor, n.perm));
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[230px_1fr] print:block">
      <aside className="border-b border-slate-200 bg-white print:hidden lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="px-4 py-3"><Logo href="/admin" height={36} /></div>
        <nav aria-label="Back office" className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:overflow-visible">
          {items.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">{n.label}</Link>
          ))}
        </nav>
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
