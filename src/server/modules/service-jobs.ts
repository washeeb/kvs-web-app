import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { customers, organizations, serviceJobs, users } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, invalid, notFound } from "../lib/errors";
import { SERVICE_LINES } from "@/content/services";
import { audit } from "./audit";
import { publish } from "./events";
import { sendMail } from "./mail";
import { announce, notifyUsers, usersWithPermission } from "./notifications";
import { getSettings, nextNumber, phoneNumbers } from "./settings";

/** Bookings for work: CCTV installations, shoots, training sessions, design and development work. */
const SLUGS = SERVICE_LINES.map((s) => s.slug) as [string, ...string[]];
export const JOB_STATUSES = ["requested", "scheduled", "in_progress", "completed", "cancelled"] as const;
const OPEN = ["requested", "scheduled", "in_progress"];

export const jobInput = z.object({
  customerId: z.string().uuid("Choose a customer."),
  serviceLine: z.enum(SLUGS),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).optional().default(""),
  location: z.string().trim().max(300).optional().default(""),
  scheduledAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)]).optional().default(""),
  assigneeUserId: z.union([z.literal(""), z.string().uuid()]).optional().default(""),
});

/** Date-time inputs are entered in Accra time (UTC, no daylight saving). */
const toDate = (v: string) => (v ? new Date(`${v}:00Z`) : null);

async function checkAssignee(db: DB, userId: string) {
  const ids = await usersWithPermission(db, "jobs.write");
  const [u] = await db.select({ id: users.id }).from(users).innerJoin(organizations, eq(organizations.id, users.organizationId)).where(and(eq(users.id, userId), eq(users.status, "active"), eq(organizations.type, "operator")));
  if (!u || !ids.includes(userId)) throw invalid("Assign the job to an active staff member who handles jobs.");
}

export async function createJob(db: DB, actor: Actor, input: z.input<typeof jobInput>) {
  authorize(actor, "jobs.write");
  const data = jobInput.parse(input);
  const [c] = await db.select().from(customers).where(eq(customers.id, data.customerId));
  if (!c) throw invalid("Unknown customer.");
  if (data.assigneeUserId) await checkAssignee(db, data.assigneeUserId);
  const scheduledAt = toDate(data.scheduledAt);
  const j = await db.transaction(async (tx) => {
    const [j] = await tx
      .insert(serviceJobs)
      .values({
        number: await nextNumber(tx, "J"),
        customerId: c.id,
        serviceLine: data.serviceLine,
        title: data.title,
        description: data.description || null,
        location: data.location || null,
        scheduledAt,
        status: scheduledAt ? "scheduled" : "requested",
        assigneeUserId: data.assigneeUserId || null,
        createdBy: actor.userId,
      })
      .returning();
    await audit(tx, { actor, action: "job.created", targetType: "job", targetId: j!.id, data: { number: j!.number } });
    if (data.assigneeUserId && data.assigneeUserId !== actor.userId) await notifyUsers(tx, [data.assigneeUserId], { title: `Job ${j!.number} assigned to you`, body: data.title, link: `/admin/jobs/${j!.id}` });
    return j!;
  });
  publish({ topic: "jobs" });
  announce();
  return j;
}

/** Schedules or re-schedules; tells the assignee and (if they have e-mail) the customer. */
export async function scheduleJob(db: DB, actor: Actor, id: string, input: { scheduledAt: string; location: string; assigneeUserId: string }) {
  authorize(actor, "jobs.write");
  const data = jobInput.pick({ scheduledAt: true, location: true, assigneeUserId: true }).parse(input);
  const when = toDate(data.scheduledAt);
  if (!when) throw invalid("Choose the date and time.");
  if (data.assigneeUserId) await checkAssignee(db, data.assigneeUserId);
  const s = await getSettings(db);
  await db.transaction(async (tx) => {
    const [j] = await tx.select().from(serviceJobs).where(eq(serviceJobs.id, id)).for("update");
    if (!j) throw notFound("Job not found.");
    if (!["requested", "scheduled"].includes(j.status)) throw conflict(`This job is ${j.status.replace("_", " ")}.`);
    await tx.update(serviceJobs).set({ scheduledAt: when, location: data.location || j.location, assigneeUserId: data.assigneeUserId || j.assigneeUserId, status: "scheduled" }).where(eq(serviceJobs.id, id));
    await audit(tx, { actor, action: "job.scheduled", targetType: "job", targetId: id, data: { scheduledAt: when.toISOString(), assigneeUserId: data.assigneeUserId || j.assigneeUserId } });
    const assignee = data.assigneeUserId || j.assigneeUserId;
    if (assignee && assignee !== actor.userId) await notifyUsers(tx, [assignee], { title: `Job ${j.number} scheduled`, body: `${j.title} — ${when.toISOString().slice(0, 16).replace("T", " ")}`, link: `/admin/jobs/${id}` });
    const [c] = await tx.select().from(customers).where(eq(customers.id, j.customerId));
    if (c?.email) {
      await sendMail(tx, {
        to: c.email,
        subject: `Booking confirmed: ${j.title} — ${s.companyName}`,
        body: [`Hello ${c.name},`, "", `Your booking (${j.number}) is scheduled for ${when.toISOString().slice(0, 16).replace("T", " ")} (Accra time)${data.location || j.location ? ` at ${data.location || j.location}` : ""}.`, "", "Call us if you need to change it.", s.companyName, phoneNumbers(s).join(" / ")].join("\n"),
      });
    }
  });
  publish({ topic: "jobs" });
  announce();
}

export async function setJobStatus(db: DB, actor: Actor, id: string, status: string, note = "") {
  authorize(actor, "jobs.write");
  const next = z.enum(JOB_STATUSES).parse(status);
  await db.transaction(async (tx) => {
    const [j] = await tx.select().from(serviceJobs).where(eq(serviceJobs.id, id)).for("update");
    if (!j) throw notFound("Job not found.");
    if (!OPEN.includes(j.status)) throw conflict(`This job is already ${j.status}.`);
    if (next === "completed" && note.trim().length < 3) throw invalid("Describe what was done.");
    if (next === "cancelled" && note.trim().length < 3) throw invalid("Give a reason for cancelling.");
    await tx
      .update(serviceJobs)
      .set({ status: next, completedAt: next === "completed" ? new Date() : null, completionNote: ["completed", "cancelled"].includes(next) ? note.trim() : j.completionNote })
      .where(eq(serviceJobs.id, id));
    await audit(tx, { actor, action: "job.status_changed", targetType: "job", targetId: id, data: { from: j.status, to: next, note: note.trim() || undefined } });
  });
  publish({ topic: "jobs" });
}

export async function listJobs(db: DB, actor: Actor, filter: "open" | "mine" | "done" | "all" = "open") {
  authorize(actor, "jobs.read");
  const where =
    filter === "open" ? inArray(serviceJobs.status, OPEN)
    : filter === "mine" ? and(inArray(serviceJobs.status, OPEN), eq(serviceJobs.assigneeUserId, actor.userId))
    : filter === "done" ? inArray(serviceJobs.status, ["completed", "cancelled"])
    : undefined;
  return db
    .select({ j: serviceJobs, customerName: customers.name, assigneeName: users.name })
    .from(serviceJobs)
    .innerJoin(customers, eq(customers.id, serviceJobs.customerId))
    .leftJoin(users, eq(users.id, serviceJobs.assigneeUserId))
    .where(where)
    .orderBy(asc(serviceJobs.scheduledAt), desc(serviceJobs.createdAt))
    .limit(300);
}

export async function getJob(db: DB, actor: Actor, id: string) {
  authorize(actor, "jobs.read");
  const [row] = await db
    .select({ j: serviceJobs, customer: customers, assigneeName: users.name })
    .from(serviceJobs)
    .innerJoin(customers, eq(customers.id, serviceJobs.customerId))
    .leftJoin(users, eq(users.id, serviceJobs.assigneeUserId))
    .where(eq(serviceJobs.id, id));
  if (!row) throw notFound("Job not found.");
  return row;
}

export async function jobStaff(db: DB) {
  const ids = await usersWithPermission(db, "jobs.write");
  return ids.length ? db.select({ id: users.id, name: users.name }).from(users).where(and(inArray(users.id, ids), eq(users.status, "active"))).orderBy(asc(users.name)) : [];
}
