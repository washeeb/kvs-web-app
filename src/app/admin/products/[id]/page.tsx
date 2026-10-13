import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getProductAdmin } from "@/server/modules/catalogue";
import { listBrands, listCategoriesTree, listTags } from "@/server/modules/taxonomy";
import { ImageManager } from "@/components/image-manager";
import { listLocations, listMovements, MOVEMENT_LABELS } from "@/server/modules/inventory";
import { listSuppliers } from "@/server/modules/purchasing";
import { LocationSelect } from "@/components/stock-ui";
import { ActionForm } from "@/components/action-form";
import { AvailabilityBadge } from "@/components/availability";
import { ProductFields } from "@/components/product-fields";
import { Card, DateTime, Field, PageHeader, StatusBadge } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { imageAction, productAction, uploadImageAction } from "../../actions";
import { stockAction, stockSettingsAction } from "../../inventory-actions";

export const metadata: Metadata = { title: "Product" };

const amount = (minor: number | null) => (minor === null ? "" : (minor / 100).toFixed(2));

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const { product: p, variants, images, tags: productTagList } = await getProductAdmin(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const write = can(actor, "catalogue.write");
  const adjust = can(actor, "inventory.adjust");
  const [categories, brands, allTags, moves, locations, suppliers] = await Promise.all([
    listCategoriesTree(db),
    listBrands(db),
    listTags(db),
    can(actor, "inventory.read") ? Promise.all(variants.map((v) => listMovements(db, actor, v.id, 8))) : Promise.resolve([]),
    listLocations(db),
    can(actor, "purchasing.read") ? listSuppliers(db, actor, { activeOnly: true }) : Promise.resolve([]),
  ]);
  const vh = (op: string, variantId: string) => <><input type="hidden" name="op" value={op} /><input type="hidden" name="variantId" value={variantId} /></>;
  const hidden = (op: string, variantId?: string) => <><input type="hidden" name="productId" value={p.id} /><input type="hidden" name="op" value={op} />{variantId && <input type="hidden" name="variantId" value={variantId} />}</>;
  return (
    <>
      <Link href="/admin/products" className="text-sm text-teal-700 hover:underline">← Products & stock</Link>
      <div className="mt-4">
        <PageHeader title={p.name} description={p.status === "active" ? <Link href={`/shop/${p.slug}`} className="text-teal-700 underline">View in the shop</Link> : "Not visible in the shop."} actions={<><LiveRefresh topics={["catalogue", "stock"]} /><StatusBadge status={p.status} /></>} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <Card title="Pictures">
            <ImageManager images={images} ownerType="product" ownerId={p.id} defaultAlt={p.name} canWrite={write} uploadAction={uploadImageAction} imageAction={imageAction} />
          </Card>
          {variants.map((v, i) => (
            <Card key={v.id} title={<>{v.name} <span className="text-sm font-normal text-slate-600">· {v.sku}</span></>} actions={<AvailabilityBadge a={v.availability} showCount />}>
              {v.tracksStock && (
                <div className="mb-4 text-sm text-slate-700">
                  <p>
                    On hand <strong>{v.onHand}</strong> · reserved for open orders <strong>{v.reserved}</strong>
                    {v.costMinor !== null && <> · average cost <strong>{(v.costMinor / 100).toFixed(2)}</strong></>}
                    {v.serialTracked && <> · serial numbers tracked</>}
                    {v.barcode && <> · barcode <span className="font-mono">{v.barcode}</span></>}
                  </p>
                  {v.levels.length > 0 && (
                    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                      {v.levels.map((l) => <li key={l.id}>{l.locationName}: <strong>{l.onHand}</strong>{l.reserved ? " (" + l.reserved + " reserved)" : ""}{l.sellable ? "" : " · not for sale"}</li>)}
                    </ul>
                  )}
                </div>
              )}
              <div className="grid gap-6 lg:grid-cols-2">
                {write && (
                  <ActionForm action={productAction} submitLabel="Save option" submitClassName="btn btn-ghost">
                    {hidden("variant", v.id)}
                    <Field label="Option name" htmlFor={`vn-${v.id}`}><input id={`vn-${v.id}`} name="variantName" className="field" defaultValue={v.name} maxLength={120} /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Price (GHS)" htmlFor={`vp-${v.id}`}><input id={`vp-${v.id}`} name="price" className="field" inputMode="decimal" required defaultValue={amount(v.priceMinor)} /></Field>
                      <Field label="Cost (GHS)" htmlFor={`vc-${v.id}`} hint="Average cost; updated automatically when stock is received with a unit cost."><input id={`vc-${v.id}`} name="cost" className="field" inputMode="decimal" defaultValue={amount(v.costMinor)} /></Field>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <label className="flex items-center gap-2"><input type="checkbox" name="taxable" defaultChecked={v.taxable} /> Taxable</label>
                      <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={v.active} /> On sale</label>
                    </div>
                  </ActionForm>
                )}
                {adjust && v.tracksStock && (
                  <ActionForm action={stockAction} submitLabel="Receive" submitClassName="btn btn-primary" resetOnSuccess>
                    {vh("receive", v.id)}
                    <p className="field-label">Delivery received</p>
                    <LocationSelect id={`rl-${v.id}`} label="Into" locations={locations} />
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Quantity" htmlFor={`sq-${v.id}`}><input id={`sq-${v.id}`} name="quantity" type="number" min={1} className="field" required /></Field>
                      <Field label="Unit cost (GHS)" htmlFor={`uc-${v.id}`}><input id={`uc-${v.id}`} name="unitCost" className="field" inputMode="decimal" /></Field>
                    </div>
                    {v.serialTracked && <Field label="Serial numbers" htmlFor={`ser-${v.id}`}><textarea id={`ser-${v.id}`} name="serials" rows={2} className="field font-mono text-sm uppercase" required /></Field>}
                    <Field label="Supplier / note" htmlFor={`sn-${v.id}`}><input id={`sn-${v.id}`} name="note" className="field" maxLength={300} /></Field>
                  </ActionForm>
                )}
              </div>
              {adjust && v.tracksStock && (
                <details className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-teal-700">Count this item</summary>
                  <ActionForm action={stockAction} submitLabel="Save count" submitClassName="btn btn-ghost" resetOnSuccess className="mt-3 grid gap-3 sm:grid-cols-[1fr_7rem_1fr_auto] sm:items-end">
                    {vh("count", v.id)}
                    <LocationSelect id={`cl-${v.id}`} label="At" locations={locations} />
                    <Field label="Counted" htmlFor={`cq-${v.id}`}><input id={`cq-${v.id}`} name="quantity" type="number" min={0} className="field" required /></Field>
                    <Field label="Reason" htmlFor={`cn-${v.id}`}><input id={`cn-${v.id}`} name="note" className="field" required minLength={3} maxLength={300} /></Field>
                  </ActionForm>
                  <p className="mt-2 text-xs text-slate-600">Damage, loss and other changes: <Link href="/admin/inventory/receive" className="text-teal-700 underline">Receive &amp; adjust</Link>.</p>
                </details>
              )}
              {write && v.tracksStock && (
                <details className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-teal-700">Stock settings (barcode, reorder, serials)</summary>
                  <ActionForm action={stockSettingsAction} submitLabel="Save stock settings" submitClassName="btn btn-ghost" className="mt-3 space-y-3">
                    <input type="hidden" name="variantId" value={v.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Barcode (EAN/UPC)" htmlFor={`bc-${v.id}`} hint="From the manufacturer's box, if it has one."><input id={`bc-${v.id}`} name="barcode" className="field font-mono" maxLength={40} defaultValue={v.barcode ?? ""} /></Field>
                      <Field label="Preferred supplier" htmlFor={`ps-${v.id}`}>
                        <select id={`ps-${v.id}`} name="preferredSupplierId" className="field" defaultValue={v.preferredSupplierId ?? ""}>
                          <option value="">None</option>
                          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Reorder at (units available)" htmlFor={`rp-${v.id}`} hint="Alert and suggest an order at or below this."><input id={`rp-${v.id}`} name="reorderPoint" type="number" min={0} className="field" defaultValue={v.reorderPoint ?? ""} /></Field>
                      <Field label="Usual order quantity" htmlFor={`rq-${v.id}`}><input id={`rq-${v.id}`} name="reorderQty" type="number" min={1} className="field" defaultValue={v.reorderQty ?? ""} /></Field>
                      <Field label="Lead time (days)" htmlFor={`lt-${v.id}`}><input id={`lt-${v.id}`} name="leadTimeDays" type="number" min={0} max={365} className="field" defaultValue={v.leadTimeDays ?? ""} /></Field>
                    </div>
                    <label className="flex items-center gap-2"><input type="checkbox" name="serialTracked" defaultChecked={v.serialTracked} /> Track serial numbers (each unit recorded on receipt and sale)</label>
                  </ActionForm>
                </details>
              )}
              {moves[i] && moves[i]!.length > 0 && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-teal-700">Recent stock history</summary>
                  <ul className="mt-2 space-y-1">
                    {moves[i]!.map((m) => <li key={m.id}><DateTime value={m.createdAt} /> · {MOVEMENT_LABELS[m.reason] ?? m.reason} · {m.quantity > 0 ? `+${m.quantity}` : m.quantity}{m.note && ` · ${m.note}`}</li>)}
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
                <ProductFields p={p} categories={categories} brands={brands} tagNames={allTags.map((t) => t.name)} tags={productTagList.map((t) => t.name)} />
              </ActionForm>
            </Card>
            <Card title="Add an option">
              <ActionForm action={productAction} submitLabel="Add option" submitClassName="btn btn-ghost" resetOnSuccess>
                {hidden("add_variant")}
                <p className="text-xs text-slate-600">A new SKU is assigned automatically.</p>
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
