import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import { customers, orderLines, orders, products, productVariants } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, invalid, notFound } from "../lib/errors";
import { sha256 } from "../lib/crypto";
import { formatMoney } from "../lib/money";
import { audit } from "./audit";
import { publish } from "./events";
import { clearReservationExpiry, consumeReservations, releaseReservations, reserveForOrder } from "./inventory";
import { invoiceForOrder, issueInvoiceForOrder, settleInvoicesForClosedOrder } from "./invoices";
import { sendMail } from "./mail";
import { notifyPermission } from "./notifications";
import { queueFulfilment } from "./ses-link";
import { getSettings, nextNumber, phoneNumbers } from "./settings";

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "Received — awaiting confirmation",
  confirmed: "Confirmed — being prepared",
  ready: "Ready",
  fulfilled: "Completed",
  cancelled: "Cancelled",
  expired: "Expired (not confirmed in time)",
};

type Order = typeof orders.$inferSelect;
const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

async function lockOrder(tx: DB, id: string) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
  if (!o) throw notFound("Order not found.");
  return o;
}

/** E-mails the shop customer (if they gave an address). Queued; never blocks the change. */
async function emailCustomer(tx: DB, o: Order, subject: string, lines: string[]) {
  if (!o.contactEmail) return;
  const s = await getSettings(tx);
  await sendMail(tx, { to: o.contactEmail, subject: `${subject} — ${s.companyName}`, body: [`Hello ${o.contactName ?? ""},`, "", ...lines, "", s.companyName, phoneNumbers(s).join(" / ")].filter((l) => l !== undefined).join("\n") });
}

// ───────────────────────────── Reading ─────────────────────────────

export async function listOrders(db: DB, actor: Actor, filter: "open" | "ses" | "done" | "all" = "open") {
  authorize(actor, "orders.read");
  const where =
    filter === "open" ? inArray(orders.status, ["pending", "confirmed", "ready"])
    : filter === "ses" ? eq(orders.source, "ses")
    : filter === "done" ? inArray(orders.status, ["fulfilled", "cancelled", "expired"])
    : undefined;
  return db.select().from(orders).where(where).orderBy(desc(orders.createdAt)).limit(500);
}

export async function getOrder(db: DB, actor: Actor, id: string) {
  authorize(actor, "orders.read");
  const [o] = await db.select().from(orders).where(eq(orders.id, id));
  if (!o) throw notFound("Order not found.");
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, id));
  const [customer] = o.customerId ? await db.select().from(customers).where(eq(customers.id, o.customerId)) : [];
  return { ...o, lines, customer: customer ?? null };
}

/** Public order page, found only by its private tracking token. Shows no staff data. */
export async function getOrderByTracking(db: DB, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [o] = await db.select().from(orders).where(eq(orders.trackingTokenHash, sha256(token)));
  if (!o) return null;
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, o.id));
  const invoice = await invoiceForOrder(db, o.id);
  return { order: o, lines, invoice };
}

export const trackingUrl = (token: string) => `${appUrl()}/order/${token}`;

// ───────────────────────────── Status changes ─────────────────────────────

export async function confirmOrder(db: DB, actor: Actor, id: string) {
  authorize(actor, "orders.write");
  await db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== "pending") throw conflict(`Only new orders can be confirmed (this one is ${o.status}).`);
    await tx.update(orders).set({ status: "confirmed" }).where(eq(orders.id, id));
    await clearReservationExpiry(tx, id);
    if (o.source === "ses") {
      const lines = await tx.select().from(orderLines).where(and(eq(orderLines.orderId, id), eq(orderLines.fulfilmentStatus, "requested")));
      for (const l of lines) await queueFulfilment(tx, l.id, "accepted");
    }
    await audit(tx, { actor, action: "order.confirmed", targetType: "order", targetId: id });
    await emailCustomer(tx, o, `Order ${o.number} confirmed`, [`We have confirmed your order ${o.number} and are preparing it.`]);
  });
  publish({ topic: "orders" });
}

/** Ready for pickup, or out for delivery. */
export async function markReady(db: DB, actor: Actor, id: string, trackingReference?: string) {
  authorize(actor, "orders.write");
  await db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== "confirmed") throw conflict("Confirm the order before marking it ready.");
    await tx.update(orders).set({ status: "ready" }).where(eq(orders.id, id));
    if (o.source === "ses") {
      const lines = await tx.select().from(orderLines).where(and(eq(orderLines.orderId, id), eq(orderLines.fulfilmentStatus, "accepted")));
      for (const l of lines) await queueFulfilment(tx, l.id, "shipped", trackingReference?.trim() || undefined);
    }
    await audit(tx, { actor, action: "order.ready", targetType: "order", targetId: id });
    await emailCustomer(tx, o, `Order ${o.number} is ready`, [o.fulfilmentMethod === "delivery" ? "Your order is on its way to you." : "Your order is ready for pickup."]);
  });
  publish({ topic: "orders" });
}

/** Completes an order. Serial-tracked items need their serial numbers (by item id), which are marked sold. */
export async function fulfilOrder(db: DB, actor: Actor, id: string, serialsByVariant: Record<string, string[]> = {}) {
  authorize(actor, "orders.write");
  await db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (!["confirmed", "ready"].includes(o.status)) throw conflict("Only confirmed or ready orders can be completed.");
    await consumeReservations(tx, id, serialsByVariant);
    await tx.update(orders).set({ status: "fulfilled", fulfilledAt: new Date() }).where(eq(orders.id, id));
    if (o.source === "ses") {
      const lines = await tx.select().from(orderLines).where(and(eq(orderLines.orderId, id), inArray(orderLines.fulfilmentStatus, ["accepted", "shipped"])));
      for (const l of lines) await queueFulfilment(tx, l.id, "delivered");
    }
    await audit(tx, { actor, action: "order.fulfilled", targetType: "order", targetId: id });
    await emailCustomer(tx, o, `Order ${o.number} completed`, ["Thank you for your order."]);
  });
  publish({ topic: "orders" });
  publish({ topic: "stock" });
}

export async function cancelOrder(db: DB, actor: Actor, id: string, reason: string) {
  authorize(actor, "orders.write");
  if (reason.trim().length < 3) throw invalid("Give a reason for cancelling.");
  await db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (!["pending", "confirmed", "ready"].includes(o.status)) throw conflict("This order can no longer be cancelled.");
    await releaseReservations(tx, id);
    await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, id));
    if (o.source === "ses") {
      const lines = await tx.select().from(orderLines).where(and(eq(orderLines.orderId, id), inArray(orderLines.fulfilmentStatus, ["requested", "accepted", "shipped"])));
      for (const l of lines) await queueFulfilment(tx, l.id, "rejected");
    }
    await settleInvoicesForClosedOrder(tx, id, `order cancelled: ${reason.trim()}`);
    await audit(tx, { actor, action: "order.cancelled", targetType: "order", targetId: id, data: { reason: reason.trim() } });
    await emailCustomer(tx, o, `Order ${o.number} cancelled`, [`Your order ${o.number} has been cancelled: ${reason.trim()}`, "If you paid, we will contact you about your refund."]);
  });
  publish({ topic: "orders" });
  publish({ topic: "stock" });
}

// ───────────────────────────── Synclytics orders ─────────────────────────────

/**
 * SES asked KingsView to fulfil lines of one of its orders. Lines are priced at KingsView's cost (what SES pays);
 * unknown SKUs or lines without stock are rejected straight back to SES. Returns null if the order already exists.
 */
export async function createSesOrderTx(tx: DB, sesOrderNumber: string, lines: { line_id: string; sku: string | null; quantity: number }[]) {
  const [existing] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.source, "ses"), eq(orders.sesOrderNumber, sesOrderNumber)));
  if (existing) return null;
  const s = await getSettings(tx);
  const skus = lines.flatMap((l) => (l.sku ? [l.sku] : []));
  const variants = skus.length
    ? await tx.select({ v: productVariants, p: products }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(inArray(productVariants.sku, skus))
    : [];
  const priced = lines.map((l) => {
    const m = variants.find((x) => x.v.sku === l.sku && x.p.sesSync);
    const unit = m ? (m.v.costMinor ?? m.v.priceMinor) : 0;
    return { l, m, unit, total: unit * l.quantity };
  });
  const subtotal = priced.reduce((a, x) => a + (x.m ? x.total : 0), 0);
  const [o] = await tx
    .insert(orders)
    .values({
      number: await nextNumber(tx, "O"),
      source: "ses",
      sesOrderNumber,
      contactName: "Synclytics Enterprise Systems",
      fulfilmentMethod: "delivery",
      status: "pending",
      currency: s.defaultCurrency,
      subtotalMinor: subtotal,
      taxMinor: 0,
      totalMinor: subtotal,
      notes: "Supplied to Synclytics at KingsView cost price. Taxes are settled on SES's invoice to its customer.",
    })
    .returning();
  for (const x of priced) {
    const [line] = await tx
      .insert(orderLines)
      .values({
        orderId: o!.id,
        variantId: x.m?.v.id ?? null,
        description: x.m ? `${x.m.p.name} — ${x.m.v.name} (${x.m.v.sku})` : `Unknown SKU ${x.l.sku ?? "(none)"}`,
        quantity: x.l.quantity,
        unitPriceMinor: x.m ? x.unit : 0,
        taxable: false,
        lineTotalMinor: x.m ? x.total : 0,
        sesLineId: x.l.line_id,
        fulfilmentStatus: "requested",
      })
      .returning();
    let ok = !!x.m;
    if (ok && x.m!.v.tracksStock) {
      try {
        // Savepoint so a shortage on one line does not undo the rest.
        await tx.transaction((sp) => reserveForOrder(sp, o!.id, [{ variantId: x.m!.v.id, quantity: x.l.quantity, label: x.m!.v.sku }], null));
      } catch {
        ok = false;
      }
    }
    if (!ok) await queueFulfilment(tx, line!.id, "rejected");
  }
  await issueInvoiceForOrder(tx, o!.id, { actor: null });
  await audit(tx, { action: "order.received_from_ses", targetType: "order", targetId: o!.id, data: { sesOrderNumber, lines: lines.length } });
  await notifyPermission(tx, "orders.write", { title: `Synclytics order ${sesOrderNumber}`, body: `${lines.length} line(s) to fulfil — ${formatMoney(subtotal, s.defaultCurrency)} at cost.`, link: `/admin/orders/${o!.id}` });
  return o!;
}

export async function cancelSesOrderTx(tx: DB, sesOrderNumber: string) {
  const [o] = await tx.select().from(orders).where(and(eq(orders.source, "ses"), eq(orders.sesOrderNumber, sesOrderNumber))).for("update");
  if (!o) return false;
  if (["fulfilled", "cancelled", "expired"].includes(o.status)) return true;
  await releaseReservations(tx, o.id);
  await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, o.id));
  await tx.update(orderLines).set({ fulfilmentStatus: "cancelled" }).where(eq(orderLines.orderId, o.id));
  await settleInvoicesForClosedOrder(tx, o.id, "cancelled by Synclytics");
  await audit(tx, { action: "order.cancelled_by_ses", targetType: "order", targetId: o.id, data: { sesOrderNumber } });
  await notifyPermission(tx, "orders.write", { title: `Synclytics cancelled order ${sesOrderNumber}`, body: `${o.number} — stop preparing it.`, link: `/admin/orders/${o.id}` });
  return true;
}

