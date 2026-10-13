import { permissionsForDomain, type Domain, type Permission } from "./permissions";

export interface RoleTemplate {
  key: string;
  name: string;
  domain: Domain;
  description: string;
  permissions: Permission[];
}

const READ_SALES: Permission[] = ["enquiries.read", "customers.read", "quotes.read", "orders.read", "catalogue.read", "inventory.read", "jobs.read"];

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "owner",
    name: "Owner / Administrator",
    domain: "operator",
    description: "Full access. Keep to the owner and at most one deputy.",
    permissions: permissionsForDomain("operator"),
  },
  {
    key: "manager",
    name: "Manager",
    domain: "operator",
    description: "Runs day-to-day operations across sales, shop, stock and jobs; sees finance and reports but cannot record payments.",
    permissions: [
      ...READ_SALES, "enquiries.write", "customers.write", "quotes.write", "orders.write", "catalogue.write", "inventory.adjust", "jobs.write", "purchasing.read", "purchasing.write",
      "finance.read", "reports.read", "data.export", "users.read", "approvals.read", "audit.read", "integrations.read",
    ],
  },
  {
    key: "sales",
    name: "Sales & front desk",
    domain: "operator",
    description: "Enquiries, customers, quotations, shop orders and booking jobs.",
    permissions: [...READ_SALES, "enquiries.write", "customers.write", "quotes.write", "orders.write", "jobs.write"],
  },
  {
    key: "store",
    name: "Store & stock",
    domain: "operator",
    description: "Products, prices, stock, suppliers and purchase orders, and preparing orders for pickup or delivery.",
    permissions: ["catalogue.read", "catalogue.write", "inventory.read", "inventory.adjust", "purchasing.read", "purchasing.write", "orders.read", "orders.write", "integrations.read"],
  },
  {
    key: "technician",
    name: "Technician / field staff",
    domain: "operator",
    description: "Service jobs (installations, shoots, training) and the customers they are for.",
    permissions: ["jobs.read", "jobs.write", "customers.read", "catalogue.read", "inventory.read"],
  },
  {
    key: "accounts",
    name: "Accounts",
    domain: "operator",
    description: "Invoices and payments, with read access to the sales records behind them.",
    permissions: [...READ_SALES, "finance.read", "finance.write", "purchasing.read", "reports.read", "data.export"],
  },
  {
    key: "auditor",
    name: "Read-only auditor",
    domain: "operator",
    description: "Reads everything including the audit log; cannot change anything.",
    permissions: [...READ_SALES, "finance.read", "purchasing.read", "reports.read", "audit.read", "users.read", "approvals.read", "integrations.read", "data.export"],
  },
];
