import { asc, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import { categories, customers, enquiries, invoices, orders, payments, products, productVariants, quotes, serviceJobs, stockLevels } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import type { Permission } from "../authz/permissions";
import { invalid } from "../lib/errors";
import { serviceTitle } from "@/content/services";
import { audit } from "./audit";

/**
 * One CSV cell. Values a spreadsheet would treat as a formula (= + - @, tab, CR) are prefixed with an apostrophe,
 * so an exported file can never run a formula when opened in Excel (CSV injection).
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]) {
  // BOM so Excel opens UTF-8 (e.g. "₵") correctly.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const EXPORTS: Record<string, { label: string; perm: Permission }> = {
  orders: { label: "Orders", perm: "orders.read" },
  invoices: { label: "Invoices", perm: "finance.read" },
  payments: { label: "Payments received", perm: "finance.read" },
  products: { label: "Products, prices and stock", perm: "catalogue.read" },
  customers: { label: "Customers", perm: "customers.read" },
  enquiries: { label: "Enquiries", perm: "enquiries.read" },
  quotes: { label: "Quotations", perm: "quotes.read" },
  jobs: { label: "Service jobs", perm: "jobs.read" },
};

const money = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : (minor / 100).toFixed(2));

/** Needs data.export plus read access to the data itself. Every export is audited. */
export async function exportCsv(db: DB, actor: Actor, kind: string) {
  const def = EXPORTS[kind];
  if (!def) throw invalid("Unknown export.");
  authorize(actor, "data.export");
  authorize(actor, def.perm);
  let header: string[];
  let rows: unknown[][];
  switch (kind) {
    case "orders": {
      const r = await db.select().from(orders).orderBy(desc(orders.createdAt));
      header = ["number", "created_at", "source", "status", "payment_status", "contact", "phone", "fulfilment", "subtotal", "tax", "total", "ses_order"];
      rows = r.map((o) => [o.number, o.createdAt, o.source, o.status, o.paymentStatus, o.contactName, o.contactPhone, o.fulfilmentMethod, money(o.subtotalMinor), money(o.taxMinor), money(o.totalMinor), o.sesOrderNumber]);
      break;
    }
    case "invoices": {
      const r = await db.select().from(invoices).orderBy(desc(invoices.issuedAt));
      header = ["number", "issued_at", "due_at", "bill_to", "status", "subtotal", "tax", "total", "paid", "balance"];
      rows = r.map((i) => [i.number, i.issuedAt, i.dueAt, i.billToName, i.status, money(i.subtotalMinor), money(i.taxMinor), money(i.totalMinor), money(i.paidMinor), money(i.status === "void" ? 0 : i.totalMinor - i.paidMinor)]);
      break;
    }
    case "payments": {
      const r = await db.select({ p: payments, invoice: invoices.number }).from(payments).innerJoin(invoices, eq(invoices.id, payments.invoiceId)).where(inArray(payments.status, ["success", "reversed"])).orderBy(desc(payments.paidAt));
      header = ["paid_at", "invoice", "status", "provider", "method", "amount", "reference", "external_reference", "mode"];
      rows = r.map(({ p, invoice }) => [p.paidAt, invoice, p.status, p.provider, p.method, money(p.amountMinor), p.reference, p.externalReference, p.mode]);
      break;
    }
    case "products": {
      const r = await db
        .select({ v: productVariants, p: products, category: categories.name })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .orderBy(asc(products.name), asc(productVariants.sku));
      const levels = await db.select().from(stockLevels);
      header = ["sku", "product", "option", "category", "status", "price", "cost", "taxable", "tracks_stock", "on_hand", "reserved", "offered_to_ses"];
      rows = r.map(({ v, p, category }) => {
        const l = levels.filter((x) => x.variantId === v.id);
        return [v.sku, p.name, v.name, category, p.status, money(v.priceMinor), money(v.costMinor), v.taxable ? "yes" : "no", v.tracksStock ? "yes" : "no", l.reduce((a, x) => a + x.onHand, 0), l.reduce((a, x) => a + x.reserved, 0), p.sesSync ? "yes" : "no"];
      });
      break;
    }
    case "customers": {
      const r = await db.select().from(customers).orderBy(asc(customers.name));
      header = ["number", "name", "company", "phone", "email", "address", "created_at"];
      rows = r.map((c) => [c.number, c.name, c.company, c.phone, c.email, c.address, c.createdAt]);
      break;
    }
    case "enquiries": {
      const r = await db.select().from(enquiries).orderBy(desc(enquiries.createdAt));
      header = ["number", "created_at", "service", "status", "name", "company", "phone", "email", "message"];
      rows = r.map((e) => [e.number, e.createdAt, serviceTitle(e.serviceLine), e.status, e.name, e.company, e.phone, e.email, e.message]);
      break;
    }
    case "quotes": {
      const r = await db.select({ q: quotes, customer: customers.name }).from(quotes).innerJoin(customers, eq(customers.id, quotes.customerId)).orderBy(desc(quotes.createdAt));
      header = ["number", "created_at", "customer", "service", "status", "subtotal", "discount", "tax", "total", "valid_until"];
      rows = r.map(({ q, customer }) => [q.number, q.createdAt, customer, serviceTitle(q.serviceLine), q.status, money(q.subtotalMinor), money(q.discountMinor), money(q.taxMinor), money(q.totalMinor), q.validUntil]);
      break;
    }
    default: {
      const r = await db.select({ j: serviceJobs, customer: customers.name }).from(serviceJobs).innerJoin(customers, eq(customers.id, serviceJobs.customerId)).orderBy(desc(serviceJobs.createdAt));
      header = ["number", "created_at", "customer", "service", "title", "status", "scheduled_at", "location", "completed_at"];
      rows = r.map(({ j, customer }) => [j.number, j.createdAt, customer, serviceTitle(j.serviceLine), j.title, j.status, j.scheduledAt, j.location, j.completedAt]);
    }
  }
  await audit(db, { actor, action: "data.exported", targetType: "export", targetId: kind, data: { rows: rows.length } });
  return { filename: `kingsview-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv(header, rows) };
}
