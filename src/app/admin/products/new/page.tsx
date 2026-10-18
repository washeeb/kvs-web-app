import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listBrands, listCategoriesTree, listTags } from "@/server/modules/taxonomy";
import { ActionForm } from "@/components/action-form";
import { ProductFields } from "@/components/product-fields";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { createProductAction } from "../../actions";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "catalogue.write")) return <EmptyState title="You can't open this page" />;
  const db = getDb();
  const [categories, brands, tags] = await Promise.all([listCategoriesTree(db), listBrands(db), listTags(db)]);
  return (
    <>
      <Link href="/admin/products" className="text-sm text-teal-700 hover:underline">← Products & stock</Link>
      <div className="mt-4"><PageHeader title="New product" description="Add the first option (size, colour, model) now; more can be added afterwards. Add pictures and receive stock on the product page." /></div>
      <Card>
        <ActionForm action={createProductAction} submitLabel="Create product">
          <ProductFields p={null} categories={categories} brands={brands} tagNames={tags.map((t) => t.name)} />
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold">First option</legend>
            <p className="mb-3 text-xs text-slate-600">The SKU (product code) is assigned automatically when you save, e.g. KV-NET-00012, and never changes.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Option name" htmlFor="variantName"><input id="variantName" name="variantName" className="field" defaultValue="Standard" maxLength={120} /></Field>
              <Field label="Selling price, excl. taxes (GHS)" htmlFor="price" hint="Leave empty for price on request: the shop shows “Request a quote” until a price is set."><input id="price" name="price" className="field" inputMode="decimal" /></Field>
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
