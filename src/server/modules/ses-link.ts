import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "../db/client";
import { orderLines, orders, products, productVariants, sesInbound, sesOutbox, stockLevels, stockLocations } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { safeEqual } from "../lib/crypto";
import { conflict, notFound } from "../lib/errors";
import { log } from "../lib/log";
import { audit } from "./audit";
import { publish } from "./events";
import { enqueue } from "./jobs";
import { announce, notifyPermission } from "./notifications";

/**
 * KingsView side of the Synclytics (SES) partner contract v1 (SES-Web-App/docs/api/partner-integration-v1.md).
 *
 * Outbound: product/cost/stock/fulfilment changes are written to `ses_outbox` in the same transaction as the change,
 * then delivered by the job queue, signed with the inbound secret SES issued (HMAC-SHA256 of "<t>.<body>").
 * Inbound: SES posts order events to /api/ses/events, signed with the outbound secret; we verify, de-duplicate on the
 * event id and turn them into SES orders for staff to fulfil.
 *
 * Nothing is sent or accepted unless all four SES_* settings are present in the server environment.
 */
export const CONTRACT_VERSION = "2026-10-v1";
const TOLERANCE_S = 300;
const MAX_BODY = 256 * 1024;

export function sesConfig() {
  const baseUrl = (process.env.SES_BASE_URL ?? "").replace(/\/+$/, "");
  const connectionId = process.env.SES_CONNECTION_ID ?? "";
  const signingSecret = process.env.SES_SIGNING_SECRET ?? "";
  const verifySecret = process.env.SES_VERIFY_SECRET ?? "";
  if (!/^https?:\/\//.test(baseUrl) || !/^[0-9a-f-]{36}$/i.test(connectionId) || signingSecret.length < 16 || verifySecret.length < 16) return null;
  return { baseUrl, connectionId, signingSecret, verifySecret, mode: process.env.SES_MODE === "production" ? ("production" as const) : ("test" as const) };
}

export const signBody = (secret: string, t: number, body: string) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

// ───────────────────────────── Outbound ─────────────────────────────

type OutEvent =
  | { type: "product.upserted"; entityKey: string; data: Record<string, unknown> }
  | { type: "product.retired"; entityKey: string; data: { sku: string } }
  | { type: "stock.updated"; entityKey: string; data: { sku: string; on_hand: number; location: string } }
  | { type: "fulfilment.updated"; entityKey: string; data: Record<string, unknown> };

/** Versions must increase per entity: wall-clock milliseconds, bumped past anything already queued. */
async function nextVersion(tx: DB, entityKey: string) {
  const [last] = await tx.select({ v: sql<number>`max(${sesOutbox.version})` }).from(sesOutbox).where(eq(sesOutbox.entityKey, entityKey));
  return Math.max(Date.now(), Number(last?.v ?? 0) + 1);
}

async function queue(tx: DB, e: OutEvent) {
  if (!sesConfig()) return null;
  const eventId = `kvs_${randomUUID().replace(/-/g, "")}`;
  const version = await nextVersion(tx, e.entityKey);
  const [row] = await tx.insert(sesOutbox).values({ eventId, type: e.type, entityKey: e.entityKey, version, payload: e.data }).returning();
  await enqueue(tx, { type: "ses.deliver", payload: { id: row!.id }, dedupeKey: `ses:${row!.id}`, maxAttempts: 8 });
  return row!;
}

/** Product and price state for every option of a product (or retirement if it is no longer offered to SES). */
export async function queueProductSync(tx: DB, productId: string, opts: { retire?: boolean } = {}) {
  if (!sesConfig()) return 0;
  const [p] = await tx.select().from(products).where(eq(products.id, productId));
  if (!p) return 0;
  const variants = await tx.select().from(productVariants).where(eq(productVariants.productId, productId));
  for (const v of variants) {
    if (opts.retire || !p.sesSync) {
      if (opts.retire) await queue(tx, { type: "product.retired", entityKey: v.sku, data: { sku: v.sku } });
      continue;
    }
    await queue(tx, {
      type: "product.upserted",
      entityKey: v.sku,
      data: {
        sku: v.sku,
        name: (variants.length > 1 ? `${p.name} — ${v.name}` : p.name).slice(0, 200),
        description: p.summary ?? undefined,
        product_type: v.tracksStock ? "hardware" : "service_package",
        tracks_stock: v.tracksStock,
        active: p.status === "active" && v.active,
        ...(v.costMinor !== null ? { cost: { amount_minor: v.costMinor, currency: v.currency } } : {}),
      },
    });
    if (v.tracksStock) await queueStockSync(tx, v.id);
  }
  return variants.length;
}

/**
 * Stock offered to SES = what KingsView can still promise: on hand minus KingsView's own reservations,
 * so a shop sale and an SES order cannot both take the last unit.
 */
export async function queueStockSync(tx: DB, variantId: string) {
  if (!sesConfig()) return;
  const [row] = await tx
    .select({ v: productVariants, p: products })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.id, variantId));
  if (!row || !row.p.sesSync || !row.v.tracksStock) return;
  // Only sellable, open locations count (not a damaged-goods shelf or a closed store room).
  const levels = await tx
    .select({ onHand: stockLevels.onHand, reserved: stockLevels.reserved })
    .from(stockLevels)
    .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
    .where(and(eq(stockLevels.variantId, variantId), eq(stockLocations.sellable, true), eq(stockLocations.active, true)));
  const available = levels.reduce((a, l) => a + Math.max(0, l.onHand - l.reserved), 0);
  await queue(tx, { type: "stock.updated", entityKey: `${row.v.sku}@main`, data: { sku: row.v.sku, on_hand: available, location: "main" } });
}

/** Status of one SES order line, sent back to SES. */
export async function queueFulfilment(tx: DB, lineId: string, status: "accepted" | "rejected" | "shipped" | "delivered", trackingReference?: string) {
  const [l] = await tx.select({ line: orderLines, order: orders }).from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId)).where(eq(orderLines.id, lineId));
  if (!l?.line.sesLineId || !l.order.sesOrderNumber) return;
  await tx.update(orderLines).set({ fulfilmentStatus: status }).where(eq(orderLines.id, lineId));
  await queue(tx, {
    type: "fulfilment.updated",
    entityKey: `line:${l.line.sesLineId}`,
    data: { order_number: l.order.sesOrderNumber, line_id: l.line.sesLineId, status, ...(trackingReference ? { tracking_reference: trackingReference } : {}) },
  });
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; text: () => Promise<string> }>;

/** Job handler: delivers one outbox event. Throws on temporary failures so the job queue retries with back-off. */
export async function deliverSesEvent(db: DB, payload: Record<string, unknown>, fetchImpl: FetchLike = fetch as unknown as FetchLike, now = new Date()) {
  const cfg = sesConfig();
  const [row] = await db.select().from(sesOutbox).where(eq(sesOutbox.id, String(payload.id)));
  if (!row || row.status === "sent" || row.status === "dead") return;
  if (!cfg) throw new Error("SES link is not configured");
  const body = JSON.stringify({ id: row.eventId, type: row.type, occurred_at: row.createdAt.toISOString(), version: row.version, data: row.payload });
  const t = Math.floor(now.getTime() / 1000);
  let status = 0;
  let text = "";
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/api/v1/integrations/${cfg.connectionId}/events`, {
      method: "POST",
      headers: { "content-type": "application/json", "SES-Signature": `t=${t},v1=${signBody(cfg.signingSecret, t, body)}` },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    text = (await res.text().catch(() => "")).slice(0, 300);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(sesOutbox).set({ attempts: row.attempts + 1, lastError: msg.slice(0, 300), lastStatus: null }).where(eq(sesOutbox.id, row.id));
    throw new Error(`SES unreachable: ${msg}`);
  }
  if (status === 202 || status === 200) {
    await db.update(sesOutbox).set({ status: "sent", sentAt: new Date(), attempts: row.attempts + 1, lastStatus: status, lastError: null }).where(eq(sesOutbox.id, row.id));
    return;
  }
  await db.update(sesOutbox).set({ attempts: row.attempts + 1, lastStatus: status, lastError: text || `HTTP ${status}` }).where(eq(sesOutbox.id, row.id));
  // 429 and 5xx are temporary: retry. Other 4xx will not succeed by retrying the same event.
  if (status === 429 || status >= 500) throw new Error(`SES responded ${status}`);
  await db.update(sesOutbox).set({ status: "dead" }).where(eq(sesOutbox.id, row.id));
  log.warn("ses.delivery_rejected", { eventId: row.eventId, status, body: text });
  await notifyPermission(db, "integrations.manage", { title: `Synclytics rejected a ${row.type} event (${status})`, body: text || undefined, link: "/admin/ses" });
  announce();
}

// ───────────────────────────── Inbound ─────────────────────────────

const lineSchema = z.object({ line_id: z.string().min(1).max(100), sku: z.string().min(1).max(100).nullable(), quantity: z.number().int().min(1).max(100_000) });
const inboundSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_.:-]{8,100}$/),
  type: z.string().min(3).max(60),
  occurred_at: z.string().optional(),
  version: z.number().optional(),
  data: z.object({ order_number: z.string().min(1).max(60), lines: z.array(lineSchema).max(200).default([]) }).passthrough(),
});

/** Checks `SES-Signature: t=…,v1=…` (several v1 values allowed during secret rotation). */
export function verifySesSignature(secret: string, header: string | null, body: string, now = new Date()): "ok" | "missing" | "stale" | "bad" {
  if (!header) return "missing";
  const parts = header.split(",").map((p) => p.trim());
  const t = Number(parts.find((p) => p.startsWith("t="))?.slice(2));
  const sigs = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!Number.isFinite(t) || sigs.length === 0) return "missing";
  if (Math.abs(now.getTime() / 1000 - t) > TOLERANCE_S) return "stale";
  const expected = signBody(secret, t, body);
  return sigs.some((s) => safeEqual(s, expected)) ? "ok" : "bad";
}

/** HTTP entry point for SES → KingsView events. Returns the status and body to send back. */
export async function receiveSesEvent(db: DB, rawBody: string, signature: string | null, contentType: string | null, now = new Date()) {
  const cfg = sesConfig();
  if (!cfg) return { status: 503, body: { error: "link_not_configured" } };
  if (!contentType?.toLowerCase().startsWith("application/json")) return { status: 415, body: { error: "unsupported_media_type" } };
  if (Buffer.byteLength(rawBody) > MAX_BODY) return { status: 413, body: { error: "too_large" } };
  const check = verifySesSignature(cfg.verifySecret, signature, rawBody, now);
  if (check !== "ok") {
    log.warn("ses.inbound_signature_rejected", { reason: check });
    return { status: 401, body: { error: "invalid_signature", reason: check } };
  }
  let parsed: z.infer<typeof inboundSchema>;
  try {
    parsed = inboundSchema.parse(JSON.parse(rawBody));
  } catch {
    return { status: 400, body: { error: "invalid_event" } };
  }
  const [stored] = await db.insert(sesInbound).values({ eventId: parsed.id, type: parsed.type, payload: parsed, status: "processing" }).onConflictDoNothing().returning();
  if (!stored) return { status: 200, body: { status: "duplicate" } };
  try {
    let outcome: string;
    if (parsed.type === "order.fulfilment_requested") outcome = await createSesOrder(db, parsed.data.order_number, parsed.data.lines);
    else if (parsed.type === "order.cancelled") outcome = await cancelSesOrder(db, parsed.data.order_number);
    else outcome = "ignored";
    await db.update(sesInbound).set({ status: outcome === "ignored" ? "ignored" : "processed" }).where(eq(sesInbound.id, stored.id));
    return { status: 200, body: { status: outcome } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Let SES retry this id later: forget the record so the retry is processed.
    await db.delete(sesInbound).where(eq(sesInbound.id, stored.id));
    log.error("ses.inbound_failed", { eventId: parsed.id, error: msg });
    return { status: 500, body: { error: "processing_failed" } };
  }
}

/** SES asked KingsView to fulfil order lines: they become a back-office order (source "ses") for staff to confirm. */
async function createSesOrder(db: DB, sesOrderNumber: string, lines: z.infer<typeof lineSchema>[]) {
  const { createSesOrderTx } = await import("./orders");
  const order = await db.transaction((tx) => createSesOrderTx(tx, sesOrderNumber, lines));
  publish({ topic: "orders" });
  announce();
  return order ? "created" : "exists";
}

async function cancelSesOrder(db: DB, sesOrderNumber: string) {
  const { cancelSesOrderTx } = await import("./orders");
  const done = await db.transaction((tx) => cancelSesOrderTx(tx, sesOrderNumber));
  publish({ topic: "orders" });
  announce();
  return done ? "cancelled" : "not_found";
}

// ───────────────────────────── Admin view ─────────────────────────────

export async function sesStatus(db: DB, actor: Actor) {
  authorize(actor, "integrations.read");
  const cfg = sesConfig();
  const counts = await db.select({ status: sesOutbox.status, n: sql<number>`count(*)::int` }).from(sesOutbox).groupBy(sesOutbox.status);
  const recentOut = await db.select().from(sesOutbox).orderBy(desc(sesOutbox.createdAt)).limit(30);
  const recentIn = await db.select().from(sesInbound).orderBy(desc(sesInbound.receivedAt)).limit(20);
  const synced = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.sesSync, true));
  return {
    configured: !!cfg,
    mode: cfg?.mode ?? null,
    baseUrl: cfg?.baseUrl ?? null,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>,
    recentOut,
    recentIn,
    syncedProducts: synced[0]?.n ?? 0,
  };
}

/** Re-sends full product, cost and stock state for every product offered to SES (e.g. after first connecting). */
export async function resyncAll(db: DB, actor: Actor) {
  authorize(actor, "integrations.manage");
  if (!sesConfig()) throw conflict("The Synclytics link is not configured on the server.");
  const ids = await db.select({ id: products.id }).from(products).where(eq(products.sesSync, true));
  let n = 0;
  await db.transaction(async (tx) => {
    for (const { id } of ids) n += await queueProductSync(tx, id);
    await audit(tx, { actor, action: "ses.resync", data: { products: ids.length, options: n } });
  });
  return n;
}

/** Puts a dead event back in the queue. */
export async function retryDead(db: DB, actor: Actor, outboxId: string) {
  authorize(actor, "integrations.manage");
  const [row] = await db.select().from(sesOutbox).where(and(eq(sesOutbox.id, outboxId), inArray(sesOutbox.status, ["dead"])));
  if (!row) throw notFound("Event not found or not dead.");
  await db.update(sesOutbox).set({ status: "queued" }).where(eq(sesOutbox.id, row.id));
  await enqueue(db, { type: "ses.deliver", payload: { id: row.id }, dedupeKey: `ses:${row.id}:retry:${Date.now()}`, maxAttempts: 8 });
  await audit(db, { actor, action: "ses.retry", targetType: "ses_event", targetId: row.eventId });
}
