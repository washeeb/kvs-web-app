import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { actorFor, guest, setupDb, variant } from "./helpers";
import type { DB } from "@/server/db/client";
import { customers, invoices, mailOutbox, orders, stockLevels, stockMovements } from "@/server/db/schema";
import { cartCount, parseCart, placeShopOrder, priceCart, setCartLine } from "@/server/modules/shop";
import { cancelOrder, confirmOrder, fulfilOrder, getOrderByTracking, markReady } from "@/server/modules/orders";
import { expireReservations } from "@/server/modules/inventory";
import { DEFAULT_SETTINGS, getSettings, paymentDetails, phoneNumbers, updateSettings } from "@/server/modules/settings";
import { recordManualPayment, reverseManualPayment, getInvoice, voidInvoice } from "@/server/modules/invoices";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await setupDb()));
afterAll(async () => close());

const as = (email: string, mfa = true) => actorFor(db, email, mfa);
const stockOf = async (sku: string) => (await db.select().from(stockLevels).where(eq(stockLevels.variantId, (await variant(db, sku)).id)))[0]!;
const cartWith = async (lines: [string, number][]) => {
  let c = parseCart(null);
  for (const [sku, q] of lines) c = setCartLine(c, (await variant(db, sku)).id, q, "add");
  return c;
};

describe("company details", () => {
  it("are editable in settings and drive the payment and phone lines", async () => {
    const owner = await as("owner@kingsview.demo");
    const s = await updateSettings(db, owner, { momoName: "KingsView Solutions", bankAccountNumber: "", paymentInstructions: "Cash at the office." });
    expect(paymentDetails(s)).toEqual(["Mobile money: 0552225441 (KingsView Solutions)", "Cash at the office."]);
    expect(phoneNumbers({ ...s, contactPhoneAlt: "" })).toEqual(["0552225441"]);
    await expect(updateSettings(db, await as("sales@kingsview.demo"), { companyTin: "X" })).rejects.toThrow();
    await updateSettings(db, owner, { momoName: "", bankAccountNumber: DEFAULT_SETTINGS.bankAccountNumber, paymentInstructions: "" });
    expect(paymentDetails(await getSettings(db))).toHaveLength(2);
  });
});

describe("cart", () => {
  it("rejects tampered cookies and merges repeated lines", () => {
    expect(parseCart("{{")).toEqual([]);
    expect(parseCart(JSON.stringify([{ v: "not-a-uuid", q: 1 }]))).toEqual([]);
    const id = "7d1f6f7e-4c1a-4a54-9d55-1a2b3c4d5e6f";
    expect(parseCart(JSON.stringify([{ v: id, q: 2 }, { v: id, q: 1 }]))).toEqual([{ v: id, q: 3 }]);
    expect(cartCount(setCartLine([], id, 4, "add"))).toBe(4);
    expect(() => setCartLine([], id, 1000, "set")).toThrow();
  });

  it("prices from the database with Ghana taxes", async () => {
    const p = await priceCart(db, await cartWith([["KVS-MOUSE-WL", 2]]));
    expect(p.totals.subtotalMinor).toBe(24_000);
    expect(p.totals.taxMinor).toBe(4_800);
    expect(p.ok).toBe(true);
  });
});

describe("guest checkout", () => {
  it("creates the order, reserves stock, issues the invoice and e-mails a private tracking link", async () => {
    const before = await stockOf("KVS-MOUSE-WL");
    const { order, token } = await placeShopOrder(db, guest, await cartWith([["KVS-MOUSE-WL", 2], ["KVS-MUG-WHT", 10]]), "198.51.100.1");
    expect(order).toMatchObject({ source: "shop", status: "pending", paymentStatus: "unpaid", contactPhone: guest.phone });
    expect((await stockOf("KVS-MOUSE-WL")).reserved).toBe(before.reserved + 2);
    const [inv] = await db.select().from(invoices).where(eq(invoices.orderId, order.id));
    expect(inv).toMatchObject({ status: "issued", totalMinor: order.totalMinor, billToName: guest.name });
    // Only the hash is stored; the token finds the order, anything else does not.
    expect(order.trackingTokenHash).not.toContain(token);
    expect((await getOrderByTracking(db, token))!.order.id).toBe(order.id);
    expect(await getOrderByTracking(db, token.slice(0, -2) + "xx")).toBeNull();
    expect(await getOrderByTracking(db, "../../etc")).toBeNull();
    const [mail] = await db.select().from(mailOutbox).where(eq(mailOutbox.to, guest.email));
    expect(mail!.body).toContain(`/order/${token}`);
    expect(mail!.body).toContain("Mobile money: 0552225441");
    expect(mail!.body).toContain("Absa Bank, Ring Road Central Branch — account 0341071744 (KingsView Solutions)");
    expect(mail!.body).toContain("0552225441 / 0245636889");
  });

  it("matches returning customers by phone and requires an address for delivery", async () => {
    await placeShopOrder(db, { ...guest, email: "" }, await cartWith([["KVS-A4-REAM", 1]]), "198.51.100.2");
    expect(await db.select().from(customers).where(eq(customers.phone, guest.phone))).toHaveLength(1);
    await expect(placeShopOrder(db, { ...guest, fulfilmentMethod: "delivery", deliveryAddress: "" }, await cartWith([["KVS-A4-REAM", 1]]), "198.51.100.2")).rejects.toThrow(/delivery address/);
  });

  it("refuses short stock, large orders and empty carts without creating anything", async () => {
    const count = async () => (await db.select().from(orders)).length;
    const before = await count();
    await expect(placeShopOrder(db, guest, await cartWith([["KVS-ROUTER-AC", 50]]), "198.51.100.3")).rejects.toThrow(/Only 4 available/);
    await expect(placeShopOrder(db, guest, await cartWith([["KVS-MUG-WHT", 999]]), "198.51.100.3")).rejects.toThrow(/quotation/);
    await expect(placeShopOrder(db, guest, [], "198.51.100.3")).rejects.toThrow(/empty/);
    expect(await count()).toBe(before);
  });
});

describe("order handling", () => {
  it("moves through confirmed → ready → completed, consuming stock into the ledger", async () => {
    const before = await stockOf("KVS-CAT6-3M");
    const { order } = await placeShopOrder(db, guest, await cartWith([["KVS-CAT6-3M", 5]]), "198.51.100.4");
    const store = await as("store@kingsview.demo");
    await expect(markReady(db, store, order.id)).rejects.toMatchObject({ code: "conflict" });
    await confirmOrder(db, store, order.id);
    await markReady(db, store, order.id);
    await fulfilOrder(db, store, order.id);
    const after = await stockOf("KVS-CAT6-3M");
    expect(after.onHand).toBe(before.onHand - 5);
    expect(after.reserved).toBe(before.reserved);
    const moves = await db.select().from(stockMovements).where(and(eq(stockMovements.refId, order.id), eq(stockMovements.reason, "sale")));
    expect(moves.reduce((a, m) => a + m.quantity, 0)).toBe(-5);
  });

  it("cancelling releases stock and voids the unpaid invoice; unpaid holds expire", async () => {
    const store = await as("store@kingsview.demo");
    const before = await stockOf("KVS-BAG-156");
    const { order } = await placeShopOrder(db, guest, await cartWith([["KVS-BAG-156", 2]]), "198.51.100.5");
    await cancelOrder(db, store, order.id, "Customer changed mind");
    expect((await stockOf("KVS-BAG-156")).reserved).toBe(before.reserved);
    expect((await db.select().from(invoices).where(eq(invoices.orderId, order.id)))[0]!.status).toBe("void");

    const { order: o2 } = await placeShopOrder(db, guest, await cartWith([["KVS-BAG-156", 1]]), "198.51.100.5");
    await expireReservations(db, new Date(Date.now() + 49 * 3_600_000));
    expect((await db.select().from(orders).where(eq(orders.id, o2.id)))[0]!.status).toBe("expired");
    expect((await db.select().from(invoices).where(eq(invoices.orderId, o2.id)))[0]!.status).toBe("void");
  });
});

describe("payments", () => {
  it("are recorded by accounts with two-step verification, never above the balance, and reversed by a second person", async () => {
    const { order } = await placeShopOrder(db, guest, await cartWith([["KVS-A4-REAM", 2]]), "198.51.100.6");
    const [inv] = await db.select().from(invoices).where(eq(invoices.orderId, order.id));
    const pay = { method: "mobile_money" as const, externalReference: "MOMO-123456", paidOn: "2026-10-12" };
    await expect(recordManualPayment(db, await as("accounts@kingsview.demo", false), inv!.id, { ...pay, amountMinor: 100 })).rejects.toMatchObject({ code: "mfa_required" });
    await expect(recordManualPayment(db, await as("sales@kingsview.demo"), inv!.id, { ...pay, amountMinor: 100 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(recordManualPayment(db, await as("accounts@kingsview.demo"), inv!.id, { ...pay, amountMinor: inv!.totalMinor + 1 })).rejects.toThrow(/more than the balance/);
    await recordManualPayment(db, await as("accounts@kingsview.demo"), inv!.id, { ...pay, amountMinor: inv!.totalMinor });
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.paymentStatus).toBe("paid");
    await expect(voidInvoice(db, await as("owner@kingsview.demo"), inv!.id, "Wrong customer")).rejects.toThrow(/Payments exist/);
    const { payments } = await getInvoice(db, await as("accounts@kingsview.demo"), inv!.id);
    await expect(reverseManualPayment(db, await as("accounts@kingsview.demo"), payments[0]!.p.id, "Recorded twice")).rejects.toMatchObject({ code: "forbidden" });
    await reverseManualPayment(db, await as("owner@kingsview.demo"), payments[0]!.p.id, "Recorded twice");
    expect((await db.select().from(invoices).where(eq(invoices.id, inv!.id)))[0]).toMatchObject({ status: "issued", paidMinor: 0 });
  });
});
