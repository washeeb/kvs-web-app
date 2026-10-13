import { desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { customers, enquiries, invoices, orders, quotes, serviceJobs } from "../db/schema";
import { authorize, can, type Actor } from "../authz/policy";
import { invalid, notFound } from "../lib/errors";
import { audit } from "./audit";
import { nextNumber } from "./settings";

export const customerInput = z.object({
  name: z.string().trim().min(2, "Enter the customer's name.").max(120),
  company: z.string().trim().max(160).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid e-mail address.").max(200)]).optional().default(""),
  address: z.string().trim().max(400).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
});

const clean = (d: z.infer<typeof customerInput>) => ({
  name: d.name,
  company: d.company || null,
  phone: d.phone || null,
  email: d.email || null,
  address: d.address || null,
  notes: d.notes || null,
});

export async function createCustomer(db: DB, actor: Actor, input: z.input<typeof customerInput>) {
  authorize(actor, "customers.write");
  const data = customerInput.parse(input);
  if (!data.phone && !data.email) throw invalid("Enter a phone number or an e-mail address.");
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(customers).values({ number: await nextNumber(tx, "C"), ...clean(data) }).returning();
    await audit(tx, { actor, action: "customer.created", targetType: "customer", targetId: c!.id });
    return c!;
  });
}

export async function updateCustomer(db: DB, actor: Actor, id: string, input: z.input<typeof customerInput>) {
  authorize(actor, "customers.write");
  const data = customerInput.parse(input);
  const [c] = await db.select().from(customers).where(eq(customers.id, id));
  if (!c) throw notFound("Customer not found.");
  await db.update(customers).set(clean(data)).where(eq(customers.id, id));
  await audit(db, { actor, action: "customer.updated", targetType: "customer", targetId: id });
}

/**
 * Finds the customer behind a shop order or enquiry by e-mail or phone, or creates one.
 * Runs inside the caller's transaction; never overwrites existing details with blanks.
 */
export async function findOrCreateCustomer(tx: DB, contact: { name: string; phone?: string | null; email?: string | null; company?: string | null; address?: string | null }) {
  const email = contact.email?.trim().toLowerCase() || null;
  const phone = contact.phone?.replace(/\s+/g, "") || null;
  const conds = [email ? eq(customers.email, email) : undefined, phone ? eq(customers.phone, phone) : undefined].filter(Boolean);
  if (conds.length) {
    const [existing] = await tx.select().from(customers).where(or(...conds)).limit(1);
    if (existing) return existing;
  }
  const [c] = await tx
    .insert(customers)
    .values({ number: await nextNumber(tx, "C"), name: contact.name, email, phone, company: contact.company || null, address: contact.address || null })
    .returning();
  return c!;
}

export async function listCustomers(db: DB, actor: Actor, q?: string) {
  authorize(actor, "customers.read");
  const term = q?.trim();
  const where = term ? or(ilike(customers.name, `%${term}%`), ilike(customers.company, `%${term}%`), ilike(customers.phone, `%${term}%`), ilike(customers.email, `%${term}%`), ilike(customers.number, `%${term}%`)) : undefined;
  return db.select().from(customers).where(where).orderBy(desc(customers.createdAt)).limit(300);
}

/** Everything about one customer, limited to what the viewer may read. */
export async function getCustomer(db: DB, actor: Actor, id: string) {
  authorize(actor, "customers.read");
  const [c] = await db.select().from(customers).where(eq(customers.id, id));
  if (!c) throw notFound("Customer not found.");
  const [enq, qs, os, js, invs] = await Promise.all([
    can(actor, "enquiries.read") ? db.select().from(enquiries).where(eq(enquiries.customerId, id)).orderBy(desc(enquiries.createdAt)).limit(30) : null,
    can(actor, "quotes.read") ? db.select().from(quotes).where(eq(quotes.customerId, id)).orderBy(desc(quotes.createdAt)).limit(30) : null,
    can(actor, "orders.read") ? db.select().from(orders).where(eq(orders.customerId, id)).orderBy(desc(orders.createdAt)).limit(30) : null,
    can(actor, "jobs.read") ? db.select().from(serviceJobs).where(eq(serviceJobs.customerId, id)).orderBy(desc(serviceJobs.createdAt)).limit(30) : null,
    can(actor, "finance.read") ? db.select().from(invoices).where(eq(invoices.customerId, id)).orderBy(desc(invoices.issuedAt)).limit(30) : null,
  ]);
  return { customer: c, enquiries: enq, quotes: qs, orders: os, jobs: js, invoices: invs };
}
