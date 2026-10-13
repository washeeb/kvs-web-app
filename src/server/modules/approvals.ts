import { desc, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { approvalRequests, users } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, forbidden, notFound } from "../lib/errors";
import { audit } from "./audit";
import { publish } from "./events";
import { applyAssignment } from "./admin";
import { APPROVAL_TYPES } from "./approval-types";
import { announce, notifyUsers } from "./notifications";

export { APPROVAL_TYPES };

/** Second-person approvals. In KVS these cover privileged role grants (e.g. Accounts, Owner). */
export async function listApprovals(db: DB, actor: Actor, status: "pending" | "all" = "pending") {
  authorize(actor, "approvals.read");
  const q = db
    .select({ a: approvalRequests, requesterName: users.name })
    .from(approvalRequests)
    .leftJoin(users, eq(users.id, approvalRequests.requestedBy))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(200);
  return status === "pending" ? q.where(eq(approvalRequests.status, "pending")) : q;
}

export async function decideApproval(db: DB, actor: Actor, id: string, approve: boolean, note: string) {
  await db.transaction(async (tx) => {
    const [req] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id)).for("update");
    if (!req) throw notFound("Approval request not found.");
    const type = APPROVAL_TYPES[req.type];
    if (!type) throw conflict(`Unknown approval type ${req.type}.`);
    authorize(actor, type.permission);
    if (req.status !== "pending") throw conflict("This request has already been decided.");
    if (req.requestedBy === actor.userId) throw forbidden("You cannot approve or reject your own request.");
    const payload = req.payload as Record<string, unknown>;
    if (approve && req.type === "permission.change") {
      if (payload.userId === actor.userId) throw forbidden("You cannot approve changes to your own access.");
      await applyAssignment(tx, {
        userId: String(payload.userId),
        permissionSetId: String(payload.permissionSetId),
        departmentId: (payload.departmentId as string | null) ?? null,
        grantedBy: actor.userId,
      });
    }
    if (req.requestedBy) {
      await notifyUsers(tx, [req.requestedBy], { title: `${type.label} ${approve ? "approved" : "rejected"}`, body: req.summary + (note.trim() ? ` — “${note.trim()}”` : ""), link: "/admin/approvals" });
    }
    await tx
      .update(approvalRequests)
      .set({ status: approve ? "approved" : "rejected", decidedBy: actor.userId, decidedAt: new Date(), decisionNote: note.trim() || null })
      .where(eq(approvalRequests.id, id));
    await audit(tx, { actor, action: `approval.${approve ? "approved" : "rejected"}`, targetType: req.subjectType, targetId: req.subjectId, data: { approvalId: id, type: req.type, note } });
  });
  publish({ topic: "approvals" });
  announce();
}
