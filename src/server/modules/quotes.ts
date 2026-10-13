import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { customers, enquiries, orderLines, orders, products, productVariants, quoteLines, quotes, serviceJobs, users } from "../db/schema";
import { authorize, can, type Actor } from "../authz/policy";
import { conflict, invalid, notFound } from "../lib/errors";
import { computeTotals, formatMoney } from "../lib/money";
import { SERVICE_LINES } from "@/content/services";
import { audit } from "./audit";
import { publish } from "./events";
import { reserveForOrder } from "./inventory";
import { issueInvoiceForOrder } from "./invoices";
import { sendMail } from "./mail";
import { activeTaxes, getSettings, nextNumber } from "./settings";

const SLUGS = SERVICE_LINES.map((s) => s.slug) as [string, ...string[]];

export const quoteInput = z.object({
  customerId: z.string().uuid("Choose a customer."),
  enquiryId: z.string().uuid().nullable().optional(),
  serviceLine: z.union([z.literal(""), z.enum(SLUGS)]).optional().default(""),
  discountBp: z.number().int().min(0).max(5000),
  notes: z.string().trim().max(2000).optional().default(""),
  lines: z
    .array(
      z.union([
        z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(100_000) }),
        z.object({ description: z.string().trim().min(3).max(300), quantity: z.number().int().min(1).max(100_000), unitPriceMinor: z.number().int().min(0), taxable: z.boolean().default(true) }),
      ]),
    )
    .min(1, "Add at least one line."),
});

export async function createQuote(db: DB, actor: Actor, input: z.input<typeof quoteInput>) {
  authorize(actor, "quotes.write");
  const data = quoteInput.parse(input);
  const s = await getSettings(db);
  const [customer] = await db.select().from(customers).where(eq(customers.id, data.customerId));
  if (!customer) throw invalid("Unknown customer.");
  const ids = data.lines.flatMap((l) => ("variantId" in l ? [l.variantId] : []));
  const variants = ids.length ? await db.select({ v: productVariants, name: products.name }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(inArray(productVariants.id, ids)) : [];
  const resolved = data.lines.map((l) => {
    if ("variantId" in l) {
      const f = variants.find((x) => x.v.id === l.variantId);
      if (!f || !f.v.active) throw invalid("A selected product is not available.");
      return { variantId: f.v.id, description: `${f.name} — ${f.v.name} (${f.v.sku})`, quantity: l.quantity, unitPriceMinor: f.v.priceMinor, taxable: f.v.taxable };
    }
    return { variantId: null, description: l.description, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, taxable: l.taxable };
  });
  const totals = computeTotals({ lines: resolved, discountBp: data.discountBp, taxes: await activeTaxes(db) });
  const q = await db.transaction(async (tx) => {
    const [q] = await tx
      .insert(quotes)
      .values({
        number: await nextNumber(tx, "Q"),
        customerId: customer.id,
        enquiryId: data.enquiryId ?? null,
        serviceLine: data.serviceLine || null,
        currency: s.defaultCurrency,
        subtotalMinor: totals.subtotalMinor,
        discountBp: data.discountBp,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        taxBreakdown: totals.breakdown,
        validUntil: new Date(Date.now() + s.quoteValidityDays * 86_400_000),
        notes: data.notes || null,
        createdBy: actor.userId,
      })
      .returning();
    await tx.insert(quoteLines).values(resolved.map((l, i) => ({ ...l, quoteId: q!.id, lineTotalMinor: totals.lineTotals[i]!, sortOrder: i })));
    if (data.enquiryId) await tx.update(enquiries).set({ status: "quoted", customerId: customer.id }).where(eq(enquiries.id, data.enquiryId));
    await audit(tx, { actor, action: "quote.created", targetType: "quote", targetId: q!.id, data: { number: q!.number, totalMinor: q!.totalMinor } });
    return q!;
  });
  publish({ topic: "quotes" });
  return q;
}

export async function listQuotes(db: DB, actor: Actor) {
  authorize(actor, "quotes.read");
  return db.select({ q: quotes, customerName: customers.name, company: customers.company }).from(quotes).innerJoin(customers, eq(customers.id, quotes.customerId)).orderBy(desc(quotes.createdAt)).limit(300);
}

export async function getQuote(db: DB, actor: Actor, id: string) {
  authorize(actor, "quotes.read");
  const [row] = await db.select({ q: quotes, customer: customers, createdByName: users.name }).from(quotes).innerJoin(customers, eq(customers.id, quotes.customerId)).leftJoin(users, eq(users.id, quotes.createdBy)).where(eq(quotes.id, id));
  if (!row) throw notFound("Quotation not found.");
  const lines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, id)).orderBy(asc(quoteLines.sortOrder));
  const [order] = await db.select({ id: orders.id, number: orders.number }).from(orders).where(eq(orders.quoteId, id));
  const [job] = await db.select({ id: serviceJobs.id, number: serviceJobs.number }).from(serviceJobs).where(eq(serviceJobs.quoteId, id));
  return { ...row.q, customer: row.customer, createdByName: row.createdByName, lines, order: order ?? null, job: job ?? null };
}

async function lockQuote(tx: DB, id: string) {
  const [q] = await tx.select().from(quotes).where(eq(quotes.id, id)).for("update");
  if (!q) throw notFound("Quotation not found.");
  return q;
}

/** Marks the quotation sent and e-mails a plain-text copy when the customer has an address. */
export async function sendQuote(db: DB, actor: Actor, id: string) {
  authorize(actor, "quotes.write");
  const s = await getSettings(db);
  await db.transaction(async (tx) => {
    const q = await lockQuote(tx, id);
    if (!["draft", "sent"].includes(q.status)) throw conflict(`This quotation is ${q.status}.`);
    await tx.update(quotes).set({ status: "sent", sentAt: new Date() }).where(eq(quotes.id, id));
    const [c] = await tx.select().from(customers).where(eq(customers.id, q.customerId));
    if (c?.email) {
      const lines = await tx.select().from(quoteLines).where(eq(quoteLines.quoteId, id)).orderBy(asc(quoteLines.sortOrder));
      await sendMail(tx, {
        to: c.email,
        subject: `Quotation ${q.number} — ${s.companyName}`,
        body: [
          `Hello ${c.name},`,
          "",
          `Here is our quotation ${q.number}, valid until ${q.validUntil?.toISOString().slice(0, 10) ?? "further notice"}:`,
          "",
          ...lines.map((l) => `- ${l.quantity} × ${l.description}: ${formatMoney(l.lineTotalMinor, q.currency)}`),
          "",
          q.discountMinor ? `Discount: −${formatMoney(q.discountMinor, q.currency)}` : "",
          ...q.taxBreakdown.map((t) => `${t.name}: ${formatMoney(t.amountMinor, q.currency)}`),
          `Total: ${formatMoney(q.totalMinor, q.currency)}`,
          q.notes ? `\n${q.notes}` : "",
          "",
          "Reply to this e-mail or call us to accept.",
          s.companyName,
          s.contactPhone,
        ].filter((l) => l !== "").join("\n"),
      });
    }
    await audit(tx, { actor, action: "quote.sent", targetType: "quote", targetId: id, data: { emailed: !!c?.email } });
  });
  publish({ topic: "quotes" });
}

/**
 * Records the customer's acceptance: creates the order (stock reserved, invoice issued) and, if asked,
 * a service job for the work. Customers accept by phone, e-mail or in person; staff record it here.
 */
export async function acceptQuote(db: DB, actor: Actor, id: string, opts: { createJob: boolean; jobTitle?: string; serviceLine?: string }) {
  authorize(actor, "quotes.write");
  if (opts.createJob) authorize(actor, "jobs.write");
  const s = await getSettings(db);
  const result = await db.transaction(async (tx) => {
    const q = await lockQuote(tx, id);
    if (q.status !== "sent") throw conflict("Only a sent quotation can be accepted.");
    if (q.validUntil && q.validUntil < new Date()) throw conflict("This quotation has expired. Create a new one with current prices.");
    const [c] = await tx.select().from(customers).where(eq(customers.id, q.customerId));
    const lines = await tx.select().from(quoteLines).where(eq(quoteLines.quoteId, id)).orderBy(asc(quoteLines.sortOrder));
    const [o] = await tx
      .insert(orders)
      .values({
        number: await nextNumber(tx, "O"),
        source: "quote",
        customerId: q.customerId,
        quoteId: q.id,
        contactName: c!.name,
        contactPhone: c!.phone,
        contactEmail: c!.email,
        status: "pending",
        currency: q.currency,
        subtotalMinor: q.subtotalMinor,
        discountMinor: q.discountMinor,
        taxMinor: q.taxMinor,
        totalMinor: q.totalMinor,
        taxBreakdown: q.taxBreakdown,
        createdBy: actor.userId,
      })
      .returning();
    await tx.insert(orderLines).values(lines.map((l) => ({ orderId: o!.id, variantId: l.variantId, description: l.description, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, taxable: l.taxable, lineTotalMinor: l.lineTotalMinor })));
    const ids = lines.flatMap((l) => (l.variantId ? [l.variantId] : []));
    const tracked = ids.length ? await tx.select().from(productVariants).where(inArray(productVariants.id, ids)) : [];
    await reserveForOrder(
      tx,
      o!.id,
      lines.flatMap((l) => {
        const v = tracked.find((x) => x.id === l.variantId);
        return v?.tracksStock ? [{ variantId: v.id, quantity: l.quantity, label: v.sku }] : [];
      }),
      new Date(Date.now() + s.reservationHoldHours * 3_600_000),
    );
    const invoice = await issueInvoiceForOrder(tx, o!.id, { actor });
    let jobId: string | null = null;
    if (opts.createJob) {
      const line = opts.serviceLine || q.serviceLine;
      if (!line || !SLUGS.includes(line)) throw invalid("Choose the service line for the job.");
      const [j] = await tx
        .insert(serviceJobs)
        .values({ number: await nextNumber(tx, "J"), customerId: q.customerId, serviceLine: line, title: opts.jobTitle?.trim() || `Work for quotation ${q.number}`, quoteId: q.id, orderId: o!.id, createdBy: actor.userId })
        .returning();
      jobId = j!.id;
    }
    await tx.update(quotes).set({ status: "accepted", decidedAt: new Date() }).where(eq(quotes.id, id));
    if (q.enquiryId) await tx.update(enquiries).set({ status: "won" }).where(eq(enquiries.id, q.enquiryId));
    await audit(tx, { actor, action: "quote.accepted", targetType: "quote", targetId: id, data: { orderId: o!.id, invoice: invoice.number, jobId } });
    return { orderId: o!.id, jobId };
  });
  publish({ topic: "quotes" });
  publish({ topic: "orders" });
  publish({ topic: "stock" });
  if (result.jobId) publish({ topic: "jobs" });
  return result;
}

export async function declineQuote(db: DB, actor: Actor, id: string) {
  authorize(actor, "quotes.write");
  await db.transaction(async (tx) => {
    const q = await lockQuote(tx, id);
    if (!["draft", "sent"].includes(q.status)) throw conflict(`This quotation is ${q.status}.`);
    await tx.update(quotes).set({ status: "declined", decidedAt: new Date() }).where(eq(quotes.id, id));
    if (q.enquiryId) await tx.update(enquiries).set({ status: "lost" }).where(eq(enquiries.id, q.enquiryId));
    await audit(tx, { actor, action: "quote.declined", targetType: "quote", targetId: id });
  });
  publish({ topic: "quotes" });
}

export const canSeeQuotes = (actor: Actor) => can(actor, "quotes.read");
