import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { goodsReceiptLines, goodsReceipts, products, productVariants, purchaseOrderLines, purchaseOrders, stockLocations, suppliers, users } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, invalid, notFound } from "../lib/errors";
import { formatMoney } from "../lib/money";
import { audit } from "./audit";
import { publish } from "./events";
import { defaultLocationId, receiveStockTx, reorderList } from "./inventory";
import { sendMail } from "./mail";
import { getSettings, nextNumber, phoneNumbers } from "./settings";

// ───────────────────────────── Suppliers ─────────────────────────────

export const supplierInput = z.object({
  name: z.string().trim().min(2).max(120),
  contactName: z.string().trim().max(120).optional().default(""),
  email: z.union([z.literal(""), z.string().trim().email().max(200)]).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  address: z.string().trim().max(300).optional().default(""),
  taxId: z.string().trim().max(40).optional().default(""),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  active: z.boolean().default(true),
  notes: z.string().trim().max(2000).optional().default(""),
});

export async function listSuppliers(db: DB, actor: Actor, opts: { activeOnly?: boolean } = {}) {
  authorize(actor, "purchasing.read");
  return db.select().from(suppliers).where(opts.activeOnly ? eq(suppliers.active, true) : undefined).orderBy(asc(sql`lower(${suppliers.name})`));
}

export async function getSupplier(db: DB, actor: Actor, id: string) {
  authorize(actor, "purchasing.read");
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!s) throw notFound("Supplier not found.");
  const pos = await db.select().from(purchaseOrders).where(eq(purchaseOrders.supplierId, id)).orderBy(desc(purchaseOrders.createdAt)).limit(50);
  const items = await db
    .select({ id: productVariants.id, sku: productVariants.sku, name: products.name, productId: products.id })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.preferredSupplierId, id))
    .orderBy(asc(products.name));
  return { supplier: s, purchaseOrders: pos, items };
}

export async function saveSupplier(db: DB, actor: Actor, id: string | null, input: z.input<typeof supplierInput>) {
  authorize(actor, "purchasing.write");
  const d = supplierInput.parse(input);
  const values = {
    name: d.name,
    contactName: d.contactName || null,
    email: d.email || null,
    phone: d.phone || null,
    address: d.address || null,
    taxId: d.taxId || null,
    paymentTermsDays: d.paymentTermsDays,
    leadTimeDays: d.leadTimeDays ?? null,
    active: d.active,
    notes: d.notes || null,
  };
  const [row] = id ? await db.update(suppliers).set(values).where(eq(suppliers.id, id)).returning() : await db.insert(suppliers).values(values).returning();
  if (!row) throw notFound("Supplier not found.");
  await audit(db, { actor, action: id ? "supplier.updated" : "supplier.created", targetType: "supplier", targetId: row.id, data: values });
  return row;
}

// ───────────────────────────── Purchase orders ─────────────────────────────

export const poInput = z.object({
  supplierId: z.string().uuid(),
  locationId: z.string().uuid().nullable().optional(),
  expectedAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  lines: z
    .array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(1_000_000), unitCostMinor: z.number().int().min(0).max(100_000_000_000) }))
    .min(1, "Add at least one item.")
    .max(100),
});

export async function createPurchaseOrder(db: DB, actor: Actor, input: z.input<typeof poInput>) {
  authorize(actor, "purchasing.write");
  const d = poInput.parse(input);
  const po = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, d.supplierId));
    if (!s || !s.active) throw invalid("Choose an active supplier.");
    const locationId = d.locationId ?? (await defaultLocationId(tx));
    const merged = new Map<string, { quantity: number; unitCostMinor: number }>();
    for (const l of d.lines) {
      const cur = merged.get(l.variantId);
      merged.set(l.variantId, { quantity: (cur?.quantity ?? 0) + l.quantity, unitCostMinor: l.unitCostMinor });
    }
    const items = await tx
      .select({ id: productVariants.id, sku: productVariants.sku, name: productVariants.name, productName: products.name, tracksStock: productVariants.tracksStock })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, [...merged.keys()]));
    const lines = [...merged.entries()].map(([variantId, l], i) => {
      const it = items.find((x) => x.id === variantId);
      if (!it) throw invalid("Unknown item on the order.");
      if (!it.tracksStock) throw invalid(`${it.sku} does not track stock, so it cannot be received.`);
      return { variantId, description: `${it.productName}${it.name === "Standard" ? "" : ` — ${it.name}`} (${it.sku})`, quantity: l.quantity, unitCostMinor: l.unitCostMinor, lineTotalMinor: l.quantity * l.unitCostMinor, sortOrder: i };
    });
    const [row] = await tx
      .insert(purchaseOrders)
      .values({
        number: await nextNumber(tx, "PO"),
        supplierId: s.id,
        locationId,
        expectedAt: d.expectedAt ? new Date(`${d.expectedAt}T12:00:00Z`) : null,
        notes: d.notes || null,
        totalMinor: lines.reduce((a, l) => a + l.lineTotalMinor, 0),
        createdBy: actor.userId,
      })
      .returning();
    await tx.insert(purchaseOrderLines).values(lines.map((l) => ({ ...l, purchaseOrderId: row!.id })));
    await audit(tx, { actor, action: "po.created", targetType: "purchase_order", targetId: row!.id, data: { supplier: s.name, lines: lines.length, totalMinor: row!.totalMinor } });
    return row!;
  });
  publish({ topic: "purchasing" });
  return po;
}

async function lockPo(tx: DB, id: string) {
  const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for("update");
  if (!po) throw notFound("Purchase order not found.");
  return po;
}

/** Marks the order as sent and e-mails it to the supplier when they have an address. */
export async function sendPurchaseOrder(db: DB, actor: Actor, id: string, opts: { email: boolean } = { email: true }) {
  authorize(actor, "purchasing.write");
  const result = await db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    if (po.status !== "draft") throw conflict("Only draft purchase orders can be sent.");
    const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, po.supplierId));
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id)).orderBy(asc(purchaseOrderLines.sortOrder));
    await tx.update(purchaseOrders).set({ status: "sent", sentAt: new Date() }).where(eq(purchaseOrders.id, id));
    let emailed = false;
    if (opts.email && s?.email) {
      const co = await getSettings(tx);
      const [loc] = await tx.select().from(stockLocations).where(eq(stockLocations.id, po.locationId));
      await sendMail(tx, {
        to: s.email,
        subject: `Purchase order ${po.number} from ${co.companyName}`,
        body: [
          `Dear ${s.contactName || s.name},`,
          "",
          `Please supply the following (purchase order ${po.number}):`,
          "",
          ...lines.map((l) => `- ${l.quantity} × ${l.description} @ ${formatMoney(l.unitCostMinor, po.currency)} = ${formatMoney(l.lineTotalMinor, po.currency)}`),
          "",
          `Total: ${formatMoney(po.totalMinor, po.currency)}`,
          po.expectedAt ? `Needed by: ${po.expectedAt.toISOString().slice(0, 10)}` : "",
          `Deliver to: ${loc?.address || loc?.name || co.companyAddress}`,
          po.notes ? `\n${po.notes}` : "",
          "",
          "Please quote the order number on your delivery note and invoice.",
          co.companyName,
          [co.companyAddress, ...phoneNumbers(co), co.contactEmail].filter(Boolean).join(" · "),
        ].filter((l) => l !== "").join("\n"),
      });
      emailed = true;
    }
    await audit(tx, { actor, action: "po.sent", targetType: "purchase_order", targetId: id, data: { emailed } });
    return { emailed };
  });
  publish({ topic: "purchasing" });
  return result;
}

export const receiptInput = z.object({
  reference: z.string().trim().max(80).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
  lines: z.array(z.object({ lineId: z.string().uuid(), quantity: z.number().int().min(0).max(1_000_000), serials: z.string().optional() })).min(1),
});

/** Receives a delivery against the order (in part or in full): stock in, average cost updated, serials recorded. */
export async function receivePurchaseOrder(db: DB, actor: Actor, id: string, input: z.input<typeof receiptInput>) {
  authorize(actor, "purchasing.write");
  authorize(actor, "inventory.adjust");
  const d = receiptInput.parse(input);
  const grn = await db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    if (!["sent", "partially_received"].includes(po.status)) throw conflict("Send the purchase order before receiving against it.");
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id)).for("update");
    const wanted = d.lines.filter((l) => l.quantity > 0);
    if (wanted.length === 0) throw invalid("Enter the quantities that arrived.");
    const [g] = await tx.insert(goodsReceipts).values({ number: await nextNumber(tx, "GRN"), purchaseOrderId: id, locationId: po.locationId, receivedBy: actor.userId, reference: d.reference || null, notes: d.notes || null }).returning();
    for (const w of wanted) {
      const line = lines.find((l) => l.id === w.lineId);
      if (!line) throw invalid("Unknown line on this purchase order.");
      const outstanding = line.quantity - line.receivedQuantity;
      if (w.quantity > outstanding) throw invalid(`${line.description}: only ${outstanding} still to receive.`);
      await receiveStockTx(tx, actor, { variantId: line.variantId, locationId: po.locationId, quantity: w.quantity, unitCostMinor: line.unitCostMinor, serials: w.serials, note: `${po.number}${d.reference ? ` · ${d.reference}` : ""}` }, { type: "purchase_order", id });
      await tx.update(purchaseOrderLines).set({ receivedQuantity: line.receivedQuantity + w.quantity }).where(eq(purchaseOrderLines.id, line.id));
      line.receivedQuantity += w.quantity;
      await tx.insert(goodsReceiptLines).values({ goodsReceiptId: g!.id, purchaseOrderLineId: line.id, quantity: w.quantity, serials: w.serials ? w.serials.split(/[\s,;]+/).filter(Boolean).map((x) => x.toUpperCase()) : [] });
    }
    const done = lines.every((l) => l.receivedQuantity >= l.quantity);
    await tx.update(purchaseOrders).set({ status: done ? "received" : "partially_received" }).where(eq(purchaseOrders.id, id));
    await audit(tx, { actor, action: "po.received", targetType: "purchase_order", targetId: id, data: { grn: g!.number, lines: wanted.length, complete: done } });
    return g!;
  });
  publish({ topic: "purchasing" });
  publish({ topic: "stock" });
  return grn;
}

/** Cancels an order with nothing received, or closes one that arrived short. */
export async function cancelPurchaseOrder(db: DB, actor: Actor, id: string, reason: string) {
  authorize(actor, "purchasing.write");
  if (reason.trim().length < 3) throw invalid("Give a reason.");
  await db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    if (!["draft", "sent", "partially_received"].includes(po.status)) throw conflict("This purchase order is already closed.");
    const status = po.status === "partially_received" ? "closed" : "cancelled";
    await tx.update(purchaseOrders).set({ status, notes: [po.notes, `${status === "closed" ? "Closed short" : "Cancelled"}: ${reason.trim()}`].filter(Boolean).join("\n") }).where(eq(purchaseOrders.id, id));
    await audit(tx, { actor, action: `po.${status}`, targetType: "purchase_order", targetId: id, data: { reason } });
  });
  publish({ topic: "purchasing" });
}

export async function listPurchaseOrders(db: DB, actor: Actor, status?: string) {
  authorize(actor, "purchasing.read");
  return db
    .select({ po: purchaseOrders, supplierName: suppliers.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(status ? eq(purchaseOrders.status, status) : undefined)
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(300);
}

export async function getPurchaseOrder(db: DB, actor: Actor, id: string) {
  authorize(actor, "purchasing.read");
  const [row] = await db
    .select({ po: purchaseOrders, supplier: suppliers, locationName: stockLocations.name, createdByName: users.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(stockLocations, eq(stockLocations.id, purchaseOrders.locationId))
    .innerJoin(users, eq(users.id, purchaseOrders.createdBy))
    .where(eq(purchaseOrders.id, id));
  if (!row) throw notFound("Purchase order not found.");
  const lines = await db
    .select({ line: purchaseOrderLines, sku: productVariants.sku, serialTracked: productVariants.serialTracked })
    .from(purchaseOrderLines)
    .innerJoin(productVariants, eq(productVariants.id, purchaseOrderLines.variantId))
    .where(eq(purchaseOrderLines.purchaseOrderId, id))
    .orderBy(asc(purchaseOrderLines.sortOrder));
  const receipts = await db
    .select({ g: goodsReceipts, receivedByName: users.name })
    .from(goodsReceipts)
    .innerJoin(users, eq(users.id, goodsReceipts.receivedBy))
    .where(eq(goodsReceipts.purchaseOrderId, id))
    .orderBy(asc(goodsReceipts.createdAt));
  const receiptLines = receipts.length ? await db.select().from(goodsReceiptLines).where(inArray(goodsReceiptLines.goodsReceiptId, receipts.map((r) => r.g.id))) : [];
  return { ...row, lines, receipts: receipts.map((r) => ({ ...r, lines: receiptLines.filter((l) => l.goodsReceiptId === r.g.id) })) };
}

/**
 * Turns the reorder list into draft purchase orders, one per preferred supplier, at each item's current average
 * cost. Items without a preferred supplier are returned so staff can order them by hand.
 */
export async function draftOrdersFromReorder(db: DB, actor: Actor) {
  authorize(actor, "purchasing.write");
  const list = await reorderList(db, actor);
  const bySupplier = new Map<string, typeof list>();
  const unassigned: typeof list = [];
  for (const r of list) {
    if (!r.preferredSupplierId) unassigned.push(r);
    else bySupplier.set(r.preferredSupplierId, [...(bySupplier.get(r.preferredSupplierId) ?? []), r]);
  }
  const created: { id: string; number: string }[] = [];
  for (const [supplierId, rows] of bySupplier) {
    const po = await createPurchaseOrder(db, actor, { supplierId, notes: "Drafted from the reorder list.", lines: rows.map((r) => ({ variantId: r.variantId, quantity: r.suggestedQty, unitCostMinor: r.costMinor ?? 0 })) });
    created.push({ id: po.id, number: po.number });
  }
  return { created, unassigned: unassigned.map((u) => ({ sku: u.sku, name: u.name })) };
}

/** Open orders: what is still to arrive per item (for the reorder screen, so nothing is ordered twice). */
export async function onOrderByVariant(db: DB) {
  const rows = await db
    .select({ variantId: purchaseOrderLines.variantId, qty: sql<number>`sum(${purchaseOrderLines.quantity} - ${purchaseOrderLines.receivedQuantity})::int` })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
    .where(and(inArray(purchaseOrders.status, ["draft", "sent", "partially_received"])))
    .groupBy(purchaseOrderLines.variantId);
  return new Map(rows.map((r) => [r.variantId, r.qty]));
}
