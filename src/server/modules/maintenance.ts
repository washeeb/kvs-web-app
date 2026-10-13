import { and, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import type { DB } from "../db/client";
import { jobs, mailOutbox, passwordResetTokens, rateLimits, sesOutbox, sessions } from "../db/schema";
import { log } from "../lib/log";

const DAY = 86_400_000;

/**
 * Retention clean-up, run hourly by the worker. Removes data that has no further use:
 * expired/revoked sessions (30 d), old rate-limit windows (1 d), used/expired reset tokens (7 d),
 * completed jobs (30 d, or 2 d for hourly housekeeping; dead jobs are kept for investigation), sent mail (90 d)
 * and Synclytics events delivered more than 90 days ago.
 */
export async function runMaintenance(db: DB, now = new Date()) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const counts: Record<string, number> = {};
  counts.sessions = (await db.delete(sessions).where(or(lt(sessions.expiresAt, ago(30)), lt(sessions.revokedAt, ago(30)))).returning({ id: sessions.id })).length;
  counts.rateLimits = (await db.delete(rateLimits).where(lt(rateLimits.windowStart, ago(1))).returning({ k: rateLimits.key })).length;
  counts.resetTokens = (await db.delete(passwordResetTokens).where(or(lt(passwordResetTokens.expiresAt, ago(7)), lt(passwordResetTokens.usedAt, ago(7)))).returning({ id: passwordResetTokens.id })).length;
  counts.jobs = (await db.delete(jobs).where(and(eq(jobs.status, "done"), lt(jobs.completedAt, ago(30)))).returning({ id: jobs.id })).length;
  counts.jobs += (await db.delete(jobs).where(and(eq(jobs.status, "done"), inArray(jobs.type, ["maintenance.hourly"]), lt(jobs.completedAt, ago(2)))).returning({ id: jobs.id })).length;
  counts.mail = (await db.delete(mailOutbox).where(and(isNotNull(mailOutbox.sentAt), lt(mailOutbox.sentAt, ago(90)))).returning({ id: mailOutbox.id })).length;
  counts.sesEvents = (await db.delete(sesOutbox).where(and(eq(sesOutbox.status, "sent"), lt(sesOutbox.sentAt, ago(90)))).returning({ id: sesOutbox.id })).length;
  if (Object.values(counts).some((n) => n > 0)) log.info("maintenance.done", counts);
  return counts;
}
