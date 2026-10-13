import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { currencies, organizations, sequences, settings, taxRates } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { invalid } from "../lib/errors";
import { audit } from "./audit";

export const settingsSchema = z.object({
  companyName: z.string().min(2).max(120),
  defaultCurrency: z.string().length(3),
  locale: z.string().min(2).max(20),
  timezone: z.string().min(3).max(60),
  quoteValidityDays: z.number().int().min(1).max(365),
  /** Stock is held this long for shop orders and accepted quotations awaiting confirmation. */
  reservationHoldHours: z.number().int().min(1).max(24 * 30),
  /** Days from issue until an invoice is due. */
  invoiceDueDays: z.number().int().min(0).max(120),
  /** Online shop orders at or above this total are refused; customers ask for a quotation instead. */
  shopOrderLimitMinor: z.number().int().min(0),
  /** Shown at checkout for delivery orders (fees and areas). */
  deliveryNote: z.string().trim().max(500),
  /** Printed on invoices and shown on the website. */
  companyAddress: z.string().trim().max(300),
  /** Ghana Revenue Authority taxpayer identification number (TIN), printed on invoices once set. */
  companyTin: z.string().trim().max(40),
  /** Mobile money and bank details, printed on invoices and shown after checkout (see paymentDetails). */
  momoNumber: z.string().trim().max(40),
  momoName: z.string().trim().max(120),
  bankName: z.string().trim().max(120),
  bankAccountName: z.string().trim().max(120),
  bankAccountNumber: z.string().trim().max(40),
  bankBranch: z.string().trim().max(120),
  /** Any other payment notes, shown after the mobile money and bank details. */
  paymentInstructions: z.string().trim().max(1000),
  contactEmail: z.string().email(),
  contactPhone: z.string().trim().max(40),
  contactPhoneAlt: z.string().trim().max(40),
  whatsappNumber: z.string().max(40),
  openingHours: z.string().trim().max(200),
  instagramUrl: z.union([z.literal(""), z.string().url().max(200)]),
  facebookUrl: z.union([z.literal(""), z.string().url().max(200)]),
  /** Monday e-mail summary of the past week to staff who can read reports. */
  weeklyReport: z.boolean(),
  /** Data Protection Commission (Ghana) registration — shown publicly once set. */
  dpcRegistrationNumber: z.string().trim().max(60),
  /** ISO date (YYYY-MM-DD) the DPC certificate expires, or "". */
  dpcRegistrationExpires: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")]),
});
export type CompanySettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: CompanySettings = {
  companyName: "KingsView Solutions",
  defaultCurrency: "GHS",
  locale: "en-GH",
  timezone: "Africa/Accra",
  quoteValidityDays: 14,
  reservationHoldHours: 48,
  invoiceDueDays: 7,
  shopOrderLimitMinor: 2_000_000, // GHS 20,000.00
  deliveryNote: "Delivery fees depend on your location; we will confirm the fee before dispatch.",
  companyAddress: "House No. A31/3585, Adam House, Accra",
  companyTin: "P0010441387",
  momoNumber: "0552225441",
  momoName: "",
  bankName: "Absa Bank",
  bankAccountName: "KingsView Solutions",
  bankAccountNumber: "0341071744",
  bankBranch: "Ring Road Central Branch",
  paymentInstructions: "",
  contactEmail: "info@kingsviewsolutions.com",
  contactPhone: "0552225441",
  contactPhoneAlt: "0245636889",
  whatsappNumber: "",
  openingHours: "",
  instagramUrl: "https://www.instagram.com/kinxview/",
  facebookUrl: "https://www.facebook.com/kinxview/",
  weeklyReport: true,
  dpcRegistrationNumber: "",
  dpcRegistrationExpires: "",
};

export async function operatorOrgId(db: DB): Promise<string> {
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.type, "operator")).limit(1);
  if (!org) throw new Error("Operator organisation missing — run `npm run db:seed`.");
  return org.id;
}

export async function getSettings(db: DB, orgId?: string): Promise<CompanySettings> {
  const id = orgId ?? (await operatorOrgId(db));
  const rows = await db.select().from(settings).where(eq(settings.organizationId, id));
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return settingsSchema.parse({ ...DEFAULT_SETTINGS, ...stored });
}

export async function updateSettings(db: DB, actor: Actor, patch: Partial<CompanySettings>) {
  authorize(actor, "settings.manage");
  const orgId = await operatorOrgId(db);
  const current = await getSettings(db, orgId);
  const next = settingsSchema.parse({ ...current, ...patch });
  const [cur] = await db.select().from(currencies).where(eq(currencies.code, next.defaultCurrency));
  if (!cur?.active) throw invalid("Default currency must be an active currency.");
  const changed = Object.keys(patch).filter((k) => JSON.stringify(current[k as keyof CompanySettings]) !== JSON.stringify(next[k as keyof CompanySettings]));
  await db.transaction(async (tx) => {
    for (const key of changed) {
      const value = next[key as keyof CompanySettings];
      await tx
        .insert(settings)
        .values({ organizationId: orgId, key, value, updatedBy: actor.userId })
        .onConflictDoUpdate({ target: [settings.organizationId, settings.key], set: { value, updatedBy: actor.userId } });
    }
    await audit(tx, {
      actor,
      action: "settings.updated",
      targetType: "settings",
      targetId: orgId,
      data: Object.fromEntries(changed.map((k) => [k, { from: current[k as keyof CompanySettings], to: next[k as keyof CompanySettings] }])),
    });
  });
  return next;
}

export async function listCurrencies(db: DB) {
  return db.select().from(currencies).orderBy(asc(currencies.code));
}

export async function activeTaxes(db: DB, orgId?: string) {
  const id = orgId ?? (await operatorOrgId(db));
  return db
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.organizationId, id), eq(taxRates.active, true)))
    .orderBy(asc(taxRates.sortOrder));
}

export async function listTaxes(db: DB) {
  return db.select().from(taxRates).where(eq(taxRates.organizationId, await operatorOrgId(db))).orderBy(asc(taxRates.sortOrder));
}

export const taxInput = z.object({
  code: z.string().regex(/^[A-Z0-9_]{2,20}$/, "Use 2–20 capital letters, digits or underscores."),
  name: z.string().min(2).max(80),
  rateBp: z.number().int().min(0).max(10_000),
  compound: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(100),
});

export async function upsertTax(db: DB, actor: Actor, id: string | null, input: z.infer<typeof taxInput>) {
  authorize(actor, "settings.manage");
  const data = taxInput.parse(input);
  const orgId = await operatorOrgId(db);
  if (id) {
    const [before] = await db.select().from(taxRates).where(and(eq(taxRates.id, id), eq(taxRates.organizationId, orgId)));
    if (!before) throw invalid("Unknown tax rate.");
    await db.update(taxRates).set({ ...data, isDemo: false }).where(eq(taxRates.id, id));
    await audit(db, { actor, action: "tax.updated", targetType: "tax_rate", targetId: id, data: { before, after: data } });
  } else {
    const [row] = await db.insert(taxRates).values({ ...data, organizationId: orgId }).returning();
    await audit(db, { actor, action: "tax.created", targetType: "tax_rate", targetId: row!.id, data });
  }
}

/** The company's phone numbers, main first. */
export function phoneNumbers(s: Pick<CompanySettings, "contactPhone" | "contactPhoneAlt">) {
  return [s.contactPhone, s.contactPhoneAlt].filter(Boolean);
}

/** Mobile money and bank details as display lines; empty when none are set. */
export function paymentDetails(s: CompanySettings): string[] {
  const lines: string[] = [];
  if (s.momoNumber) lines.push(`Mobile money: ${s.momoNumber}${s.momoName ? ` (${s.momoName})` : ""}`);
  if (s.bankAccountNumber) {
    const bank = [s.bankName, s.bankBranch].filter(Boolean).join(", ");
    lines.push(`Bank transfer: ${bank ? `${bank} — ` : ""}account ${s.bankAccountNumber}${s.bankAccountName ? ` (${s.bankAccountName})` : ""}`);
  }
  if (s.paymentInstructions) lines.push(s.paymentInstructions);
  return lines;
}

/** Registration status for reminders: missing, expiring within 60 days, or valid. */
export function dpcStatus(s: Pick<CompanySettings, "dpcRegistrationNumber" | "dpcRegistrationExpires">, now = new Date()) {
  if (!s.dpcRegistrationNumber) return { state: "missing" as const, daysLeft: null };
  if (!s.dpcRegistrationExpires) return { state: "valid" as const, daysLeft: null };
  const daysLeft = Math.floor((new Date(s.dpcRegistrationExpires + "T23:59:59Z").getTime() - now.getTime()) / 86_400_000);
  return { state: daysLeft < 0 ? ("expired" as const) : daysLeft <= 60 ? ("expiring" as const) : ("valid" as const), daysLeft };
}

/** Gap-free, human-friendly numbers such as Q-2026-00042. Runs inside the caller's transaction. */
export async function nextNumber(db: DB, prefix: string, now = new Date()) {
  const key = `${prefix}-${now.getUTCFullYear()}`;
  const [row] = await db
    .insert(sequences)
    .values({ key, value: 1 })
    .onConflictDoUpdate({ target: sequences.key, set: { value: sql`${sequences.value} + 1` } })
    .returning();
  return `${key}-${String(row!.value).padStart(5, "0")}`;
}
