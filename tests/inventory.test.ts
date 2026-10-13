import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { actorFor, guest, setupDb, variant } from "./helpers";
import type { DB } from "@/server/db/client";
import { mailOutbox, notifications, productVariants, stockLevels, stockMovements, stockSerials } from "@/server/db/schema";
import {
  adjustStock,
  cancelTransfer,
  checkLowStock,
  completeCount,
  createTransfer,
  defaultLocationId,
  dispatchTransfer,
  getCount,
  listLocations,
  receiveStock,
  receiveTransfer,
  recordCounts,
  reorderList,
  saveLocation,
  scanIntoCount,
  searchSerials,
  startCount,
  stockOverview,
  updateStockSettings,
} from "@/server/modules/inventory";
import { createProduct } from "@/server/modules/catalogue";
import { parseCart, placeShopOrder, setCartLine } from "@/server/modules/shop";
import { confirmOrder, fulfilOrder } from "@/server/modules/orders";
import { cancelPurchaseOrder, createPurchaseOrder, draftOrdersFromReorder, getPurchaseOrder, receivePurchaseOrder, saveSupplier, sendPurchaseOrder } from "@/server/modules/purchasing";
import { getShopProduct } from "@/server/modules/catalogue";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await setupDb()));
afterAll(async () => close());

const as = (email: string) => actorFor(db, email, true);
const level = async (sku: string, locationId: string) => (await db.select().from(stockLevels).where(and(eq(stockLevels.variantId, (await variant(db, sku)).id), eq(stockLevels.locationId, locationId))))[0];
const cost = async (sku: string) => (await variant(db, sku)).costMinor;
let warehouse: string;
let damaged: string;
let shop: string;

describe("locations", () => {
  it("keep one default, refuse closing while stocked, and can be non-sellable", async () => {
    const owner = await as("owner@kingsview.demo");
    shop = await defaultLocationId(db);
    warehouse = (await saveLocation(db, owner, null, { code: "wh1", name: "Back store room", kind: "warehouse", sellable: true, isDefault: false, active: true })).id;
    damaged = (await saveLocation(db, owner, null, { code: "DMG", name: "Damaged goods shelf", kind: "other", sellable: false, isDefault: false, active: true })).id;
    expect((await listLocations(db)).map((l) => l.code)).toEqual(["SHOP", "WH1", "DMG"]); // default first, then by name
    await expect(saveLocation(db, owner, shop, { code: "SHOP", name: "KingsView shop", kind: "shop", sellable: true, isDefault: false, active: true })).rejects.toThrow(/one default/);
    await expect(saveLocation(db, owner, shop, { code: "SHOP", name: "KingsView shop", kind: "shop", sellable: true, isDefault: true, active: false })).rejects.toThrow(/must be active/);
    await expect(saveLocation(db, await as("store@kingsview.demo"), null, { code: "X1", name: "Nope", kind: "other", sellable: true, isDefault: false, active: true })).rejects.toThrow();
  });
});

describe("receiving, costs and adjustments", () => {
  it("weights the average cost by quantity and records the cost on each movement", async () => {
    const store = await as("store@kingsview.demo");
    expect(await cost("KVS-MOUSE-WL")).toBe(8_500);
    const before = (await level("KVS-MOUSE-WL", shop))!.onHand;
    await receiveStock(db, store, { variantId: (await variant(db, "KVS-MOUSE-WL")).id, quantity: before, unitCostMinor: 10_500, note: "Delivery from Compu-Ghana" });
    expect(await cost("KVS-MOUSE-WL")).toBe(9_500);
    const [m] = await db.select().from(stockMovements).where(and(eq(stockMovements.variantId, (await variant(db, "KVS-MOUSE-WL")).id), eq(stockMovements.reason, "receipt")));
    expect(m!.unitCostMinor).toBe(10_500);
  });

  it("removes damaged or lost stock with a reason, never below zero or what is reserved", async () => {
    const store = await as("store@kingsview.demo");
    const id = (await variant(db, "KVS-A4-REAM")).id;
    const onHand = (await level("KVS-A4-REAM", shop))!.onHand;
    await adjustStock(db, store, { variantId: id, locationId: shop, reason: "damaged", quantity: 2, note: "Water damage in the store" });
    expect((await level("KVS-A4-REAM", shop))!.onHand).toBe(onHand - 2);
    await expect(adjustStock(db, store, { variantId: id, locationId: shop, reason: "lost", quantity: 1, note: "x" })).rejects.toThrow(/what happened/);
    await expect(adjustStock(db, store, { variantId: id, locationId: shop, reason: "lost", quantity: onHand + 5, note: "Stock missing" })).rejects.toThrow(/only/);
    await expect(adjustStock(db, store, { variantId: id, locationId: shop, reason: "damaged", quantity: -1, note: "Wrong sign" })).rejects.toThrow(/positive/);
    await adjustStock(db, store, { variantId: id, locationId: shop, reason: "correction", quantity: -1, note: "Typing error last week" });
    const [mv] = await db.select().from(stockMovements).where(and(eq(stockMovements.variantId, id), eq(stockMovements.reason, "damaged")));
    expect(mv).toMatchObject({ quantity: -2, unitCostMinor: 6_000 });
    await expect(adjustStock(db, await as("sales@kingsview.demo"), { variantId: id, locationId: shop, reason: "found", quantity: 1, note: "Behind the shelf" })).rejects.toThrow();
  });

  it("does not sell stock held at a non-sellable location", async () => {
    const store = await as("store@kingsview.demo");
    const before = (await getShopProduct(db, "demo-wifi-router"))!.variants[0]!.availability.available;
    await receiveStock(db, store, { variantId: (await variant(db, "KVS-ROUTER-AC")).id, locationId: damaged, quantity: 3, note: "Returned boxes, damaged" });
    expect((await getShopProduct(db, "demo-wifi-router"))!.variants[0]!.availability.available).toBe(before);
    expect((await stockOverview(db, store, { q: "KVS-ROUTER-AC" }))[0]!.onHand).toBe(before + 3);
  });
});

describe("transfers", () => {
  it("leave the source on dispatch, arrive on receipt, and go back if cancelled in transit", async () => {
    const store = await as("store@kingsview.demo");
    const id = (await variant(db, "KVS-CAT6-3M")).id;
    const shopBefore = (await level("KVS-CAT6-3M", shop))!.onHand;
    const t = await createTransfer(db, store, { fromLocationId: shop, toLocationId: warehouse, lines: [{ variantId: id, quantity: 10 }, { variantId: id, quantity: 5 }] });
    expect(t.number).toMatch(/^TR-\d{4}-\d{5}$/);
    await dispatchTransfer(db, store, t.id);
    expect((await level("KVS-CAT6-3M", shop))!.onHand).toBe(shopBefore - 15);
    expect(await level("KVS-CAT6-3M", warehouse)).toBeUndefined();
    await receiveTransfer(db, store, t.id);
    expect((await level("KVS-CAT6-3M", warehouse))!.onHand).toBe(15);
    await expect(receiveTransfer(db, store, t.id)).rejects.toThrow(/on their way/);
    const back = await createTransfer(db, store, { fromLocationId: warehouse, toLocationId: shop, lines: [{ variantId: id, quantity: 5 }] });
    await dispatchTransfer(db, store, back.id);
    await cancelTransfer(db, store, back.id, "Van broke down");
    expect((await level("KVS-CAT6-3M", warehouse))!.onHand).toBe(15);
    await expect(createTransfer(db, store, { fromLocationId: shop, toLocationId: shop, lines: [{ variantId: id, quantity: 1 }] })).rejects.toThrow(/different/);
  });
});

describe("serial numbers", () => {
  it("are recorded on receipt, moved on transfer, and required and marked sold when an order is completed", async () => {
    const store = await as("store@kingsview.demo");
    const { variant: cam } = await createProduct(db, store, { name: "Dome camera 4MP", status: "active" }, { name: "Std", priceMinor: 45_000, costMinor: 30_000 });
    await updateStockSettings(db, store, cam.id, { barcode: "6941234567890", reorderPoint: 1, reorderQty: 4, leadTimeDays: 7, serialTracked: true });
    await expect(receiveStock(db, store, { variantId: cam.id, quantity: 2, serials: "CAM-A1" })).rejects.toThrow(/one serial number per unit/);
    await receiveStock(db, store, { variantId: cam.id, quantity: 3, serials: "cam-a1, CAM-A2\nCAM-A3", unitCostMinor: 30_000 });
    await expect(receiveStock(db, store, { variantId: cam.id, quantity: 1, serials: "CAM-A1" })).rejects.toThrow(/already in stock/);
    await expect(updateStockSettings(db, store, cam.id, { barcode: "", reorderPoint: null, reorderQty: null, leadTimeDays: null, serialTracked: false })).rejects.toThrow(/only be switched/);
    // Move one to the store room and back.
    const t = await createTransfer(db, store, { fromLocationId: shop, toLocationId: warehouse, lines: [{ variantId: cam.id, quantity: 1 }] });
    await expect(dispatchTransfer(db, store, t.id)).rejects.toThrow(/one serial number per unit/);
    const [line] = (await import("@/server/modules/inventory").then((m) => m.getTransfer(db, store, t.id))).lines;
    await dispatchTransfer(db, store, t.id, { [line!.line.id]: "CAM-A3" });
    expect((await db.select().from(stockSerials).where(eq(stockSerials.serial, "CAM-A3")))[0]!.status).toBe("in_transit");
    await receiveTransfer(db, store, t.id);
    expect((await db.select().from(stockSerials).where(eq(stockSerials.serial, "CAM-A3")))[0]!.locationId).toBe(warehouse);
    // Sell two from the shop.
    const cart = setCartLine(parseCart(null), cam.id, 2, "add");
    const { order } = await placeShopOrder(db, { ...guest, phone: "0247770001" }, cart, "198.51.100.40");
    await confirmOrder(db, store, order.id);
    await expect(fulfilOrder(db, store, order.id)).rejects.toThrow(/serial numbers/);
    await expect(fulfilOrder(db, store, order.id, { [cam.id]: ["CAM-A1", "CAM-A3"] })).rejects.toThrow(/at that location/);
    await fulfilOrder(db, store, order.id, { [cam.id]: ["CAM-A1", "CAM-A2"] });
    const sold = await searchSerials(db, store, "cam-a");
    expect(sold.map((s) => [s.s.serial, s.s.status, s.orderNumber])).toEqual([
      ["CAM-A1", "sold", order.number],
      ["CAM-A2", "sold", order.number],
      ["CAM-A3", "in_stock", null],
    ]);
  });
});

describe("stocktakes", () => {
  it("post counted minus the system quantity at the time of counting, so sales during the count are respected", async () => {
    const store = await as("store@kingsview.demo");
    const bag = (await variant(db, "KVS-BAG-156")).id;
    const bagStart = (await level("KVS-BAG-156", shop))!.onHand;
    const c = await startCount(db, store, { locationId: shop, blind: true });
    await expect(startCount(db, store, { locationId: shop })).rejects.toThrow(/still open/);
    // Counted bags before a sale: counted == system then; the later sale is a real movement.
    await recordCounts(db, store, c.id, [{ variantId: bag, counted: bagStart - 1 }]); // one bag missing
    const cart = setCartLine(parseCart(null), bag, 1, "add");
    const { order } = await placeShopOrder(db, { ...guest, phone: "0247770002" }, cart, "198.51.100.41");
    await confirmOrder(db, store, order.id);
    await fulfilOrder(db, store, order.id);
    // Cables scanned one by one (by SKU), counted after nothing changed.
    const cablesOnHand = (await level("KVS-CAT6-10M", shop))!.onHand;
    for (let i = 0; i < cablesOnHand + 2; i++) await scanIntoCount(db, store, c.id, "kvs-cat6-10m");
    await expect(scanIntoCount(db, store, c.id, "NOPE-123")).rejects.toThrow(/No item/);
    const r = await completeCount(db, store, c.id);
    expect(r.changed).toBe(2);
    expect((await level("KVS-BAG-156", shop))!.onHand).toBe(bagStart - 1 - 1); // one missing + one sold
    expect((await level("KVS-CAT6-10M", shop))!.onHand).toBe(cablesOnHand + 2);
    expect(r.varianceValueMinor).toBe(-17_000 + 2 * 5_000);
    expect((await getCount(db, store, c.id)).status).toBe("completed");
  });
});

describe("reorder alerts", () => {
  it("notify stock staff once when an item falls to its reorder point, and again only after it recovers", async () => {
    const store = await as("store@kingsview.demo");
    const id = (await variant(db, "KVS-BAG-156")).id;
    const avail = (await stockOverview(db, store, { q: "KVS-BAG-156" }))[0]!.available;
    await updateStockSettings(db, store, id, { barcode: "", reorderPoint: avail, reorderQty: 10, leadTimeDays: 5, serialTracked: false });
    expect((await reorderList(db, store)).map((r) => r.sku)).toContain("KVS-BAG-156");
    const notes = async () => (await db.select().from(notifications)).filter((n) => n.title.includes("reorder level")).length;
    const n0 = await notes();
    expect((await checkLowStock(db)).alerted).toBeGreaterThanOrEqual(1);
    const n1 = await notes();
    expect(n1).toBeGreaterThan(n0);
    expect((await checkLowStock(db)).alerted).toBe(0);
    await receiveStock(db, store, { variantId: id, quantity: 20 });
    expect((await checkLowStock(db)).recovered).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(productVariants).where(eq(productVariants.id, id)))[0]!.lowStockNotifiedAt).toBeNull();
  });
});

describe("purchasing", () => {
  it("raises, e-mails and receives purchase orders in parts, updating stock and average cost", async () => {
    const store = await as("store@kingsview.demo");
    const supplier = await saveSupplier(db, store, null, { name: "Accra IT Distributors", email: "orders@accra-it.example", leadTimeDays: 5 });
    const router = await variant(db, "KVS-ROUTER-AC");
    const onHand = (await level("KVS-ROUTER-AC", shop))!.onHand;
    const po = await createPurchaseOrder(db, store, { supplierId: supplier.id, lines: [{ variantId: router.id, quantity: 10, unitCostMinor: 50_000 }] });
    expect(po).toMatchObject({ status: "draft", totalMinor: 500_000 });
    await expect(receivePurchaseOrder(db, store, po.id, { lines: [{ lineId: "00000000-0000-4000-8000-000000000000", quantity: 1 }] })).rejects.toThrow(/Send/);
    expect((await sendPurchaseOrder(db, store, po.id)).emailed).toBe(true);
    expect((await db.select().from(mailOutbox).where(eq(mailOutbox.to, "orders@accra-it.example")))[0]!.body).toContain(po.number);
    const line = (await getPurchaseOrder(db, store, po.id)).lines[0]!.line;
    await expect(receivePurchaseOrder(db, store, po.id, { lines: [{ lineId: line.id, quantity: 11 }] })).rejects.toThrow(/only 10/);
    const grn = await receivePurchaseOrder(db, store, po.id, { reference: "DN-7781", lines: [{ lineId: line.id, quantity: 6 }] });
    expect(grn.number).toMatch(/^GRN-/);
    expect((await getPurchaseOrder(db, store, po.id)).po.status).toBe("partially_received");
    expect((await level("KVS-ROUTER-AC", shop))!.onHand).toBe(onHand + 6);
    await receivePurchaseOrder(db, store, po.id, { lines: [{ lineId: line.id, quantity: 4 }] });
    const done = await getPurchaseOrder(db, store, po.id);
    expect(done.po.status).toBe("received");
    expect(done.receipts).toHaveLength(2);
    await expect(cancelPurchaseOrder(db, store, po.id, "Too late")).rejects.toThrow(/closed/);
    // Sales staff cannot raise orders.
    await expect(createPurchaseOrder(db, await as("sales@kingsview.demo"), { supplierId: supplier.id, lines: [{ variantId: router.id, quantity: 1, unitCostMinor: 1 }] })).rejects.toThrow();
  });

  it("drafts orders from the reorder list, one per preferred supplier", async () => {
    const store = await as("store@kingsview.demo");
    const supplier = await saveSupplier(db, store, null, { name: "Bags & Co" });
    const bag = await variant(db, "KVS-BAG-156");
    const avail = (await stockOverview(db, store, { q: "KVS-BAG-156" }))[0]!.available;
    await updateStockSettings(db, store, bag.id, { barcode: "", reorderPoint: avail + 1, reorderQty: 12, leadTimeDays: 5, serialTracked: false, preferredSupplierId: supplier.id });
    const r = await draftOrdersFromReorder(db, store);
    expect(r.created).toHaveLength(1);
    const po = await getPurchaseOrder(db, store, r.created[0]!.id);
    expect(po.supplier.name).toBe("Bags & Co");
    expect(po.lines.map((l) => [l.sku, l.line.quantity])).toEqual([["KVS-BAG-156", 12]]);
  });
});
