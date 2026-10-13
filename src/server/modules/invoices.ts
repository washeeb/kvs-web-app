import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { customers, invoiceLines, invoices, orderLines, orders, payments, stockReservations, users } from "../db/schema";
import { authorize, can, type Actor } from "../authz/policy";
import { conflict, forbidden, invalid, notFound } from "../lib/errors";
import { formatMoney } from "../lib/money";
import { randomToken } from "../lib/crypto";
import { audit } from "./audit";
import { publish } from "./events";
import { announce, notifyPermission } from "./notifications";
import { getSettings, nextNumber } from "./settings";

const DAY = 86_400_000;
export const OPEN_STATUSES = ["issued", "part_paid"];
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  mobile_money: "Mobile money",
  bank_transfer: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
  card: "Card",
};

type Invoice = typeof invoices.$inferSelect;
export const balanceOf = (inv: Pick<Invoice, "totalMinor" | "paidMinor">) => inv.totalMinor - inv.paidMinor;
export const isOverdue = (inv: Pick<Invoice, "status" | "dueAt">, now = new Date()) => OPEN_STATUSES.includes(inv.status) && inv.dueAt.getTime() < now.getTime();

async function lockInvoice(tx: DB, id: string) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for("update");
  if (!inv) throw notFound("Invoice not found.");
  return inv;
}

/** Issues the order's invoice inside the caller's transaction (idempotent: returns the open one if it exists). */
export async function issueInvoiceForOrder(tx: DB, orderId: string, opts: { actor: Actor | null; now?: Date }) {
  const now = opts.now ?? new Date();
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order) throw notFound("Order not found.");
  const [existing] = await tx.select().from(invoices).where(and(eq(invoices.orderId, orderId), ne(invoices.status, "void")));
  if (existing) return existing;
  if (["cancelled", "expired"].includes(order.status)) throw conflict(`A ${order.status} order cannot be invoiced.`);
  const s = await getSettings(tx);
  const [customer] = order.customerId ? await tx.select().from(customers).where(eq(customers.id, order.customerId)) : [];
  const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  const billToName = order.source === "ses" ? "Synclytics Enterprise Systems" : (customer?.company || customer?.name || order.contactName || "Customer");
  const details = order.source === "ses" ? `SES order ${order.sesOrderNumber}` : [customer?.company ? customer.name : null, order.contactPhone, order.contactEmail, order.fulfilmentMethod === "delivery" ? order.deliveryAddress : null].filter(Boolean).join(" · ");
  const [inv] = await tx
    .insert(invoices)
    .values({
      number: await nextNumber(tx, "INV", now),
      customerId: order.customerId,
      orderId,
      billToName,
      billToDetails: details || null,
      currency: order.currency,
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      taxBreakdown: order.taxBreakdown,
      issuedAt: now,
      dueAt: new Date(now.getTime() + s.invoiceDueDays * DAY),
      createdBy: opts.actor?.userId ?? null,
      isDemo: order.isDemo,
    })
    .returning();
  if (lines.length) {
    await tx.insert(invoiceLines).values(lines.map((l, i) => ({ invoiceId: inv!.id, description: l.description, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, taxable: l.taxable, lineTotalMinor: l.lineTotalMinor, sortOrder: i })));
  }
  await audit(tx, { actor: opts.actor, action: "invoice.issued", targetType: "invoice", targetId: inv!.id, data: { number: inv!.number, orderId, totalMinor: inv!.totalMinor } });
  return inv!;
}

export async function issueInvoice(db: DB, actor: Actor, orderId: string) {
  authorize(actor, "finance.write");
  const inv = await db.transaction((tx) => issueInvoiceForOrder(tx, orderId, { actor }));
  publish({ topic: "invoices" });
  return inv;
}

async function syncOrderPayment(tx: DB, inv: Invoice) {
  if (!inv.orderId) return;
  const paymentStatus = inv.status === "paid" ? "paid" : inv.paidMinor > 0 ? "part_paid" : "unpaid";
  await tx.update(orders).set({ paymentStatus, paidAt: inv.status === "paid" ? (inv.paidAt ?? new Date()) : null }).where(eq(orders.id, inv.orderId));
  // Money received: keep the stock for this order until it is completed or cancelled.
  if (inv.paidMinor > 0) await tx.update(stockReservations).set({ expiresAt: null }).where(and(eq(stockReservations.orderId, inv.orderId), eq(stockReservations.status, "active")));
}

async function applyAmount(tx: DB, inv: Invoice, amountMinor: number, now: Date) {
  const paidMinor = inv.paidMinor + amountMinor;
  if (paidMinor < 0 || paidMinor > inv.totalMinor) throw conflict("That amount does not fit the invoice balance.");
  const status = paidMinor === 0 ? "issued" : paidMinor === inv.totalMinor ? "paid" : "part_paid";
  const [updated] = await tx.update(invoices).set({ paidMinor, status, paidAt: status === "paid" ? now : null }).where(eq(invoices.id, inv.id)).returning();
  await syncOrderPayment(tx, updated!);
  return updated!;
}

/** Verified online payment. Returns false (and alerts accounts) if the invoice can no longer take it. */
export async function applyOnlinePayment(tx: DB, invoiceId: string, payment: { amountMinor: number; reference: string }, now = new Date()) {
  const inv = await lockInvoice(tx, invoiceId);
  if (inv.status === "void" || payment.amountMinor > balanceOf(inv)) {
    await audit(tx, { action: "payment.needs_refund", targetType: "invoice", targetId: inv.id, data: { reference: payment.reference, amountMinor: payment.amountMinor, invoiceStatus: inv.status } });
    await notifyPermission(tx, "finance.write", { title: `Payment on ${inv.number} needs a refund`, body: `${formatMoney(payment.amountMinor, inv.currency)} (${payment.reference}) arrived after the invoice was ${inv.status === "void" ? "voided" : "settled"}.`, link: `/admin/invoices/${inv.id}` });
    return false;
  }
  await applyAmount(tx, inv, payment.amountMinor, now);
  return true;
}

export const manualPaymentInput = z.object({
  amountMinor: z.number().int().min(1, "Enter an amount above zero."),
  method: z.enum(["mobile_money", "bank_transfer", "cash", "cheque"]),
  externalReference: z.string().trim().min(2, "Enter the MoMo transaction ID, bank reference or receipt number.").max(100),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date the money was received."),
  note: z.string().trim().max(500).optional().default(""),
});

export async function recordManualPayment(db: DB, actor: Actor, invoiceId: string, input: z.input<typeof manualPaymentInput>, now = new Date()) {
  authorize(actor, "finance.write");
  const data = manualPaymentInput.parse(input);
  const paidAt = new Date(`${data.paidOn}T12:00:00Z`);
  if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > now.getTime() + DAY) throw invalid("The payment date cannot be in the future.");
  const inv = await db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (!OPEN_STATUSES.includes(inv.status)) throw conflict(`This invoice is ${inv.status}; it cannot take payments.`);
    if (data.amountMinor > balanceOf(inv)) throw conflict(`That is more than the balance of ${formatMoney(balanceOf(inv), inv.currency)}.`);
    const [dup] = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.invoiceId, inv.id), eq(payments.externalReference, data.externalReference), eq(payments.status, "success")));
    if (dup) throw conflict("A payment with this reference is already recorded on this invoice.");
    await tx.insert(payments).values({
      invoiceId: inv.id,
      provider: "manual",
      reference: `MAN-${inv.number}-${randomToken(4).replace(/[^A-Za-z0-9]/g, "x")}`,
      amountMinor: data.amountMinor,
      currency: inv.currency,
      status: "success",
      mode: "manual",
      method: data.method,
      externalReference: data.externalReference,
      note: data.note || null,
      recordedBy: actor.userId,
      paidAt,
    });
    await applyAmount(tx, inv, data.amountMinor, now);
    await audit(tx, { actor, action: "payment.recorded", targetType: "invoice", targetId: inv.id, data: { amountMinor: data.amountMinor, method: data.method, externalReference: data.externalReference } });
    return inv;
  });
  publish({ topic: "invoices" });
  publish({ topic: "orders" });
  return inv;
}

/** Corrects a payment recorded in error. A second accounts user (not the one who recorded it) must do it. */
export async function reverseManualPayment(db: DB, actor: Actor, paymentId: string, reason: string, now = new Date()) {
  authorize(actor, "finance.write");
  if (reason.trim().length < 5) throw invalid("Explain why the payment is being reversed.");
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!p) throw notFound("Payment not found.");
    if (p.provider !== "manual") throw conflict("Online payments are refunded through Paystack, not reversed here.");
    if (p.status !== "success") throw conflict("Only recorded payments can be reversed.");
    if (p.recordedBy === actor.userId) throw forbidden("Another accounts user must reverse a payment you recorded.");
    const inv = await lockInvoice(tx, p.invoiceId);
    await tx.update(payments).set({ status: "reversed", failureReason: reason.trim() }).where(eq(payments.id, p.id));
    await applyAmount(tx, inv, -p.amountMinor, now);
    await audit(tx, { actor, action: "payment.reversed", targetType: "invoice", targetId: inv.id, data: { paymentId: p.id, amountMinor: p.amountMinor, reason: reason.trim() } });
  });
  publish({ topic: "invoices" });
  publish({ topic: "orders" });
}

export async function voidInvoice(db: DB, actor: Actor, id: string, reason: string) {
  authorize(actor, "finance.write");
  if (reason.trim().length < 5) throw invalid("Give a reason for voiding the invoice.");
  await db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (inv.status === "void") throw conflict("This invoice is already void.");
    if (inv.paidMinor > 0) throw conflict("Payments exist on this invoice. Reverse or refund them before voiding.");
    await tx.update(invoices).set({ status: "void", voidedAt: new Date(), voidedBy: actor.userId, voidReason: reason.trim() }).where(eq(invoices.id, id));
    await audit(tx, { actor, action: "invoice.voided", targetType: "invoice", targetId: id, data: { number: inv.number, reason: reason.trim() } });
  });
  publish({ topic: "invoices" });
}

/** Cancelled or expired order: unpaid invoices are voided; paid ones are flagged to accounts for a refund. */
export async function settleInvoicesForClosedOrder(tx: DB, orderId: string, reason: string) {
  const open = await tx.select().from(invoices).where(and(eq(invoices.orderId, orderId), ne(invoices.status, "void")));
  for (const inv of open) {
    if (inv.paidMinor === 0) {
      await tx.update(invoices).set({ status: "void", voidedAt: new Date(), voidReason: reason }).where(eq(invoices.id, inv.id));
      await audit(tx, { action: "invoice.voided", targetType: "invoice", targetId: inv.id, data: { number: inv.number, reason, automatic: true } });
    } else {
      await notifyPermission(tx, "finance.write", { title: `Refund due on ${inv.number}`, body: `The order was closed (${reason}) after ${formatMoney(inv.paidMinor, inv.currency)} was paid.`, link: `/admin/invoices/${inv.id}` });
      announce();
    }
  }
}

export type InvoiceFilter = "open" | "overdue" | "paid" | "void" | "all";

export async function listInvoices(db: DB, actor: Actor, filter: InvoiceFilter = "open", now = new Date()) {
  authorize(actor, "finance.read");
  const conds = [];
  if (filter === "open") conds.push(inArray(invoices.status, OPEN_STATUSES));
  if (filter === "overdue") conds.push(inArray(invoices.status, OPEN_STATUSES), lt(invoices.dueAt, now));
  if (filter === "paid") conds.push(eq(invoices.status, "paid"));
  if (filter === "void") conds.push(eq(invoices.status, "void"));
  return db
    .select({ invoice: invoices, orderNumber: orders.number })
    .from(invoices)
    .leftJoin(orders, eq(orders.id, invoices.orderId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(invoices.issuedAt))
    .limit(500);
}

export async function getInvoice(db: DB, actor: Actor, id: string) {
  authorize(actor, "finance.read");
  const [row] = await db.select({ invoice: invoices, orderNumber: orders.number }).from(invoices).leftJoin(orders, eq(orders.id, invoices.orderId)).where(eq(invoices.id, id));
  if (!row) throw notFound("Invoice not found.");
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.sortOrder));
  const pays = await db.select({ p: payments, recordedByName: users.name }).from(payments).leftJoin(users, eq(users.id, payments.recordedBy)).where(eq(payments.invoiceId, id)).orderBy(desc(payments.createdAt));
  return { ...row.invoice, orderNumber: row.orderNumber, lines, payments: pays };
}

/** Public view of an order's invoice for the tracking page (no staff data). */
export async function invoiceForOrder(db: DB, orderId: string) {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.orderId, orderId), ne(invoices.status, "void")));
  if (!inv) return null;
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.sortOrder));
  return { ...inv, lines };
}

export async function receivables(db: DB, actor: Actor, now = new Date()) {
  if (!can(actor, "finance.read")) return null;
  const [r] = await db
    .select({
      outstanding: sql<number>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor}), 0)::bigint`,
      overdue: sql<number>`coalesce(sum(case when ${invoices.dueAt} < ${now} then ${invoices.totalMinor} - ${invoices.paidMinor} else 0 end), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(inArray(invoices.status, OPEN_STATUSES));
  return { outstandingMinor: Number(r?.outstanding ?? 0), overdueMinor: Number(r?.overdue ?? 0), openCount: r?.count ?? 0 };
}
