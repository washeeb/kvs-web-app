export type Domain = "operator" | "partner" | "customer";

interface PermissionDef {
  domain: Domain;
  label: string;
  /** Holding any privileged permission makes two-step verification mandatory for the user. */
  privileged?: boolean;
}

const op = (label: string, privileged = false): PermissionDef => ({ domain: "operator", label, privileged });

/** KingsView staff permissions. Customers do not sign in (shop orders use a private tracking link). */
export const PERMISSIONS = {
  // Administration
  "users.read": op("View staff accounts"),
  "users.manage": op("Create and disable staff accounts", true),
  "permissions.manage": op("Assign roles", true),
  "settings.manage": op("Change company settings, taxes and payment details", true),
  "audit.read": op("Read the audit log"),
  "approvals.read": op("View approval requests"),
  // Sales & customers
  "enquiries.read": op("View enquiries"),
  "enquiries.write": op("Handle enquiries"),
  "customers.read": op("View customers"),
  "customers.write": op("Create and edit customers"),
  "quotes.read": op("View quotations"),
  "quotes.write": op("Create and send quotations"),
  "orders.read": op("View orders"),
  "orders.write": op("Confirm, prepare, complete and cancel orders"),
  // Catalogue & stock
  "catalogue.read": op("View products"),
  "catalogue.write": op("Create and edit products and prices"),
  "inventory.read": op("View stock"),
  "inventory.adjust": op("Adjust stock levels"),
  // Service jobs
  "jobs.read": op("View service jobs"),
  "jobs.write": op("Schedule, assign and complete service jobs"),
  // Finance
  "finance.read": op("View invoices and payments"),
  "finance.write": op("Record payments, reverse and void", true),
  // Insight
  "reports.read": op("View the dashboard figures and reports"),
  "data.export": op("Export data to CSV"),
  // Synclytics link
  "integrations.read": op("View the Synclytics link status"),
  "integrations.manage": op("Resend and replay Synclytics events", true),
} as const satisfies Record<string, PermissionDef>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const isPermission = (p: string): p is Permission => p in PERMISSIONS;

export const permissionDef = (p: Permission): PermissionDef => PERMISSIONS[p];

export const permissionsForDomain = (d: Domain) => ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].domain === d);
