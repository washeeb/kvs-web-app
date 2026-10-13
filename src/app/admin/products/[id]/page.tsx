import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getProductAdmin, listCategories } from "@/server/modules/catalogue";
import { listMovements } from "@/server/modules/inventory";
import { ActionForm } from "@/components/action-form";
import { AvailabilityBadge } from "@/components/availability";
import { ProductFields } from "@/components/product-fields";
import { Card, DateTime, Field, PageHeader, StatusBadge } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { productAction } from "../../actions";

export const metadata: Metadata = { title: "Product" };

const amount = (minor: number | null) => (minor === null ? "" : (minor / 100).toFixed(2));

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const { product: p, variants } = await getProductAdmin(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const write = can(actor, "catalogue.write");
  const adjust = can(actor, "inventory.adjust");
  const [categories, moves] = await Promise.all([listCategories(db), can(actor, "inventory.read") ? Promise.all(variants.map((v) => listMovements(db, actor, v.id, 8))) : Promise.resolve([])]);
  const hidden = (op: string, variantId?: string) => <><input type="hidden" name="productId" value={p.id} /><input type="hidden" name="op" value={op} />{variantId && <input type="hidden" name="variantId" value={variantId} />}</>;
  return (
    <>
      <Link href="/admin/products" className="text-sm text-teal-700 hover:underline">← Products & stock</Link>
      <div className="mt-4">
        <PageHeader title={p.name} description={p.status === "active" ? <Link href={`/shop/${p.slug}`} className="text-teal-700 underline">View in the shop</Link> : "Not visible in the shop."} actions={<><LiveRefresh topics={["catalogue", "stock"]} /><StatusBadge status={p.status} /></>} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          {variants.map((v, i) => (
            <Card key={v.id} title={<>{v.name} <span className="text-sm font-normal text-slate-600">· {v.sku}</span></>} actions={<AvailabilityBadge a={v.availability} showCount />}>
              {v.tracksStock && <p className="mb-3 text-sm text-slate-700">On hand <strong>{v.onHand}</strong> · reserved for open orders <strong>{v.reserved}</strong></p>}
              <div className="grid gap-6 lg:grid-cols-2">
                {write && (
                  <ActionForm action={productAction} submitLabel="Save option" submitClassName="btn btn-ghost">
                    {hidden("variant", v.id)}
                    <Field label="Option name" htmlFor={`vn-${v.id}`}><input id={`vn-${v.id}`} name="variantName" className="field" defaultValue={v.name} maxLength={120} /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Price (GHS)" htmlFor={`vp-${v.id}`}><input id={`vp-${v.id}`} name="price" className="field" inputMode="decimal" required defaultValue={amount(v.priceMinor)} /></Field>
                      <Field label="Cost (GHS)" htmlFor={`vc-${v.id}`}><input id={`vc-${v.id}`} name="cost" className="field" inputMode="decimal" defaultValue={amount(v.costMinor)} /></Field>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <label className="flex items-center gap-2"><input type="checkbox" name="taxable" defaultChecked={v.taxable} /> Taxable</label>
                      <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={v.active} /> On sale</label>
                    </div>
                  </ActionForm>
                )}
                {adjust && v.tracksStock && (
                  <ActionForm action={productAction} submitLabel="Update stock" submitClassName="btn btn-primary" resetOnSuccess>
                    {hidden("stock", v.id)}
                    <fieldset>
                      <legend className="field-label">Stock change</legend>
                      <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="radio" name="mode" value="receive" defaultChecked /> Delivery received (add)</label>
                      <label className="inline-flex items-center gap-2 text-sm"><input type="radio" name="mode" value="count" /> Count (set to)</label>
                    </fieldset>
                    <Field label="Quantity" htmlFor={`sq-${v.id}`}><input id={`sq-${v.id}`} name="quantity" type="number" min={0} className="field" required /></Field>
                    <Field label="Note (supplier, reason)" htmlFor={`sn-${v.id}`}><input id={`sn-${v.id}`} name="note" className="field" maxLength={300} /></Field>
                  </ActionForm>
                )}
              </div>
              {moves[i] && moves[i]!.length > 0 && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-teal-700">Recent stock history</summary>
                  <ul className="mt-2 space-y-1">
                    {moves[i]!.map((m) => <li key={m.id}><DateTime value={m.createdAt} /> · {m.reason} · {m.quantity > 0 ? `+${m.quantity}` : m.quantity}{m.note && ` · ${m.note}`}</li>)}
                  </ul>
                </details>
              )}
            </Card>
          ))}
        </div>
        {write && (
          <div className="min-w-0 space-y-6">
            <Card title="Product details">
              <ActionForm action={productAction} submitLabel="Save product">
                {hidden("product")}
                <ProductFields p={p} categories={categories} />
              </ActionForm>
            </Card>
            <Card title="Add an option">
              <ActionForm action={productAction} submitLabel="Add option" submitClassName="btn btn-ghost" resetOnSuccess>
                {hidden("add_variant")}
                <Field label="SKU" htmlFor="sku"><input id="sku" name="sku" className="field uppercase" required pattern="[A-Za-z0-9][A-Za-z0-9-]{2,40}" /></Field>
                <Field label="Option name" htmlFor="variantName"><input id="variantName" name="variantName" className="field" required maxLength={120} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Price (GHS)" htmlFor="price"><input id="price" name="price" className="field" inputMode="decimal" required /></Field>
                  <Field label="Cost (GHS)" htmlFor="cost"><input id="cost" name="cost" className="field" inputMode="decimal" /></Field>
                </div>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" name="taxable" defaultChecked /> Taxable</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="tracksStock" defaultChecked /> Track stock</label>
                </div>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
