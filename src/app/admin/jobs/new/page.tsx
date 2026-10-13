import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listCustomers } from "@/server/modules/customers";
import { jobStaff } from "@/server/modules/service-jobs";
import { SERVICE_LINES } from "@/content/services";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { createJobAction } from "../../actions";

export const metadata: Metadata = { title: "New job" };

export default async function NewJobPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "jobs.write")) return <EmptyState title="You can't open this page" />;
  const sp = await searchParams;
  const db = getDb();
  const [customers, staff] = await Promise.all([can(actor, "customers.read") ? listCustomers(db, actor) : [], jobStaff(db)]);
  return (
    <>
      <Link href="/admin/jobs" className="text-sm text-teal-700 hover:underline">← Service jobs</Link>
      <div className="mt-4"><PageHeader title="New service job" description="Date and time are Accra time. The customer is e-mailed when the job is scheduled (if we have their e-mail)." /></div>
      <Card>
        <ActionForm action={createJobAction} submitLabel="Create job">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer" htmlFor="customerId">
              <select id="customerId" name="customerId" className="field" required defaultValue={sp.customer ?? ""}>
                <option value="" disabled>Choose…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Service" htmlFor="serviceLine">
              <select id="serviceLine" name="serviceLine" className="field" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {SERVICE_LINES.map((s) => <option key={s.slug} value={s.slug}>{s.title}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Title" htmlFor="title"><input id="title" name="title" className="field" required minLength={3} maxLength={160} placeholder="e.g. Install 4 cameras at Madina shop" /></Field>
          <Field label="Details (optional)" htmlFor="description"><textarea id="description" name="description" rows={3} className="field" maxLength={4000} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date and time (optional)" htmlFor="scheduledAt"><input id="scheduledAt" name="scheduledAt" type="datetime-local" className="field" /></Field>
            <Field label="Location (optional)" htmlFor="location"><input id="location" name="location" className="field" maxLength={300} /></Field>
            <Field label="Assign to (optional)" htmlFor="assigneeUserId">
              <select id="assigneeUserId" name="assigneeUserId" className="field" defaultValue="">
                <option value="">Nobody yet</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
