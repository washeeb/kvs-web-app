import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getJob, jobStaff } from "@/server/modules/service-jobs";
import { serviceTitle } from "@/content/services";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, Field, PageHeader, StatusBadge } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { jobAction } from "../../actions";

export const metadata: Metadata = { title: "Service job" };

const local = (d: Date | null) => (d ? d.toISOString().slice(0, 16) : "");

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const { j, customer, assigneeName } = await getJob(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const write = can(actor, "jobs.write") && ["requested", "scheduled", "in_progress"].includes(j.status);
  const staff = write ? await jobStaff(db) : [];
  const hidden = (op: string) => <><input type="hidden" name="id" value={j.id} /><input type="hidden" name="op" value={op} /></>;
  return (
    <>
      <Link href="/admin/jobs" className="text-sm text-teal-700 hover:underline">← Service jobs</Link>
      <div className="mt-4">
        <PageHeader title={`${j.number}: ${j.title}`} description={<>{serviceTitle(j.serviceLine)} for <Link href={`/admin/customers/${customer.id}`} className="text-teal-700 underline">{customer.name}</Link></>} actions={<><LiveRefresh topics={["jobs"]} /><StatusBadge status={j.status} /></>} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title="Details">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="font-semibold">When</dt><dd>{j.scheduledAt ? <DateTime value={j.scheduledAt} /> : "Not scheduled yet"}</dd></div>
            <div><dt className="font-semibold">Where</dt><dd>{j.location ?? "—"}</dd></div>
            <div><dt className="font-semibold">Who</dt><dd>{assigneeName ?? "Not assigned"}</dd></div>
            <div><dt className="font-semibold">Customer contact</dt><dd>{customer.phone ? <a href={`tel:${customer.phone}`} className="text-teal-700">{customer.phone}</a> : "—"}{customer.email && <span className="block">{customer.email}</span>}</dd></div>
          </dl>
          {j.description && <p className="mt-4 whitespace-pre-line text-sm text-slate-800">{j.description}</p>}
          {j.completionNote && <p className="mt-4 rounded bg-slate-50 p-3 text-sm"><strong>{j.status === "completed" ? "Work done" : "Note"}:</strong> {j.completionNote}</p>}
          {(j.quoteId || j.orderId) && (
            <p className="mt-4 text-sm">
              {j.quoteId && <Link href={`/admin/quotes/${j.quoteId}`} className="mr-4 text-teal-700 underline">Quotation</Link>}
              {j.orderId && <Link href={`/admin/orders/${j.orderId}`} className="text-teal-700 underline">Order & invoice</Link>}
            </p>
          )}
        </Card>
        {write && (
          <div className="min-w-0 space-y-6">
            {["requested", "scheduled"].includes(j.status) && (
              <Card title={j.status === "requested" ? "Schedule" : "Reschedule"}>
                <ActionForm action={jobAction} submitLabel="Save schedule" submitClassName="btn btn-primary">
                  {hidden("schedule")}
                  <Field label="Date and time (Accra)" htmlFor="scheduledAt"><input id="scheduledAt" name="scheduledAt" type="datetime-local" className="field" required defaultValue={local(j.scheduledAt)} /></Field>
                  <Field label="Location" htmlFor="location"><input id="location" name="location" className="field" maxLength={300} defaultValue={j.location ?? ""} /></Field>
                  <Field label="Assign to" htmlFor="assigneeUserId">
                    <select id="assigneeUserId" name="assigneeUserId" className="field" defaultValue={j.assigneeUserId ?? ""}>
                      <option value="">Keep as is</option>
                      {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </Field>
                </ActionForm>
              </Card>
            )}
            <Card title="Progress">
              <div className="space-y-3">
                {j.status !== "in_progress" && <ActionForm action={jobAction} submitLabel="Start work" submitClassName="btn btn-ghost w-full">{hidden("status")}<input type="hidden" name="status" value="in_progress" /></ActionForm>}
                <ActionForm action={jobAction} submitLabel="Mark completed" submitClassName="btn btn-accent w-full">
                  {hidden("status")}<input type="hidden" name="status" value="completed" />
                  <Field label="What was done" htmlFor="note"><textarea id="note" name="note" rows={3} className="field" required minLength={3} maxLength={2000} /></Field>
                </ActionForm>
                <ActionForm action={jobAction} submitLabel="Cancel job" submitClassName="btn btn-danger w-full" confirm="Cancel this job?">
                  {hidden("status")}<input type="hidden" name="status" value="cancelled" />
                  <Field label="Reason" htmlFor="cancelNote"><input id="cancelNote" name="note" className="field" required minLength={3} maxLength={300} /></Field>
                </ActionForm>
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
