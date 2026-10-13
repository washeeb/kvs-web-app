import { eq } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { z } from "zod";
import type { DB } from "../../db/client";
import { invoices, payments } from "../../db/schema";
import { randomToken, safeEqual } from "../../lib/crypto";
import { conflict, invalid, notFound } from "../../lib/errors";
import { log } from "../../lib/log";
import { enforce } from "../../auth/rate-limit";
import { audit } from "../audit";
import { publish } from "../events";
import { enqueue } from "../jobs";
import { applyOnlinePayment, balanceOf, OPEN_STATUSES } from "../invoices";
import { getOrderByTracking } from "../orders";

/**
 * Paystack (cards and mobile money, GHS) on KingsView's own account. Test keys (sk_test_…) until KingsView goes live.
 * A payment only counts once KingsView has verified it with Paystack's API — never from the browser redirect alone.
 */
const API = "https://api.paystack.co";

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export function paystackConfig() {
  const secret = process.env.PAYSTACK_SECRET_KEY ?? "";
  if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(secret)) return null;
  return {
    secret,
    mode: secret.startsWith("sk_live_") ? ("live" as const) : ("test" as const),
    channels: (process.env.PAYSTACK_CHANNELS ?? "card,mobile_money").split(",").map((c) => c.trim()).filter(Boolean),
  };
}

const emailSchema = z.string().trim().toLowerCase().email("Enter an e-mail address for your Paystack receipt.").max(200);

/**
 * Starts checkout for the outstanding balance of a shop order's invoice. The customer is identified by the
 * private tracking token, so no account is needed. Returns the Paystack payment page URL.
 */
export async function startOrderPayment(db: DB, token: string, emailInput: string, appUrl: string, ip: string | null, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
  const cfg = paystackConfig();
  if (!cfg) throw invalid("Online payment is not available yet.");
  await enforce(db, `paystack:ip:${ip ?? "unknown"}`, 20, 60 * 60);
  const found = await getOrderByTracking(db, token);
  if (!found?.invoice) throw notFound("Order not found.");
  const { order, invoice } = found;
  if (!["pending", "confirmed", "ready"].includes(order.status)) throw conflict("This order can no longer be paid online.");
  if (!OPEN_STATUSES.includes(invoice.status)) throw conflict(invoice.status === "paid" ? "This order is already paid." : "This order can no longer be paid online.");
  if (invoice.currency !== "GHS") throw invalid("Online payment supports GHS only.");
  const email = emailSchema.parse(order.contactEmail || emailInput);
  const amount = balanceOf(invoice);
  const reference = `KVS-${invoice.number}-${randomToken(6).replace(/[^A-Za-z0-9]/g, "x")}`;
  const [payment] = await db.insert(payments).values({ invoiceId: invoice.id, provider: "paystack", reference, amountMinor: amount, currency: invoice.currency, mode: cfg.mode }).returning();
  const res = await fetchImpl(`${API}/transaction/initialize`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.secret}`, "content-type": "application/json" },
    body: JSON.stringify({
      email,
      amount, // pesewas
      currency: invoice.currency,
      reference,
      channels: cfg.channels,
      callback_url: `${appUrl}/order/${token}?payment=${encodeURIComponent(reference)}`,
      metadata: { order_number: order.number, invoice_number: invoice.number },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: { authorization_url?: string } } | null;
  const url = body?.data?.authorization_url;
  if (!res.ok || !body?.status || !url || !/^https:\/\/([a-z0-9-]+\.)*paystack\.(com|co)\//.test(url)) {
    await db.update(payments).set({ status: "failed", failureReason: `initialize failed: ${body?.message ?? res.status}` }).where(eq(payments.id, payment!.id));
    log.warn("paystack.initialize_failed", { order: order.number, status: res.status, message: body?.message });
    throw invalid("The payment provider could not start the payment. Please try again shortly.");
  }
  await audit(db, { action: "payment.initialized", targetType: "invoice", targetId: invoice.id, ip, data: { reference, amountMinor: amount, mode: cfg.mode } });
  return url;
}

export function verifyPaystackSignature(secret: string, rawBody: string, signature: string | null) {
  if (!signature) return false;
  return safeEqual(createHmac("sha512", secret).update(rawBody).digest("hex"), signature);
}

/** Webhook entry point: verify the HMAC-SHA512 signature, queue verification, acknowledge. */
export async function receivePaystackWebhook(db: DB, rawBody: string, signature: string | null) {
  const cfg = paystackConfig();
  if (!cfg) return { status: 503 };
  if (!verifyPaystackSignature(cfg.secret, rawBody, signature)) {
    log.warn("paystack.signature_rejected", {});
    return { status: 401 };
  }
  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400 };
  }
  const reference = event.data?.reference;
  if (event.event === "charge.success" && reference) {
    await enqueue(db, { type: "payment.paystack.verify", payload: { reference }, dedupeKey: `paystack:charge.success:${reference}` });
  }
  return { status: 200 };
}

/** Confirms a payment with Paystack's verify API and applies it once. Safe to call from the job and the return page. */
export async function verifyAndApplyPayment(db: DB, reference: string, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
  const cfg = paystackConfig();
  if (!cfg) throw new Error("Paystack is not configured");
  const [payment] = await db.select().from(payments).where(eq(payments.reference, reference));
  if (!payment) return "unknown_reference" as const;
  if (payment.status === "success") return "already_applied" as const;
  const res = await fetchImpl(`${API}/transaction/verify/${encodeURIComponent(reference)}`, { headers: { authorization: `Bearer ${cfg.secret}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Paystack verify responded ${res.status}`);
  const d = ((await res.json()) as { data?: { status?: string; amount?: number; currency?: string; id?: number; channel?: string; paid_at?: string; gateway_response?: string } }).data ?? {};
  if (d.status !== "success") {
    if (d.status === "failed" || d.status === "abandoned") await db.update(payments).set({ status: d.status, failureReason: d.gateway_response ?? null }).where(eq(payments.id, payment.id));
    return "not_successful" as const;
  }
  if (d.amount !== payment.amountMinor || d.currency !== payment.currency) {
    await db.update(payments).set({ status: "amount_mismatch", failureReason: `paid ${d.amount} ${d.currency}, expected ${payment.amountMinor} ${payment.currency}` }).where(eq(payments.id, payment.id));
    await audit(db, { action: "payment.amount_mismatch", targetType: "invoice", targetId: payment.invoiceId, data: { reference, paid: d.amount, currency: d.currency } });
    return "amount_mismatch" as const;
  }
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, payment.id)).for("update");
    if (p!.status === "success") return;
    await tx
      .update(payments)
      .set({ status: "success", providerTransactionId: d.id ? String(d.id) : null, method: d.channel ?? null, paidAt: d.paid_at ? new Date(d.paid_at) : new Date() })
      .where(eq(payments.id, payment.id));
    await applyOnlinePayment(tx, p!.invoiceId, { amountMinor: p!.amountMinor, reference });
    await audit(tx, { action: "payment.succeeded", targetType: "invoice", targetId: p!.invoiceId, data: { reference, amountMinor: p!.amountMinor, channel: d.channel, mode: p!.mode } });
  });
  publish({ topic: "invoices" });
  publish({ topic: "orders" });
  return "applied" as const;
}

export async function invoicePaymentsPublic(db: DB, invoiceId: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return [];
  return db.select({ reference: payments.reference, status: payments.status, amountMinor: payments.amountMinor, paidAt: payments.paidAt, mode: payments.mode }).from(payments).where(eq(payments.invoiceId, invoiceId));
}
