import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listCategories } from "@/server/modules/catalogue";
import { ActionForm } from "@/components/action-form";
import { ProductFields } from "@/components/product-fields";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { createProductAction } from "../../actions";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "catalogue.write")) return <EmptyState title="You can't open this page" />;
  const categories = await listCategories(getDb());
  return (
    <>
      <Link href="/admin/products" className="text-sm text-teal-700 hover:underline">← Products & stock</Link>
      <div className="mt-4"><PageHeader title="New product" description="Add the first option (size, colour, model) now; more can be added afterwards. Receive stock on the product page." /></div>
      <Card>
        <ActionForm action={createProductAction} submitLabel="Create product">
          <ProductFields p={null} categories={categories} />
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold">First option</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SKU (product code)" htmlFor="sku"><input id="sku" name="sku" className="field uppercase" required pattern="[A-Za-z0-9][A-Za-z0-9-]{2,40}" placeholder="KVS-MOUSE-WL" /></Field>
              <Field label="Option name" htmlFor="variantName"><input id="variantName" name="variantName" className="field" defaultValue="Standard" maxLength={120} /></Field>
              <Field label="Selling price, excl. taxes (GHS)" htmlFor="price"><input id="price" name="price" className="field" inputMode="decimal" required /></Field>
              <Field label="Cost price (GHS, optional)" htmlFor="cost" hint="Shared with Synclytics as the partner cost."><input id="cost" name="cost" className="field" inputMode="decimal" /></Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="taxable" defaultChecked /> Taxable</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="tracksStock" defaultChecked /> Track stock</label>
            </div>
          </fieldset>
        </ActionForm>
      </Card>
    </>
  );
}
