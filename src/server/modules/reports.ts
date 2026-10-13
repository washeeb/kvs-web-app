import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { approvalRequests, enquiries, orderLines, orders, productVariants, serviceJobs, sesOutbox, stockLevels } from "../db/schema";
import { can, type Actor } from "../authz/policy";
import { LOW_STOCK_AT } from "./inventory";
import { receivables } from "./invoices";

const count = sql<number>`count(*)::int`;
const DAY = 86_400_000;

/** Headline figures for the back-office dashboard; each one only for roles that may see it. */
export async function dashboard(db: DB, actor: Actor, now = new Date()) {
  const since30 = new Date(now.getTime() - 30 * DAY);
  const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const out = {
    newEnquiries: can(actor, "enquiries.read") ? await n(db.select({ n: count }).from(enquiries).where(eq(enquiries.status, "new"))) : null,
    ordersToConfirm: can(actor, "orders.read") ? await n(db.select({ n: count }).from(orders).where(eq(orders.status, "pending"))) : null,
    ordersInProgress: can(actor, "orders.read") ? await n(db.select({ n: count }).from(orders).where(inArray(orders.status, ["confirmed", "ready"]))) : null,
    salesLast30Minor: can(actor, "orders.read")
      ? Number((await db.select({ v: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::bigint` }).from(orders).where(and(gte(orders.createdAt, since30), inArray(orders.status, ["pending", "confirmed", "ready", "fulfilled"]))))[0]?.v ?? 0)
      : null,
    jobsThisWeek: can(actor, "jobs.read") ? await n(db.select({ n: count }).from(serviceJobs).where(and(eq(serviceJobs.status, "scheduled"), gte(serviceJobs.scheduledAt, now), lte(serviceJobs.scheduledAt, new Date(now.getTime() + 7 * DAY))))) : null,
    unscheduledJobs: can(actor, "jobs.read") ? await n(db.select({ n: count }).from(serviceJobs).where(eq(serviceJobs.status, "requested"))) : null,
    lowStock: can(actor, "inventory.read")
      ? await n(db.select({ n: sql<number>`count(distinct ${stockLevels.variantId})::int` }).from(stockLevels).innerJoin(productVariants, eq(productVariants.id, stockLevels.variantId)).where(and(eq(productVariants.active, true), lte(sql`${stockLevels.onHand} - ${stockLevels.reserved}`, LOW_STOCK_AT))))
      : null,
    pendingApprovals: can(actor, "approvals.read") ? await n(db.select({ n: count }).from(approvalRequests).where(eq(approvalRequests.status, "pending"))) : null,
    sesProblems: can(actor, "integrations.read") ? await n(db.select({ n: count }).from(sesOutbox).where(eq(sesOutbox.status, "dead"))) : null,
    money: await receivables(db, actor, now),
  };
  return out;
}

/** Best sellers in the last 30 days (by value). */
export async function topItems(db: DB, actor: Actor, now = new Date()) {
  if (!can(actor, "reports.read") || !can(actor, "orders.read")) return null;
  const since = new Date(now.getTime() - 30 * DAY);
  const rows = await db
    .select({ label: orderLines.description, value: sql<number>`sum(${orderLines.lineTotalMinor})::bigint` })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(gte(orders.createdAt, since), inArray(orders.status, ["pending", "confirmed", "ready", "fulfilled"])))
    .groupBy(orderLines.description)
    .orderBy(sql`sum(${orderLines.lineTotalMinor}) desc`)
    .limit(8);
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}
