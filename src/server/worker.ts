import { eq } from "drizzle-orm";
import type { DB } from "./db/client";
import { sesOutbox } from "./db/schema";
import { log } from "./lib/log";
import { enqueue, runDueJobs, type JobHandlers } from "./modules/jobs";
import { runMaintenance } from "./modules/maintenance";
import { checkLowStock, expireReservations } from "./modules/inventory";
import { deliverMail } from "./modules/mail";
import { verifyAndApplyPayment } from "./modules/payments/paystack";
import { deliverSesEvent } from "./modules/ses-link";
import { sendWeeklyDigest } from "./modules/analytics";
import { notifyPermission } from "./modules/notifications";

export const JOB_HANDLERS: JobHandlers = {
  "mail.send": (db, payload) => deliverMail(db, payload),
  "reports.weekly": async (db) => {
    await sendWeeklyDigest(db);
  },
  "maintenance.hourly": async (db) => {
    await runMaintenance(db);
    await checkLowStock(db);
  },
  "payment.paystack.verify": async (db, payload) => {
    await verifyAndApplyPayment(db, String(payload.reference));
  },
  "ses.deliver": async (db, payload) => {
    await deliverSesEvent(db, payload);
  },
};

export async function tick(db: DB) {
  // At most one clean-up per hour, whichever process or cron call gets there first.
  await enqueue(db, { type: "maintenance.hourly", dedupeKey: `maintenance:${new Date().toISOString().slice(0, 13)}`, maxAttempts: 3 });
  // Weekly summary e-mail: Mondays from 07:00 (Accra = UTC), once per week.
  const now = new Date();
  if (now.getUTCDay() === 1 && now.getUTCHours() >= 7) await enqueue(db, { type: "reports.weekly", dedupeKey: `reports:weekly:${now.toISOString().slice(0, 10)}`, maxAttempts: 3 });
  const result = await runDueJobs(db, JOB_HANDLERS, {
    onDead: async (db, job, error) => {
      if (job.type === "ses.deliver") {
        await db.update(sesOutbox).set({ status: "dead", lastError: error.slice(0, 300) }).where(eq(sesOutbox.id, String((job.payload as Record<string, unknown>).id)));
        await notifyPermission(db, "integrations.manage", { title: "A Synclytics update could not be delivered", body: error.slice(0, 200), link: "/admin/ses" });
      }
    },
  });
  const expired = await expireReservations(db);
  return { ...result, expired };
}

const g = globalThis as unknown as { __kvsWorker?: NodeJS.Timeout };

/** Polls the job table. One worker per database when using PGlite (single-process). */
export function startWorker(db: DB, intervalMs = 2000) {
  if (g.__kvsWorker) return;
  let running = false;
  g.__kvsWorker = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await tick(db);
      if (r.done || r.retried || r.dead || r.expired) log.info("worker.tick", r);
    } catch (err) {
      log.error("worker.tick_failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  }, intervalMs);
  log.info("worker.started", { intervalMs });
}
