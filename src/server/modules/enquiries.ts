import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { enquiries, users } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { invalid, notFound } from "../lib/errors";
import { enforce } from "../auth/rate-limit";
import { SERVICE_LINES } from "@/content/services";
import { audit } from "./audit";
import { publish } from "./events";
import { findOrCreateCustomer } from "./customers";
import { announce, notifyPermission, notifyUsers } from "./notifications";
import { nextNumber } from "./settings";

const SLUGS = SERVICE_LINES.map((s) => s.slug) as [string, ...string[]];
export const ENQUIRY_STATUSES = ["new", "contacted", "quoted", "won", "lost"] as const;

export const enquiryInput = z
  .object({
    serviceLine: z.union([z.literal(""), z.enum(SLUGS)]).optional().default(""),
    name: z.string().trim().min(2, "Enter your name.").max(120),
    company: z.string().trim().max(160).optional().default(""),
    phone: z.string().trim().max(40).optional().default(""),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid e-mail address.").max(200)]).optional().default(""),
    message: z.string().trim().min(10, "Tell us a little more (at least 10 characters).").max(4000),
    /** Honeypot: real visitors never fill this in. */
    website: z.string().max(0).optional().default(""),
  })
  .refine((d) => d.phone || d.email, { message: "Enter a phone number or an e-mail address so we can reply.", path: ["phone"] });

/** Public website form. Rate-limited per IP; staff are notified. */
export async function submitEnquiry(db: DB, input: z.input<typeof enquiryInput>, ip: string | null) {
  const data = enquiryInput.parse(input);
  await enforce(db, `enquiry:ip:${ip ?? "unknown"}`, 6, 60 * 60);
  const e = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        number: await nextNumber(tx, "E"),
        serviceLine: data.serviceLine || null,
        name: data.name,
        company: data.company || null,
        phone: data.phone || null,
        email: data.email || null,
        message: data.message,
      })
      .returning();
    await audit(tx, { action: "enquiry.received", targetType: "enquiry", targetId: row!.id, ip, data: { serviceLine: data.serviceLine || null } });
    await notifyPermission(tx, "enquiries.write", { title: `New enquiry ${row!.number}`, body: `${data.name}${data.company ? ` (${data.company})` : ""}`, link: `/admin/enquiries/${row!.id}` });
    return row!;
  });
  publish({ topic: "leads" });
  announce();
  return { number: e.number };
}

export async function listEnquiries(db: DB, actor: Actor, status?: string) {
  authorize(actor, "enquiries.read");
  const where = status === "open" ? inArray(enquiries.status, ["new", "contacted", "quoted"]) : status && (ENQUIRY_STATUSES as readonly string[]).includes(status) ? eq(enquiries.status, status) : undefined;
  return db
    .select({ e: enquiries, assigneeName: users.name })
    .from(enquiries)
    .leftJoin(users, eq(users.id, enquiries.assigneeUserId))
    .where(where)
    .orderBy(desc(enquiries.createdAt))
    .limit(300);
}

export async function getEnquiry(db: DB, actor: Actor, id: string) {
  authorize(actor, "enquiries.read");
  const [row] = await db.select({ e: enquiries, assigneeName: users.name }).from(enquiries).leftJoin(users, eq(users.id, enquiries.assigneeUserId)).where(eq(enquiries.id, id));
  if (!row) throw notFound("Enquiry not found.");
  return row;
}

export async function updateEnquiry(db: DB, actor: Actor, id: string, patch: { status?: string; assigneeUserId?: string | null }) {
  authorize(actor, "enquiries.write");
  const [e] = await db.select().from(enquiries).where(eq(enquiries.id, id));
  if (!e) throw notFound("Enquiry not found.");
  const set: Partial<typeof enquiries.$inferInsert> = {};
  if (patch.status !== undefined) set.status = z.enum(ENQUIRY_STATUSES).parse(patch.status);
  if (patch.assigneeUserId !== undefined) {
    if (patch.assigneeUserId) {
      const [u] = await db.select().from(users).where(and(eq(users.id, patch.assigneeUserId), eq(users.status, "active")));
      if (!u) throw invalid("Choose an active staff member.");
    }
    set.assigneeUserId = patch.assigneeUserId;
  }
  await db.update(enquiries).set(set).where(eq(enquiries.id, id));
  await audit(db, { actor, action: "enquiry.updated", targetType: "enquiry", targetId: id, data: set });
  if (set.assigneeUserId && set.assigneeUserId !== actor.userId) {
    await notifyUsers(db, [set.assigneeUserId], { title: `Enquiry ${e.number} assigned to you`, body: e.name, link: `/admin/enquiries/${id}` });
    announce();
  }
  publish({ topic: "leads" });
}

/** Links (or creates) the customer record behind an enquiry so quotations and jobs can be raised. */
export async function enquiryCustomer(db: DB, actor: Actor, id: string) {
  authorize(actor, "customers.write");
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(enquiries).where(eq(enquiries.id, id)).for("update");
    if (!e) throw notFound("Enquiry not found.");
    if (e.customerId) return e.customerId;
    const c = await findOrCreateCustomer(tx, { name: e.name, email: e.email, phone: e.phone, company: e.company });
    await tx.update(enquiries).set({ customerId: c.id, status: e.status === "new" ? "contacted" : e.status }).where(eq(enquiries.id, id));
    await audit(tx, { actor, action: "enquiry.customer_linked", targetType: "enquiry", targetId: id, data: { customerId: c.id } });
    return c.id;
  });
}
