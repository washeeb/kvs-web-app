import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { orders, productVariants, stockLevels, stockLocations, stockMovements, stockReservations } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, invalid, notFound } from "../lib/errors";
import { audit } from "./audit";
import { publish } from "./events";
import { queueStockSync } from "./ses-link";

export type AvailabilityStatus = "in_stock" | "low_stock" | "out_of_stock" | "not_tracked";
export interface Availability {
  status: AvailabilityStatus;
  available: number;
  purchasable: boolean;
}

export const LOW_STOCK_AT = 3;
export const MAIN_LOCATION = "SHOP";

export function computeAvailability(levels: { onHand: number; reserved: number }[], tracksStock: boolean): Availability {
  if (!tracksStock) return { status: "not_tracked", available: 0, purchasable: true };
  const available = levels.reduce((sum, l) => sum + Math.max(0, l.onHand - l.reserved), 0);
  const status = available === 0 ? "out_of_stock" : available <= LOW_STOCK_AT ? "low_stock" : "in_stock";
  return { status, available, purchasable: available > 0 };
}

export async function levelsForVariants(db: DB, variantIds: string[]) {
  if (variantIds.length === 0) return [];
  return db
    .select({ id: stockLevels.id, variantId: stockLevels.variantId, locationId: stockLevels.locationId, locationName: stockLocations.name, onHand: stockLevels.onHand, reserved: stockLevels.reserved })
    .from(stockLevels)
    .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
    .where(inArray(stockLevels.variantId, variantIds));
}

export async function mainLocationId(db: DB) {
  const [loc] = await db.select({ id: stockLocations.id }).from(stockLocations).where(eq(stockLocations.code, MAIN_LOCATION));
  if (!loc) throw new Error("Stock location missing — run the seed.");
  return loc.id;
}

/** Reserves stock under row locks so two checkouts can never take the same last unit. Throws if short. */
export async function reserveForOrder(tx: DB, orderId: string, lines: { variantId: string; quantity: number; label: string }[], expiresAt: Date | null) {
  for (const line of lines) {
    const rows = await tx.select().from(stockLevels).where(eq(stockLevels.variantId, line.variantId)).orderBy(asc(stockLevels.id)).for("update");
    let remaining = line.quantity;
    for (const r of rows) {
      const take = Math.min(remaining, r.onHand - r.reserved);
      if (take <= 0) continue;
      await tx.update(stockLevels).set({ reserved: sql`${stockLevels.reserved} + ${take}` }).where(eq(stockLevels.id, r.id));
      await tx.insert(stockReservations).values({ stockLevelId: r.id, variantId: line.variantId, orderId, quantity: take, expiresAt });
      remaining -= take;
      if (remaining === 0) break;
    }
    if (remaining > 0) throw conflict(`Not enough stock for ${line.label}: ${line.quantity - remaining} of ${line.quantity} available.`);
    await queueStockSync(tx, line.variantId);
  }
}

export interface MovementInput {
  variantId: string;
  locationId: string;
  quantity: number;
  reason: "receipt" | "adjustment" | "sale" | "return";
  refType?: string;
  refId?: string;
  note?: string;
  actorUserId?: string | null;
}

export async function recordMovement(tx: DB, m: MovementInput) {
  if (m.quantity === 0) return;
  await tx.insert(stockMovements).values({ ...m, refType: m.refType ?? null, refId: m.refId ?? null, note: m.note ?? null, actorUserId: m.actorUserId ?? null });
}

async function settle(tx: DB, orderId: string, mode: "release" | "consume") {
  const active = await tx.select().from(stockReservations).where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
  for (const r of active) {
    await tx
      .update(stockLevels)
      .set(mode === "consume" ? { reserved: sql`${stockLevels.reserved} - ${r.quantity}`, onHand: sql`GREATEST(${stockLevels.onHand} - ${r.quantity}, 0)` } : { reserved: sql`GREATEST(${stockLevels.reserved} - ${r.quantity}, 0)` })
      .where(eq(stockLevels.id, r.stockLevelId));
    await tx.update(stockReservations).set({ status: mode === "consume" ? "consumed" : "released" }).where(eq(stockReservations.id, r.id));
    if (mode === "consume") {
      const [lvl] = await tx.select({ locationId: stockLevels.locationId }).from(stockLevels).where(eq(stockLevels.id, r.stockLevelId));
      await recordMovement(tx, { variantId: r.variantId, locationId: lvl!.locationId, quantity: -r.quantity, reason: "sale", refType: "order", refId: orderId });
    }
  }
  for (const variantId of new Set(active.map((r) => r.variantId))) await queueStockSync(tx, variantId);
  return active.length;
}

export const releaseReservations = (tx: DB, orderId: string) => settle(tx, orderId, "release");
export const consumeReservations = (tx: DB, orderId: string) => settle(tx, orderId, "consume");

export async function clearReservationExpiry(tx: DB, orderId: string) {
  await tx.update(stockReservations).set({ expiresAt: null }).where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
}

/** Job: releases holds of orders that were never confirmed or paid, and voids their unpaid invoices. */
export async function expireReservations(db: DB, now = new Date()) {
  const expired = await db.selectDistinct({ orderId: stockReservations.orderId }).from(stockReservations).where(and(eq(stockReservations.status, "active"), lt(stockReservations.expiresAt, now)));
  const { settleInvoicesForClosedOrder } = await import("./invoices");
  for (const { orderId } of expired) {
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!order || order.status !== "pending") return;
      await releaseReservations(tx, orderId);
      await tx.update(orders).set({ status: "expired" }).where(eq(orders.id, orderId));
      await settleInvoicesForClosedOrder(tx, orderId, "order expired before confirmation");
      await audit(tx, { action: "order.expired", targetType: "order", targetId: orderId });
    });
    publish({ topic: "orders" });
  }
  return expired.length;
}

export async function listMovements(db: DB, actor: Actor, variantId: string, limit = 25) {
  authorize(actor, "inventory.read");
  return db.select().from(stockMovements).where(eq(stockMovements.variantId, variantId)).orderBy(desc(stockMovements.createdAt)).limit(limit);
}

/** Sets a counted quantity (adjustment) or adds a delivery (receipt). Never below what is reserved. */
export async function changeStock(db: DB, actor: Actor, input: { variantId: string; mode: "count" | "receive"; quantity: number; note: string }) {
  authorize(actor, "inventory.adjust");
  if (!Number.isInteger(input.quantity) || input.quantity < 0) throw invalid("Enter a whole number of 0 or more.");
  if (input.mode === "receive" && input.quantity === 0) throw invalid("Enter how many units arrived.");
  if (input.mode === "count" && input.note.trim().length < 3) throw invalid("Give a reason for the stock count change.");
  await db.transaction(async (tx) => {
    const [variant] = await tx.select().from(productVariants).where(eq(productVariants.id, input.variantId));
    if (!variant) throw notFound("Product option not found.");
    if (!variant.tracksStock) throw invalid("This option does not track stock.");
    const locationId = await mainLocationId(tx);
    const [existing] = await tx.select().from(stockLevels).where(and(eq(stockLevels.variantId, input.variantId), eq(stockLevels.locationId, locationId))).for("update");
    const before = existing?.onHand ?? 0;
    const after = input.mode === "receive" ? before + input.quantity : input.quantity;
    if (existing && after < existing.reserved) throw conflict(`Cannot go below the ${existing.reserved} unit(s) reserved for open orders.`);
    if (existing) await tx.update(stockLevels).set({ onHand: after }).where(eq(stockLevels.id, existing.id));
    else await tx.insert(stockLevels).values({ variantId: input.variantId, locationId, onHand: after });
    await recordMovement(tx, { variantId: input.variantId, locationId, quantity: after - before, reason: input.mode === "receive" ? "receipt" : "adjustment", note: input.note.trim() || undefined, actorUserId: actor.userId });
    await audit(tx, { actor, action: input.mode === "receive" ? "stock.received" : "stock.counted", targetType: "variant", targetId: input.variantId, data: { sku: variant.sku, from: before, to: after, note: input.note.trim() } });
    await queueStockSync(tx, input.variantId);
  });
  publish({ topic: "stock" });
}
