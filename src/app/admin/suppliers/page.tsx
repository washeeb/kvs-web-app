import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listSuppliers } from "@/server/modules/purchasing";
import { ActionForm } from "@/components/action-form";
import { SupplierFields } from "@/components/supplier-fields";
import { Badge, Card, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { supplierAction } from "../inventory-actions";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "purchasing.read")) return <EmptyState title="You can't open this page" />;
  const rows = await listSuppliers(getDb(), actor);
  return (
    <>
      <PageHeader title="Suppliers" actions={can(actor, "data.export") ? <a className="btn btn-ghost" href={`/api/exports/suppliers`} download>Export CSV</a> : undefined} />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          {rows.length === 0 ? <EmptyState title="No suppliers yet" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Supplier</th><th>Contact</th><th className="text-right">Lead time</th><th>Status</th></tr></thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td><Link href={`/admin/suppliers/${s.id}`} className="font-medium text-teal-700 hover:underline">{s.name}</Link></td>
                      <td className="text-sm">{[s.contactName, s.phone, s.email].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="text-right">{s.leadTimeDays === null ? "—" : `${s.leadTimeDays} d`}</td>
                      <td>{s.active ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        {can(actor, "purchasing.write") && (
          <Card title="New supplier">
            <ActionForm action={supplierAction} submitLabel="Add supplier">
              <SupplierFields s={null} />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
