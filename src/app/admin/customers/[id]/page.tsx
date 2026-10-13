import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getCustomer } from "@/server/modules/customers";
import { serviceTitle } from "@/content/services";
import { ActionForm } from "@/components/action-form";
import { CustomerFields } from "@/components/customer-fields";
import { Card, DateTime, EmptyState, Money, PageHeader, StatusBadge } from "@/components/ui";
import { saveCustomerAction } from "../../actions";

export const metadata: Metadata = { title: "Customer" };

function List<T>({ title, rows, render, actions }: { title: string; rows: T[] | null; render: (r: T) => ReactNode; actions?: ReactNode }) {
  if (!rows) return null;
  return (
    <Card title={title} actions={actions}>
      {rows.length === 0 ? <EmptyState title="None yet" /> : <ul className="space-y-2 text-sm">{rows.map(render)}</ul>}
    </Card>
  );
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const h = await getCustomer(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const c = h.customer;
  return (
    <>
      <Link href="/admin/customers" className="text-sm text-teal-700 hover:underline">← Customers</Link>
      <div className="mt-4"><PageHeader title={c.name} description={<>{c.number}{c.company && <> · {c.company}</>} · customer since <DateTime value={c.createdAt} dateOnly /></>} /></div>
      <div className="grid gap-6 xl:grid-cols-2">
        <List title="Quotations" rows={h.quotes} actions={can(actor, "quotes.write") ? <Link href={`/admin/quotes/new?customer=${c.id}`} className="btn btn-ghost">New quotation</Link> : undefined} render={(q) => (
          <li key={q.id} className="flex flex-wrap items-center gap-2"><Link href={`/admin/quotes/${q.id}`} className="font-medium text-teal-700">{q.number}</Link><StatusBadge status={q.status} /><Money minor={q.totalMinor} currency={q.currency} /></li>
        )} />
        <List title="Orders" rows={h.orders} render={(o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2"><Link href={`/admin/orders/${o.id}`} className="font-medium text-teal-700">{o.number}</Link><StatusBadge status={o.status} /><StatusBadge status={o.paymentStatus} /><Money minor={o.totalMinor} currency={o.currency} /></li>
        )} />
        <List title="Service jobs" rows={h.jobs} actions={can(actor, "jobs.write") ? <Link href={`/admin/jobs/new?customer=${c.id}`} className="btn btn-ghost">New job</Link> : undefined} render={(j) => (
          <li key={j.id} className="flex flex-wrap items-center gap-2"><Link href={`/admin/jobs/${j.id}`} className="font-medium text-teal-700">{j.number}</Link><StatusBadge status={j.status} /><span>{j.title}</span></li>
        )} />
        <List title="Invoices" rows={h.invoices} render={(i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2"><Link href={`/admin/invoices/${i.id}`} className="font-medium text-teal-700">{i.number}</Link><StatusBadge status={i.status} /><Money minor={i.totalMinor - i.paidMinor} currency={i.currency} /> due</li>
        )} />
        <List title="Enquiries" rows={h.enquiries} render={(e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2"><Link href={`/admin/enquiries/${e.id}`} className="font-medium text-teal-700">{e.number}</Link><StatusBadge status={e.status} /><span>{serviceTitle(e.serviceLine)}</span></li>
        )} />
        <Card title="Details">
          {can(actor, "customers.write") ? (
            <ActionForm action={saveCustomerAction} submitLabel="Save">
              <input type="hidden" name="id" value={c.id} />
              <CustomerFields c={c} />
            </ActionForm>
          ) : (
            <dl className="space-y-1 text-sm"><div>{c.phone}</div><div>{c.email}</div><div>{c.address}</div></dl>
          )}
        </Card>
      </div>
    </>
  );
}
