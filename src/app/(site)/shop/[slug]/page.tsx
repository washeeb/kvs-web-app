import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { getShopProduct } from "@/server/modules/catalogue";
import { ActionForm } from "@/components/action-form";
import { AvailabilityBadge } from "@/components/availability";
import { Badge, Money } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { addToCartAction } from "../../actions";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = await getShopProduct(getDb(), (await params).slug);
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
        <Link href="/shop" className="hover:underline">Shop</Link>
        {p.categorySlug && <> / <Link href={`/shop?category=${p.categorySlug}`} className="hover:underline">{p.categoryName}</Link></>} / <span>{p.name}</span>
      </nav>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {p.isDemo && <Badge tone="amber">Demonstration</Badge>}
        <span className="ml-auto"><LiveRefresh topics={["catalogue", "stock"]} /></span>
      </div>
      <h1 className="mt-2 text-3xl font-bold text-slate-900">{p.name}</h1>
      {p.summary && <p className="mt-2 text-lg text-slate-700">{p.summary}</p>}
      {p.description && <p className="mt-4 whitespace-pre-line text-slate-700">{p.description}</p>}
      <h2 className="mt-8 text-lg font-semibold">Options</h2>
      <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {p.variants.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">{v.name}</p>
              <p className="text-xs text-slate-600">SKU {v.sku}</p>
            </div>
            <AvailabilityBadge a={v.availability} showCount />
            <p className="font-semibold"><Money minor={v.priceMinor} currency={v.currency} /> <span className="text-xs font-normal text-slate-600">excl. taxes</span></p>
            {v.availability.purchasable ? (
              <ActionForm action={addToCartAction} inline submitLabel={<>Add to cart<span className="sr-only">: {v.name}</span></>} submitClassName="btn btn-accent">
                <input type="hidden" name="variantId" value={v.id} />
                <label htmlFor={`qty-${v.id}`} className="sr-only">Quantity of {v.name}</label>
                <input id={`qty-${v.id}`} name="quantity" type="number" min={1} max={v.tracksStock ? Math.min(999, v.availability.available) : 999} defaultValue={1} className="field w-20" />
              </ActionForm>
            ) : (
              <Link href="/contact" className="btn btn-ghost">Ask about availability</Link>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm"><Link href="/shop/cart" className="font-medium text-teal-700 underline">View your cart</Link></p>
    </div>
  );
}
