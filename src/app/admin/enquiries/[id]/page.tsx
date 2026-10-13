import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { ENQUIRY_STATUSES, getEnquiry } from "@/server/modules/enquiries";
import { jobStaff } from "@/server/modules/service-jobs";
import { serviceTitle } from "@/content/services";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, Field, PageHeader, StatusBadge } from "@/components/ui";
import { enquiryAction } from "../../actions";

export const metadata: Metadata = { title: "Enquiry" };

export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const { e, assigneeName } = await getEnquiry(db, actor, id).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });
  const write = can(actor, "enquiries.write");
  const staff = write ? await jobStaff(db) : [];
  return (
    <>
      <Link href="/admin/enquiries" className="text-sm text-teal-700 hover:underline">← Enquiries</Link>
      <div className="mt-4"><PageHeader title={`${e.number}: ${e.name}`} description={<>{serviceTitle(e.serviceLine)} · received <DateTime value={e.createdAt} /></>} actions={<StatusBadge status={e.status} />} /></div>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title="Request">
          <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="font-semibold">Phone</dt><dd>{e.phone ? <a href={`tel:${e.phone}`} className="text-teal-700">{e.phone}</a> : "—"}</dd></div>
            <div><dt className="font-semibold">E-mail</dt><dd>{e.email ? <a href={`mailto:${e.email}`} className="text-teal-700">{e.email}</a> : "—"}</dd></div>
            <div><dt className="font-semibold">Organisation</dt><dd>{e.company ?? "—"}</dd></div>
          </dl>
          <p className="whitespace-pre-line text-slate-800">{e.message}</p>
          {e.customerId && <p className="mt-4 text-sm"><Link href={`/admin/customers/${e.customerId}`} className="text-teal-700 underline">Open customer record</Link></p>}
        </Card>
        {write && (
          <div className="space-y-6">
            <Card title="Next step">
              <div className="space-y-3">
                {can(actor, "quotes.write") && (
                  <ActionForm action={enquiryAction} submitLabel="Create a quotation" submitClassName="btn btn-accent w-full">
                    <input type="hidden" name="id" value={e.id} /><input type="hidden" name="op" value="quote" />
                  </ActionForm>
                )}
                {!e.customerId && can(actor, "customers.write") && (
                  <ActionForm action={enquiryAction} submitLabel="Save as customer" submitClassName="btn btn-ghost w-full">
                    <input type="hidden" name="id" value={e.id} /><input type="hidden" name="op" value="customer" />
                  </ActionForm>
                )}
              </div>
            </Card>
            <Card title="Status & owner">
              <ActionForm action={enquiryAction} submitLabel="Save" submitClassName="btn btn-ghost">
                <input type="hidden" name="id" value={e.id} />
                <Field label="Status" htmlFor="status">
                  <select id="status" name="status" className="field" defaultValue={e.status}>{ENQUIRY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                </Field>
                <Field label="Assigned to" htmlFor="assigneeUserId" hint={assigneeName ? `Currently ${assigneeName}` : undefined}>
                  <select id="assigneeUserId" name="assigneeUserId" className="field" defaultValue={e.assigneeUserId ?? ""}>
                    <option value="">Nobody</option>
                    <option value={actor.userId}>Me</option>
                    {staff.filter((u) => u.id !== actor.userId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </Field>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
