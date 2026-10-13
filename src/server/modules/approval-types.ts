import type { Permission } from "../authz/permissions";

/** Approval request types, who may decide them, and where the subject is shown. */
export const APPROVAL_TYPES: Record<string, { label: string; permission: Permission; link?: (subjectId: string) => string }> = {
  "permission.change": { label: "Role change", permission: "permissions.manage", link: () => "/admin/users" },
};
