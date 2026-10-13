import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { orderLines, orders, products, productVariants } from "../db/schema";
import { conflict, invalid } from "../lib/errors";
import { computeTotals, formatMoney } from "../lib/money";
import { randomToken, sha256 } from "../lib/crypto";
import { enforce } from "../auth/rate-limit";
import { audit } from "./audit";
import { publish } from "./events";
import { findOrCreateCustomer } from "./customers";
import { computeAvailability, levelsForVariants, reserveForOrder, type Availability } from "./inventory";
import { issueInvoiceForOrder } from "./invoices";
import { sendMail } from "./mail";
import { announce, notifyPermission } from "./notifications";
import { trackingUrl } from "./orders";
import { activeTaxes, getSettings, nextNumber } from "./settings";

/**
 * Online shop. The cart lives in a cookie as variant ids and quantities only; prices, taxes and stock are
 * always read from the database. Customers check out as guests and receive a private tracking link.
 */
export const MAX_CART_LINES = 30;
export const MAX_LINE_QTY = 999;

export const cartSchema = z.array(z.object({ v: z.string().uuid(), q: z.number().int().min(1).max(MAX_LINE_QTY) })).max(MAX_CART_LINES);
export type Cart = z.infer<typeof cartSchema>;

/** Never throws: a damaged or tampered cookie is an empty cart. */
export function parseCart(raw: string | undefined | null): Cart {
  if (!raw) return [];
  try {
    const parsed = cartSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    const merged = new Map<string, number>();
    for (const l of parsed.data) merged.set(l.v, Math.min(MAX_LINE_QTY, (merged.get(l.v) ?? 0) + l.q));
    return [...merged].map(([v, q]) => ({ v, q }));
  } catch {
    return [];
  }
}

export function setCartLine(cart: Cart, variantId: string, quantity: number, mode: "add" | "set"): Cart {
  if (!z.string().uuid().safeParse(variantId).success) throw invalid("Unknown product option.");
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_LINE_QTY) throw invalid(`Enter a quantity from 1 to ${MAX_LINE_QTY}.`);
  const existing = cart.find((l) => l.v === variantId);
  const q = Math.min(MAX_LINE_QTY, mode === "add" ? (existing?.q ?? 0) + quantity : quantity);
  if (q === 0) return cart.filter((l) => l.v !== variantId);
  if (existing) return cart.map((l) => (l.v === variantId ? { v: l.v, q } : l));
  if (cart.length >= MAX_CART_LINES) throw invalid(`A cart can hold up to ${MAX_CART_LINES} different items. Ask us for a quotation for larger orders.`);
  return [...cart, { v: variantId, q }];
}

export const cartCount = (cart: Cart) => cart.reduce((a, l) => a + l.q, 0);

export interface PricedLine {
  variantId: string;
  sku: string;
  slug: string;
  productName: string;
  variantName: string;
  quantity: number;
  unitPriceMinor: number;
  taxable: boolean;
  tracksStock: boolean;
  lineTotalMinor: number;
  availability: Availability;
  problem: string | null;
}

export async function priceCart(db: DB, cart: Cart) {
  const s = await getSettings(db);
  const ids = cart.map((l) => l.v);
  const rows = ids.length
    ? await db.select({ v: productVariants, name: products.name, slug: products.slug, status: products.status }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(inArray(productVariants.id, ids))
    : [];
  const levels = await levelsForVariants(db, rows.map((r) => r.v.id));
  const lines: PricedLine[] = [];
  for (const item of cart) {
    const r = rows.find((x) => x.v.id === item.v);
    if (!r) continue;
    const availability = computeAvailability(levels.filter((l) => l.variantId === r.v.id), r.v.tracksStock);
    let problem: string | null = null;
    if (!r.v.active || r.status !== "active") problem = "No longer available.";
    else if (r.v.currency !== s.defaultCurrency) problem = "Ask us for a quotation for this item.";
    else if (r.v.tracksStock && availability.available < item.q) problem = availability.available === 0 ? "Out of stock." : `Only ${availability.available} available.`;
    lines.push({ variantId: r.v.id, sku: r.v.sku, slug: r.slug, productName: r.name, variantName: r.v.name, quantity: item.q, unitPriceMinor: r.v.priceMinor, taxable: r.v.taxable, tracksStock: r.v.tracksStock, lineTotalMinor: r.v.priceMinor * item.q, availability, problem });
  }
  const totals = computeTotals({ lines, discountBp: 0, taxes: await activeTaxes(db) });
  const overLimit = totals.totalMinor >= s.shopOrderLimitMinor;
  return { lines, totals, currency: s.defaultCurrency, limitMinor: s.shopOrderLimitMinor, overLimit, ok: lines.length > 0 && !overLimit && lines.every((l) => !l.problem) };
}

export const checkoutInput = z
  .object({
    name: z.string().trim().min(2, "Enter your name.").max(120),
    phone: z.string().trim().min(9, "Enter a phone number we can call or WhatsApp.").max(40),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid e-mail address.").max(200)]).optional().default(""),
    company: z.string().trim().max(160).optional().default(""),
    fulfilmentMethod: z.enum(["pickup", "delivery"]),
    deliveryAddress: z.string().trim().max(400).optional().default(""),
    notes: z.string().trim().max(1000).optional().default(""),
    website: z.string().max(0).optional().default(""),
  })
  .refine((d) => d.fulfilmentMethod === "pickup" || d.deliveryAddress.length >= 8, { message: "Enter the delivery address (area, street and landmark).", path: ["deliveryAddress"] });

/**
 * Places a shop order: re-prices, reserves stock under locks and issues the invoice in one transaction.
 * Returns the order and the private tracking token (shown once and e-mailed; only its hash is stored).
 */
export async function placeShopOrder(db: DB, input: z.input<typeof checkoutInput>, cart: Cart, ip: string | null, now = new Date()) {
  const data = checkoutInput.parse(input);
  await enforce(db, `checkout:ip:${ip ?? "unknown"}`, 10, 60 * 60);
  const s = await getSettings(db);
  const priced = await priceCart(db, cart);
  if (priced.lines.length === 0) throw invalid("Your cart is empty.");
  const problems = priced.lines.filter((l) => l.problem).map((l) => `${l.productName} — ${l.variantName}: ${l.problem}`);
  if (problems.length) throw conflict(`Please update your cart:\n${problems.join("\n")}`);
  if (priced.overLimit) throw conflict(`Orders of ${formatMoney(priced.limitMinor, priced.currency)} or more are handled by quotation. Please send us your list instead.`);

  const token = randomToken(24);
  const order = await db.transaction(async (tx) => {
    const customer = await findOrCreateCustomer(tx, { name: data.name, phone: data.phone, email: data.email || null, company: data.company || null, address: data.fulfilmentMethod === "delivery" ? data.deliveryAddress : null });
    const [o] = await tx
      .insert(orders)
      .values({
        number: await nextNumber(tx, "O", now),
        source: "shop",
        customerId: customer.id,
        contactName: data.name,
        contactPhone: data.phone,
        contactEmail: data.email || null,
        fulfilmentMethod: data.fulfilmentMethod,
        deliveryAddress: data.fulfilmentMethod === "delivery" ? data.deliveryAddress : null,
        status: "pending",
        currency: priced.currency,
        subtotalMinor: priced.totals.subtotalMinor,
        taxMinor: priced.totals.taxMinor,
        totalMinor: priced.totals.totalMinor,
        taxBreakdown: priced.totals.breakdown,
        trackingTokenHash: sha256(token),
        notes: data.notes || null,
      })
      .returning();
    await reserveForOrder(
      tx,
      o!.id,
      priced.lines.filter((l) => l.tracksStock).map((l) => ({ variantId: l.variantId, quantity: l.quantity, label: `${l.productName} — ${l.variantName}` })),
      new Date(now.getTime() + s.reservationHoldHours * 3_600_000),
    );
    await tx.insert(orderLines).values(
      priced.lines.map((l, i) => ({ orderId: o!.id, variantId: l.variantId, description: `${l.productName} — ${l.variantName} (${l.sku})`, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, taxable: l.taxable, lineTotalMinor: priced.totals.lineTotals[i]! })),
    );
    const invoice = await issueInvoiceForOrder(tx, o!.id, { actor: null, now });
    await audit(tx, { action: "order.placed", targetType: "order", targetId: o!.id, ip, data: { number: o!.number, totalMinor: o!.totalMinor, invoice: invoice.number } });
    await notifyPermission(tx, "orders.write", { title: `New shop order ${o!.number}`, body: `${data.name} — ${formatMoney(o!.totalMinor, o!.currency)} (${data.fulfilmentMethod})`, link: `/admin/orders/${o!.id}` });
    if (data.email) {
      await sendMail(tx, {
        to: data.email,
        subject: `Order ${o!.number} received — ${s.companyName}`,
        body: [
          `Hello ${data.name},`,
          "",
          `Thank you for your order ${o!.number} (${formatMoney(o!.totalMinor, o!.currency)}). We will confirm it shortly.`,
          `Follow your order and pay online here (keep this link private): ${trackingUrl(token)}`,
          s.paymentInstructions ? `\nTo pay by mobile money or bank transfer:\n${s.paymentInstructions}\nUse ${invoice.number} as the reference.` : "",
          "",
          s.companyName,
          s.contactPhone,
        ].join("\n"),
      });
    }
    return o!;
  });
  publish({ topic: "orders" });
  publish({ topic: "stock" });
  announce();
  return { order, token };
}
