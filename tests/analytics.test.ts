import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, guest, setupDb, variant } from "./helpers";
import type { DB } from "@/server/db/client";
import { buckets, forecastReport, holtForecast, inventoryReport, parseRange, paymentsReport, pipelineReport, productPerformance, receivablesAging, salesReport, taxReport } from "@/server/modules/analytics";
import { parseCart, placeShopOrder, setCartLine } from "@/server/modules/shop";
import { confirmOrder, fulfilOrder } from "@/server/modules/orders";
import { recordManualPayment } from "@/server/modules/invoices";
import { invoices } from "@/server/db/schema";
import { eq } from "drizzle-orm";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await setupDb()));
afterAll(async () => close());
const as = (email: string) => actorFor(db, email, true);

describe("periods", () => {
  const now = new Date("2026-10-13T10:00:00Z");
  it("resolve presets and custom ranges with an equal previous period", () => {
    const r = parseRange({ range: "7d" }, now);
    expect(r.from.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(r.prevFrom.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    const lm = parseRange({ range: "lm" }, now);
    expect([lm.from.toISOString().slice(0, 10), lm.to.toISOString().slice(0, 10)]).toEqual(["2026-09-01", "2026-10-01"]);
    const custom = parseRange({ from: "2026-01-01", to: "2026-03-31" }, now);
    expect(custom.days).toBe(90);
    expect(parseRange({ range: "nonsense" }, now).label).toBe("Last 30 days");
    expect(parseRange({ from: "2026-05-01", to: "2026-04-01" }, now).label).toBe("Last 30 days");
    expect(buckets(r)).toHaveLength(7);
    expect(buckets(parseRange({ range: "90d" }, now))[0]!.toISOString().slice(0, 10)).toBe("2026-07-13"); // weekly buckets start on Monday
    expect(buckets(parseRange({ range: "ytd" }, now))[0]!.toISOString().slice(0, 10)).toBe("2026-01-01"); // monthly beyond ~6 months
  });
});

describe("forecast maths", () => {
  it("follows a trend and stays at zero without demand", () => {
    expect(holtForecast([0, 0, 0, 0]).next).toBe(0);
    const rising = holtForecast([2, 4, 6, 8, 10, 12]);
    expect(rising.next).toBeGreaterThan(12);
    expect(rising.trend).toBeGreaterThan(0);
    expect(holtForecast([5, 5, 5, 5, 5]).next).toBeCloseTo(5, 5);
  });
});

describe("reports", () => {
  it("add up sales, cost of sales, margin, taxes, payments and receivables", async () => {
    const store = await as("store@kingsview.demo");
    const accounts = await as("accounts@kingsview.demo");
    const owner = await as("owner@kingsview.demo");
    const mouse = await variant(db, "KVS-MOUSE-WL"); // price 120.00, cost 85.00
    const r = parseRange({ range: "7d" });
    const before = await salesReport(db, owner, r);
    const cart = setCartLine(parseCart(null), mouse.id, 2, "add");
    const { order } = await placeShopOrder(db, { ...guest, phone: "0241110001" }, cart, "198.51.100.90");
    await confirmOrder(db, store, order.id);
    await fulfilOrder(db, store, order.id);
    const after = await salesReport(db, owner, r);
    expect(after.kpis.net.value - before.kpis.net.value).toBe(24_000);
    expect(after.kpis.invoices.value - before.kpis.invoices.value).toBe(1);
    expect(after.kpis.margin.value - before.kpis.margin.value).toBe(24_000 - 2 * 8_500);
    expect(after.series.reduce((a, s) => a + s.value, 0)).toBe(after.kpis.net.value);
    expect(after.channels.find((c) => c.label === "Online shop")!.value).toBeGreaterThanOrEqual(24_000);
    const perf = await productPerformance(db, owner, r);
    const row = perf.rows.find((x) => x.sku === "KVS-MOUSE-WL")!;
    expect(row).toMatchObject({ qty: 2, revenue: 24_000, cost: 17_000, margin: 7_000 });
    expect(["A", "B", "C"]).toContain(row.abc);
    const tax = await taxReport(db, owner, r);
    expect(tax.codes.map((c) => c.code).sort()).toEqual(["GETFUND", "NHIL", "VAT"]);
    expect(tax.totals.byCode.VAT).toBeGreaterThan(0);
    // Pay half the invoice by mobile money; the rest is outstanding.
    const [inv] = await db.select().from(invoices).where(eq(invoices.orderId, order.id));
    await recordManualPayment(db, accounts, inv!.id, { amountMinor: 10_000, method: "mobile_money", externalReference: "MOMO-123", paidOn: new Date().toISOString().slice(0, 10), note: "" });
    expect((await paymentsReport(db, owner, r)).find((p) => p.label === "Mobile money")!.value).toBeGreaterThanOrEqual(10_000);
    const aging = await receivablesAging(db, owner);
    expect(aging.invoices.find((i) => i.number === inv!.number)!.balance).toBe(inv!.totalMinor - 10_000);
    // Store staff see stock reports but not finance.
    await expect(taxReport(db, store, r)).rejects.toThrow();
  });

  it("value stock, forecast demand and summarise the pipeline", async () => {
    const owner = await as("owner@kingsview.demo");
    const inv = await inventoryReport(db, owner, parseRange({ range: "30d" }));
    expect(inv.value).toBeGreaterThan(0);
    expect(inv.byCategory.reduce((a, c) => a + c.value, 0)).toBe(inv.value);
    const f = await forecastReport(db, owner);
    const mouse = f.rows.find((x) => x.sku === "KVS-MOUSE-WL")!;
    expect(mouse.weekly.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(2);
    expect(mouse.forecastWeekly).toBeGreaterThan(0);
    expect(mouse.suggestedReorderPoint).toBeGreaterThanOrEqual(0);
    const p = await pipelineReport(db, owner, parseRange({ range: "12m" }));
    expect(p.totals.enquiries).toBeGreaterThanOrEqual(0);
  });
});

describe("weekly summary e-mail", () => {
  it("goes to report readers only, with finance lines only for finance roles, and can be switched off", async () => {
    const { sendWeeklyDigest } = await import("@/server/modules/analytics");
    const { updateSettings } = await import("@/server/modules/settings");
    const { mailOutbox } = await import("@/server/db/schema");
    const sent = await sendWeeklyDigest(db);
    expect(sent).toBeGreaterThanOrEqual(2);
    const mails = (await db.select().from(mailOutbox)).filter((m) => m.subject.startsWith("Weekly summary"));
    const to = (email: string) => mails.find((m) => m.to === email);
    expect(to("accounts@kingsview.demo")!.body).toContain("Payments received");
    expect(to("auditor@kingsview.demo")!.body).toContain("reorder point"); // auditors read stock too
    // Roles without report access get nothing.
    expect(to("store@kingsview.demo")).toBeUndefined();
    expect(to("sales@kingsview.demo")).toBeUndefined();
    await updateSettings(db, await as("owner@kingsview.demo"), { weeklyReport: false });
    expect(await sendWeeklyDigest(db)).toBe(0);
  });
});
