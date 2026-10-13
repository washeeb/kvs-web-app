import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { actorFor, guest, setupDb, variant } from "./helpers";
import type { DB } from "@/server/db/client";
import { enquiries, invoices, jobs, mailOutbox, orders, serviceJobs } from "@/server/db/schema";
import { enquiryCustomer, submitEnquiry, updateEnquiry } from "@/server/modules/enquiries";
import { acceptQuote, createQuote, sendQuote } from "@/server/modules/quotes";
import { createJob, scheduleJob, setJobStatus } from "@/server/modules/service-jobs";
import { placeShopOrder, setCartLine } from "@/server/modules/shop";
import { receivePaystackWebhook, startOrderPayment, verifyAndApplyPayment, type FetchLike } from "@/server/modules/payments/paystack";
import { createCustomer, getCustomer } from "@/server/modules/customers";
import { exportCsv } from "@/server/modules/csv";

let db: DB;
let close: () => Promise<void>;
const PAYSTACK = "sk_test_kingsviewunittest123";
beforeAll(async () => {
  process.env.PAYSTACK_SECRET_KEY = PAYSTACK;
  ({ db, close } = await setupDb());
});
afterAll(async () => {
  delete process.env.PAYSTACK_SECRET_KEY;
  await close();
});
const as = (email: string, mfa = true) => actorFor(db, email, mfa);

describe("enquiries → quotations → orders and jobs", () => {
  it("public enquiries need a way to reply, are rate-limited and reach sales", async () => {
    await expect(submitEnquiry(db, { name: "No Contact", message: "I need a website for my shop." }, "192.0.2.1")).rejects.toThrow(/phone number or an e-mail/);
    await expect(submitEnquiry(db, { name: "Bot", phone: "0200000000", message: "Buy cheap things now!!", website: "spam" }, "192.0.2.1")).rejects.toThrow();
    const r = await submitEnquiry(db, { serviceLine: "photography-videography", name: "Kojo Asante", phone: "0551234567", message: "Wedding shoot in Kumasi on 20 December." }, "192.0.2.1");
    expect(r.number).toMatch(/^E-\d{4}-\d{5}$/);
    for (let i = 0; i < 6; i++) await submitEnquiry(db, { name: "Repeat Visitor", phone: "0550000000", message: "Repeated enquiry message text." }, "192.0.2.9").catch(() => {});
    await expect(submitEnquiry(db, { name: "Repeat Visitor", phone: "0550000000", message: "Repeated enquiry message text." }, "192.0.2.9")).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("a quotation with discount and taxes, accepted, becomes an order with an invoice and a scheduled job", async () => {
    const sales = await as("sales@kingsview.demo");
    const r = await submitEnquiry(db, { serviceLine: "cctv-installation", name: "Esi Boateng", company: "Boateng Stores", phone: "0247654321", email: "esi@example.com", message: "Four cameras for my shop, viewable on my phone." }, "192.0.2.2");
    const [e] = await db.select().from(enquiries).where(eq(enquiries.number, r.number));
    const customerId = await enquiryCustomer(db, sales, e!.id);
    const q = await createQuote(db, sales, {
      customerId,
      enquiryId: e!.id,
      serviceLine: "cctv-installation",
      discountBp: 500,
      lines: [{ variantId: (await variant(db, "KVS-CCTV-KIT4")).id, quantity: 1 }, { description: "Installation and configuration (1 day)", quantity: 1, unitPriceMinor: 80_000, taxable: true }],
    });
    expect(q.subtotalMinor).toBe(460_000);
    expect(q.discountMinor).toBe(23_000);
    expect(q.totalMinor).toBe(Math.round(437_000 * 1.2));
    await sendQuote(db, sales, q.id);
    expect((await db.select().from(mailOutbox).where(eq(mailOutbox.to, "esi@example.com"))).some((m) => m.subject.includes(q.number))).toBe(true);
    const { orderId, jobId } = await acceptQuote(db, sales, q.id, { createJob: true, jobTitle: "Install 4-camera CCTV at Boateng Stores" });
    expect((await db.select().from(orders).where(eq(orders.id, orderId)))[0]).toMatchObject({ source: "quote", totalMinor: q.totalMinor });
    expect((await db.select().from(invoices).where(eq(invoices.orderId, orderId)))[0]!.totalMinor).toBe(q.totalMinor);
    expect((await db.select().from(enquiries).where(eq(enquiries.id, e!.id)))[0]!.status).toBe("won");

    const tech = await actorFor(db, "tech@kingsview.demo");
    await scheduleJob(db, sales, jobId!, { scheduledAt: "2026-10-20T09:00", location: "Boateng Stores, Madina", assigneeUserId: tech.userId });
    await expect(setJobStatus(db, tech, jobId!, "completed", "")).rejects.toThrow(/what was done/);
    await setJobStatus(db, tech, jobId!, "in_progress");
    await setJobStatus(db, tech, jobId!, "completed", "Installed 4 cameras; phone app configured for the owner.");
    expect((await db.select().from(serviceJobs).where(eq(serviceJobs.id, jobId!)))[0]!.status).toBe("completed");
    const history = await getCustomer(db, sales, customerId);
    expect(history.quotes).toHaveLength(1);
    expect(history.jobs).toHaveLength(1);
    expect(history.invoices).toBeNull(); // sales cannot see invoices
  });
});

describe("roles", () => {
  it("limit each person to their work", async () => {
    const tech = await as("tech@kingsview.demo");
    await expect(createQuote(db, tech, { customerId: "00000000-0000-4000-8000-000000000000", discountBp: 0, lines: [{ description: "x x x", quantity: 1, unitPriceMinor: 1, taxable: true }] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(exportCsv(db, await as("sales@kingsview.demo"), "orders")).rejects.toMatchObject({ code: "forbidden" });
    const c = await createCustomer(db, await as("sales@kingsview.demo"), { name: "Walk-in Buyer", phone: "0209998887" });
    await expect(createJob(db, await as("store@kingsview.demo"), { customerId: c.id, serviceLine: "computer-training-consultancy", title: "Excel training" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateEnquiry(db, await as("accounts@kingsview.demo"), "00000000-0000-4000-8000-000000000000", { status: "won" })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("Paystack", () => {
  const sign = (b: string) => createHmac("sha512", PAYSTACK).update(b).digest("hex");

  it("pays the order's invoice through its private link, and only counts after Paystack verifies", async () => {
    const { order, token } = await placeShopOrder(db, guest, setCartLine([], (await variant(db, "KVS-A4-REAM")).id, 4, "add"), "192.0.2.3");
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    let verifyAs = { status: "success", amount: 0, currency: "GHS" };
    const f: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.endsWith("/transaction/initialize")) return { ok: true, status: 200, json: async () => ({ status: true, data: { authorization_url: "https://checkout.paystack.com/kvs1" } }) };
      return { ok: true, status: 200, json: async () => ({ status: true, data: { ...verifyAs, id: 1, channel: "mobile_money", paid_at: new Date().toISOString() } }) };
    };
    expect(await startOrderPayment(db, token, "", "https://kvs.example.test", "192.0.2.3", f)).toBe("https://checkout.paystack.com/kvs1");
    await expect(startOrderPayment(db, "wrong-token-wrong-token-wrong", "", "x", null, f)).rejects.toMatchObject({ code: "not_found" });
    const init = calls[0]!.body!;
    expect(init).toMatchObject({ amount: order.totalMinor, currency: "GHS", email: guest.email });
    expect(String(init.callback_url)).toContain(`/order/${token}?payment=`);
    // Wrong amount → not applied.
    verifyAs = { status: "success", amount: 1, currency: "GHS" };
    expect(await verifyAndApplyPayment(db, String(init.reference), f)).toBe("amount_mismatch");
    // A fresh attempt that Paystack confirms in full.
    await startOrderPayment(db, token, "", "https://kvs.example.test", "192.0.2.3", f);
    const ref = String(calls.at(-1)!.body!.reference);
    verifyAs = { status: "success", amount: order.totalMinor, currency: "GHS" };
    expect(await verifyAndApplyPayment(db, ref, f)).toBe("applied");
    expect(await verifyAndApplyPayment(db, ref, f)).toBe("already_applied");
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.paymentStatus).toBe("paid");
    await expect(startOrderPayment(db, token, "", "x", null, f)).rejects.toThrow(/already paid/);
  });

  it("accepts only correctly signed webhooks and queues verification once", async () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "KVS-REF-1" } });
    expect((await receivePaystackWebhook(db, body, null)).status).toBe(401);
    expect((await receivePaystackWebhook(db, body, "00")).status).toBe(401);
    expect((await receivePaystackWebhook(db, body, sign(body))).status).toBe(200);
    expect((await receivePaystackWebhook(db, body, sign(body))).status).toBe(200);
    expect(await db.select().from(jobs).where(eq(jobs.dedupeKey, "paystack:charge.success:KVS-REF-1"))).toHaveLength(1);
  });
});
