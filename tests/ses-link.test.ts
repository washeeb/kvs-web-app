import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { actorFor, guest, setupDb, variant } from "./helpers";
import type { DB } from "@/server/db/client";
import { notifications, orderLines, orders, sesOutbox, stockLevels } from "@/server/db/schema";
import { deliverSesEvent, receiveSesEvent, resyncAll, signBody, verifySesSignature, type FetchLike } from "@/server/modules/ses-link";
import { createProduct, updateProduct } from "@/server/modules/catalogue";
import { changeStock } from "@/server/modules/inventory";
import { placeShopOrder, setCartLine } from "@/server/modules/shop";
import { confirmOrder, fulfilOrder, markReady } from "@/server/modules/orders";

const SIGN = "whsec_inbound_secret_from_ses_0001"; // SES's inbound secret: KingsView signs with it
const VERIFY = "whsec_outbound_secret_from_ses_0002"; // SES's outbound secret: SES signs with it
const CONN = "3f2b6a4e-9c1d-4e5f-8a7b-0c1d2e3f4a5b";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => {
  Object.assign(process.env, { SES_BASE_URL: "https://ses.example.test", SES_CONNECTION_ID: CONN, SES_SIGNING_SECRET: SIGN, SES_VERIFY_SECRET: VERIFY });
  ({ db, close } = await setupDb());
});
afterAll(async () => {
  for (const k of ["SES_BASE_URL", "SES_CONNECTION_ID", "SES_SIGNING_SECRET", "SES_VERIFY_SECRET"]) delete process.env[k];
  await close();
});

const as = (email: string) => actorFor(db, email);
const outbox = async (type?: string) => db.select().from(sesOutbox).where(type ? eq(sesOutbox.type, type) : undefined).orderBy(asc(sesOutbox.createdAt));

/** What SES does on receipt (contract §2): HMAC-SHA256 over "<t>.<raw body>" with its inbound secret, ±300 s. */
function sesAccepts(header: string, body: string, now = Date.now()) {
  const t = Number(/t=(\d+)/.exec(header)![1]);
  const v1 = /v1=([0-9a-f]+)/.exec(header)![1];
  return Math.abs(now / 1000 - t) <= 300 && v1 === createHmac("sha256", SIGN).update(`${t}.${body}`).digest("hex");
}

function fakeSes(status = 202) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return { status, text: async () => (status >= 400 ? '{"error":"invalid_event"}' : '{"status":"accepted"}') };
  };
  return { f, calls };
}

/** An event as SES sends it (contract §3), signed with SES's outbound secret. */
function sesEvent(type: string, data: unknown, opts: { id?: string; t?: number; secret?: string } = {}) {
  const body = JSON.stringify({ id: opts.id ?? `evt_${Math.random().toString(36).slice(2, 12)}`, type, occurred_at: new Date().toISOString(), version: Date.now(), data });
  const t = opts.t ?? Math.floor(Date.now() / 1000);
  return { body, sig: `t=${t},v1=${signBody(opts.secret ?? VERIFY, t, body)}` };
}

describe("outbound events to SES", () => {
  beforeEach(async () => db.delete(sesOutbox));

  it("are queued only for products offered to SES, with cost and available stock", async () => {
    const store = await as("store@kingsview.demo");
    await createProduct(db, store, { name: "USB flash drive", status: "active", sesSync: true }, { sku: "KVS-USB-64", name: "64 GB", priceMinor: 9_000, costMinor: 6_000 });
    await createProduct(db, store, { name: "Shop-only item", status: "active", sesSync: false }, { sku: "KVS-LOCAL-1", name: "Std", priceMinor: 1_000 });
    const ups = await outbox("product.upserted");
    expect(ups.map((e) => (e.payload as { sku: string }).sku)).toEqual(["KVS-USB-64"]);
    expect(ups[0]!.payload).toMatchObject({ sku: "KVS-USB-64", product_type: "hardware", tracks_stock: true, active: true, cost: { amount_minor: 6_000, currency: "GHS" } });
    // Stock offered = on hand minus KingsView's own reservations.
    await changeStock(db, store, { variantId: (await variant(db, "KVS-USB-64")).id, mode: "receive", quantity: 10, note: "delivery" });
    let c = setCartLine([], (await variant(db, "KVS-USB-64")).id, 3, "add");
    await placeShopOrder(db, guest, c, "203.0.113.50");
    const stock = (await outbox("stock.updated")).map((e) => e.payload as { on_hand: number });
    expect(stock.at(-1)!.on_hand).toBe(7);
    c = [];
  });

  it("are retired at SES when a product stops being offered; versions only go up per SKU", async () => {
    const store = await as("store@kingsview.demo");
    const { product } = await createProduct(db, store, { name: "Retire me", status: "active", sesSync: true }, { sku: "KVS-RET-1", name: "Std", priceMinor: 500, costMinor: 300, tracksStock: false });
    await updateProduct(db, store, product.id, { name: "Retire me", status: "active", sesSync: false });
    const events = (await outbox()).filter((e) => e.entityKey === "KVS-RET-1");
    expect(events.map((e) => e.type)).toEqual(["product.upserted", "product.retired"]);
    expect(events[1]!.version).toBeGreaterThan(events[0]!.version);
  });

  it("are signed exactly as SES verifies them and marked sent on 202", async () => {
    await resyncAll(db, await as("owner@kingsview.demo"));
    const [e] = await outbox("product.upserted");
    const { f, calls } = fakeSes(202);
    await deliverSesEvent(db, { id: e!.id }, f);
    expect(calls[0]!.url).toBe(`https://ses.example.test/api/v1/integrations/${CONN}/events`);
    expect(sesAccepts(calls[0]!.headers["SES-Signature"]!, calls[0]!.body)).toBe(true);
    const env = JSON.parse(calls[0]!.body);
    expect(env).toMatchObject({ id: e!.eventId, type: "product.upserted", version: e!.version });
    expect(env.id).toMatch(/^[A-Za-z0-9_.:-]{8,100}$/);
    expect((await db.select().from(sesOutbox).where(eq(sesOutbox.id, e!.id)))[0]!.status).toBe("sent");
  });

  it("retry on 5xx/429 and stop with an alert on other 4xx", async () => {
    await resyncAll(db, await as("owner@kingsview.demo"));
    const [a, b] = await outbox("product.upserted");
    await expect(deliverSesEvent(db, { id: a!.id }, fakeSes(503).f)).rejects.toThrow(/503/);
    expect((await db.select().from(sesOutbox).where(eq(sesOutbox.id, a!.id)))[0]).toMatchObject({ status: "queued", attempts: 1 });
    await deliverSesEvent(db, { id: b!.id }, fakeSes(400).f);
    expect((await db.select().from(sesOutbox).where(eq(sesOutbox.id, b!.id)))[0]!.status).toBe("dead");
    const owner = await as("owner@kingsview.demo");
    expect((await db.select().from(notifications).where(eq(notifications.userId, owner.userId))).some((n) => n.title.includes("rejected"))).toBe(true);
  });
});

describe("inbound SES orders", () => {
  it("reject missing, wrong or stale signatures", async () => {
    const e = sesEvent("order.fulfilment_requested", { order_number: "O-SES-1", lines: [] });
    expect((await receiveSesEvent(db, e.body, null, "application/json")).status).toBe(401);
    expect((await receiveSesEvent(db, e.body, sesEvent("x", {}, { secret: "whsec_wrong_secret_value_0000" }).sig, "application/json")).status).toBe(401);
    const old = sesEvent("order.fulfilment_requested", { order_number: "O-SES-1", lines: [] }, { t: Math.floor(Date.now() / 1000) - 600 });
    expect(verifySesSignature(VERIFY, old.sig, old.body)).toBe("stale");
    expect((await receiveSesEvent(db, e.body, e.sig, "text/plain")).status).toBe(415);
  });

  it("become KingsView orders at cost, with stock reserved, and flow status back to SES", async () => {
    const mouse = await variant(db, "KVS-MOUSE-WL");
    const levelBefore = (await db.select().from(stockLevels).where(eq(stockLevels.variantId, mouse.id)))[0]!;
    const e = sesEvent("order.fulfilment_requested", { order_number: "O-2026-00077", lines: [{ line_id: "11111111-1111-4111-8111-111111111111", sku: "KVS-MOUSE-WL", quantity: 2 }, { line_id: "22222222-2222-4222-8222-222222222222", sku: "NO-SUCH-SKU", quantity: 1 }] }, { id: "evt_order_77" });
    expect(await receiveSesEvent(db, e.body, e.sig, "application/json")).toMatchObject({ status: 200, body: { status: "created" } });
    expect(await receiveSesEvent(db, e.body, e.sig, "application/json")).toMatchObject({ status: 200, body: { status: "duplicate" } });
    const [o] = await db.select().from(orders).where(eq(orders.sesOrderNumber, "O-2026-00077"));
    expect(o).toMatchObject({ source: "ses", status: "pending", subtotalMinor: 2 * mouse.costMinor!, taxMinor: 0 });
    expect((await db.select().from(stockLevels).where(eq(stockLevels.variantId, mouse.id)))[0]!.reserved).toBe(levelBefore.reserved + 2);
    const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, o!.id));
    expect(lines.find((l) => l.sesLineId === "22222222-2222-4222-8222-222222222222")!.fulfilmentStatus).toBe("rejected");

    const store = await as("store@kingsview.demo");
    await confirmOrder(db, store, o!.id);
    await markReady(db, store, o!.id, "DISPATCH-9");
    await fulfilOrder(db, store, o!.id);
    const updates = (await db.select().from(sesOutbox).where(and(eq(sesOutbox.type, "fulfilment.updated"), eq(sesOutbox.entityKey, "line:11111111-1111-4111-8111-111111111111"))).orderBy(asc(sesOutbox.version))).map((x) => x.payload as Record<string, unknown>);
    expect(updates.map((u) => u.status)).toEqual(["accepted", "shipped", "delivered"]);
    expect(updates[1]).toMatchObject({ order_number: "O-2026-00077", line_id: "11111111-1111-4111-8111-111111111111", tracking_reference: "DISPATCH-9" });
    const rejected = await db.select().from(sesOutbox).where(and(eq(sesOutbox.type, "fulfilment.updated"), eq(sesOutbox.entityKey, "line:22222222-2222-4222-8222-222222222222")));
    expect((rejected[0]!.payload as { status: string }).status).toBe("rejected");
  });

  it("are cancelled by SES, releasing the stock", async () => {
    const e = sesEvent("order.fulfilment_requested", { order_number: "O-2026-00078", lines: [{ line_id: "99999999-9999-4999-8999-999999999999", sku: "KVS-CAT6-10M", quantity: 4 }] });
    await receiveSesEvent(db, e.body, e.sig, "application/json");
    const v = await variant(db, "KVS-CAT6-10M");
    const reservedWith = (await db.select().from(stockLevels).where(eq(stockLevels.variantId, v.id)))[0]!.reserved;
    const c = sesEvent("order.cancelled", { order_number: "O-2026-00078", lines: [{ line_id: "99999999-9999-4999-8999-999999999999", sku: "KVS-CAT6-10M", quantity: 4 }] });
    expect(await receiveSesEvent(db, c.body, c.sig, "application/json")).toMatchObject({ status: 200, body: { status: "cancelled" } });
    expect((await db.select().from(stockLevels).where(eq(stockLevels.variantId, v.id)))[0]!.reserved).toBe(reservedWith - 4);
    expect((await db.select().from(orders).where(eq(orders.sesOrderNumber, "O-2026-00078")))[0]!.status).toBe("cancelled");
  });
});
