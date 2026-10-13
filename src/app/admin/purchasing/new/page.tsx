import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { itemOptions, listLocations } from "@/server/modules/inventory";
import { listSuppliers } from "@/server/modules/purchasing";
import { ActionForm } from "@/components/action-form";
import { ItemDatalist, ItemRows, LocationSelect } from "@/components/stock-ui";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { createPoAction } from "../../inventory-actions";

export const metadata: Metadata = { title: "New purchase order" };

export default async function NewPoPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "purchasing.write")) return <EmptyState title="You can't open this page" />;
  const { supplier } = await searchParams;
  const db = getDb();
  const [suppliers, locations, items] = await Promise.all([listSuppliers(db, actor, { activeOnly: true }), listLocations(db), itemOptions(db)]);
  if (suppliers.length === 0)
    return (
      <>
        <PageHeader title="New purchase order" />
        <EmptyState title="Add a supplier first"><Link href="/admin/suppliers" className="text-teal-700 underline">Add one in Suppliers</Link>, then come back.</EmptyState>
      </>
    );
  return (
    <>
      <Link href="/admin/purchasing" className="text-sm text-teal-700 hover:underline">← Purchase orders</Link>
      <div className="mt-4"><PageHeader title="New purchase order" description="Saved as a draft; send it from the next page when it is ready." /></div>
      <Card>
        <ActionForm action={createPoAction} submitLabel="Save draft">
          <ItemDatalist items={items} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Supplier" htmlFor="supplierId">
              <select id="supplierId" name="supplierId" className="field" required defaultValue={supplier}>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <LocationSelect id="po-loc" label="Deliver to" locations={locations} />
            <Field label="Needed by" htmlFor="expectedAt"><input id="expectedAt" name="expectedAt" type="date" className="field" /></Field>
          </div>
          <ItemRows count={10} withCost />
          <Field label="Notes for the supplier" htmlFor="notes"><textarea id="notes" name="notes" rows={2} className="field" maxLength={2000} /></Field>
        </ActionForm>
      </Card>
    </>
  );
}
