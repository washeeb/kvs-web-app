import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { priceCart } from "@/server/modules/shop";
import { getSettings } from "@/server/modules/settings";
import { readCart } from "@/server/web/cart";
import { ActionForm } from "@/components/action-form";
import { AvailabilityBadge } from "@/components/availability";
import { EmptyState, Field, Money } from "@/components/ui";
import { checkoutAction, updateCartAction } from "../../actions";

export const metadata: Metadata = { title: "Your cart" };

export default async function CartPage() {
  const db = getDb();
  const [cart, s] = await Promise.all([readCart(), getSettings(db)]);
  const priced = await priceCart(db, cart);
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600"><Link href="/shop" className="hover:underline">Shop</Link> / <span>Cart</span></nav>
      <h1 className="mt-3 text-3xl font-bold text-slate-900">Your cart</h1>
      {priced.lines.length === 0 ? (
        <div className="mt-8"><EmptyState title="Your cart is empty"><Link href="/shop" className="text-teal-700 underline">Browse the shop</Link></EmptyState></div>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
          <section aria-labelledby="items-heading" className="min-w-0">
            <h2 id="items-heading" className="sr-only">Items</h2>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {priced.lines.map((l) => (
                <li key={l.variantId} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <p className="font-medium"><Link href={`/shop/${l.slug}`} className="hover:text-teal-700">{l.productName}</Link></p>
                    <p className="text-sm text-slate-600">{l.variantName} · <Money minor={l.unitPriceMinor} currency={priced.currency} /> each</p>
                    <div className="mt-2"><AvailabilityBadge a={l.availability} showCount /></div>
                    {l.problem && <p className="mt-2 text-sm font-medium text-red-700" role="alert">{l.problem}</p>}
                  </div>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <p className="font-semibold"><Money minor={l.lineTotalMinor} currency={priced.currency} /></p>
                    <ActionForm action={updateCartAction} inline submitLabel="Update" submitClassName="btn btn-ghost">
                      <input type="hidden" name="variantId" value={l.variantId} />
                      <label htmlFor={`qty-${l.variantId}`} className="sr-only">Quantity of {l.productName} — {l.variantName}</label>
                      <input id={`qty-${l.variantId}`} name="quantity" type="number" min={1} max={999} defaultValue={l.quantity} className="field w-20" />
                    </ActionForm>
                    <ActionForm action={updateCartAction} inline submitLabel={<>Remove<span className="sr-only"> {l.productName} — {l.variantName}</span></>} submitClassName="text-sm text-red-700 underline">
                      <input type="hidden" name="variantId" value={l.variantId} />
                      <input type="hidden" name="op" value="remove" />
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
            <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd><Money minor={priced.totals.subtotalMinor} currency={priced.currency} /></dd></div>
              {priced.totals.breakdown.map((t) => <div key={t.code} className="flex justify-between"><dt>{t.name}</dt><dd><Money minor={t.amountMinor} currency={priced.currency} /></dd></div>)}
              <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold"><dt>Total</dt><dd><Money minor={priced.totals.totalMinor} currency={priced.currency} /></dd></div>
            </dl>
          </section>

          <section aria-labelledby="checkout-heading" className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 id="checkout-heading" className="text-lg font-semibold">Checkout</h2>
            {priced.overLimit ? (
              <p className="mt-2 text-sm text-slate-700">Orders of <Money minor={priced.limitMinor} currency={priced.currency} /> or more are handled by quotation. <Link href="/contact" className="text-teal-700 underline">Send us your list</Link> and we will reply with prices and delivery.</p>
            ) : (
              <div className="mt-3">
                <ActionForm action={checkoutAction} submitLabel="Place order" submitClassName="btn btn-accent w-full">
                  <Field label="Your name" htmlFor="name"><input id="name" name="name" className="field" required autoComplete="name" maxLength={120} /></Field>
                  <Field label="Phone or WhatsApp" htmlFor="phone"><input id="phone" name="phone" type="tel" className="field" required minLength={9} autoComplete="tel" maxLength={40} /></Field>
                  <Field label="E-mail (for your receipt and order link)" htmlFor="email"><input id="email" name="email" type="email" className="field" autoComplete="email" maxLength={200} /></Field>
                  <Field label="Business (optional)" htmlFor="company"><input id="company" name="company" className="field" autoComplete="organization" maxLength={160} /></Field>
                  <fieldset>
                    <legend className="field-label">How would you like to receive it?</legend>
                    <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="radio" name="fulfilmentMethod" value="pickup" defaultChecked /> Pick up from our shop</label>
                    <label className="inline-flex items-center gap-2 text-sm"><input type="radio" name="fulfilmentMethod" value="delivery" /> Deliver to me</label>
                  </fieldset>
                  <Field label="Delivery address (for delivery)" htmlFor="deliveryAddress" hint={s.deliveryNote}><textarea id="deliveryAddress" name="deliveryAddress" rows={2} className="field" maxLength={400} /></Field>
                  <Field label="Notes (optional)" htmlFor="notes"><input id="notes" name="notes" className="field" maxLength={1000} /></Field>
                  <div aria-hidden className="absolute -left-[10000px]"><label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
                  <p className="text-xs text-slate-600">We hold the stock for {s.reservationHoldHours} hours. After ordering you can pay online, or by mobile money or bank transfer using the details we show you.</p>
                  {!priced.ok && <p className="text-sm font-medium text-red-700">Fix the items marked above before ordering.</p>}
                </ActionForm>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
