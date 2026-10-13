import { and, asc, eq, gte, inArray, isNotNull, lt, ne, sql, type SQL } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  brands,
  categories,
  customers,
  enquiries,
  goodsReceipts,
  invoices,
  orderLines,
  orders,
  payments,
  products,
  productVariants,
  purchaseOrders,
  quotes,
  serviceJobs,
  stockLocations,
  stockMovements,
  suppliers,
  users,
} from "../db/schema";
import { authorize, can, type Actor } from "../authz/policy";
import { loadActor } from "../auth/service";
import { formatMoney } from "../lib/money";
import { sendMail } from "./mail";
import { usersWithPermission } from "./notifications";
import { getSettings } from "./settings";
import { serviceTitle } from "@/content/services";
import { reorderList, stockOverview } from "./inventory";
import { onOrderByVariant } from "./purchasing";

/**
 * Reporting. Figures follow simple, explainable rules:
 * - Sales = invoices issued in the period (void excluded), net of discount and before taxes.
 * - Cost of sales = the average cost recorded on each sale stock movement (stock items only; services have none).
 * - Gross margin = net sales of stock items − their cost of sales.
 * Dates are UTC, which is Accra time.
 */

const DAY = 86_400_000;

export type Range = { from: Date; to: Date; prevFrom: Date; prevTo: Date; label: string; days: number };

export const PRESETS: Record<string, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  mtd: "This month",
  lm: "Last month",
  qtd: "This quarter",
  ytd: "This year",
  "12m": "Last 12 months",
};

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Period from ?range= (preset) or, with no preset, ?from=&to= (YYYY-MM-DD, inclusive); plus the previous period of equal length. */
export function parseRange(sp: { range?: string; from?: string; to?: string }, now = new Date()): Range {
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + DAY);
  let from: Date;
  let to = tomorrow;
  let label: string;
  const d = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null);
  const cf = d(sp.from);
  const ct = d(sp.to);
  // A chosen preset wins; custom dates apply when the period is set to "Custom".
  if (!(sp.range && PRESETS[sp.range]) && cf && ct && cf <= ct) {
    from = cf;
    to = new Date(ct.getTime() + DAY);
    label = `${sp.from} to ${sp.to}`;
  } else {
    const key = sp.range && PRESETS[sp.range] ? sp.range : "30d";
    label = PRESETS[key]!;
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    switch (key) {
      case "7d": from = new Date(tomorrow.getTime() - 7 * DAY); break;
      case "90d": from = new Date(tomorrow.getTime() - 90 * DAY); break;
      case "mtd": from = new Date(Date.UTC(y, m, 1)); break;
      case "lm": from = new Date(Date.UTC(y, m - 1, 1)); to = new Date(Date.UTC(y, m, 1)); break;
      case "qtd": from = new Date(Date.UTC(y, m - (m % 3), 1)); break;
      case "ytd": from = new Date(Date.UTC(y, 0, 1)); break;
      case "12m": from = new Date(Date.UTC(y - 1, m, today.getUTCDate() + 1)); break;
      default: from = new Date(tomorrow.getTime() - 30 * DAY);
    }
  }
  const span = to.getTime() - from.getTime();
  return { from, to, prevFrom: new Date(from.getTime() - span), prevTo: from, label, days: Math.round(span / DAY) };
}

/** Bucket size that keeps charts readable: days up to ~2 months, weeks up to ~6 months, then months. */
export function bucketFor(r: Range): "day" | "week" | "month" {
  return r.days <= 62 ? "day" : r.days <= 190 ? "week" : "month";
}

const bucketStart = (d: Date, unit: "day" | "week" | "month") => {
  if (unit === "month") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const day = startOfDay(d);
  if (unit === "week") return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY); // Monday
  return day;
};

/** Every bucket in the range, so charts show zero days instead of skipping them. */
export function buckets(r: Range, unit = bucketFor(r)) {
  const out: Date[] = [];
  let cur = bucketStart(r.from, unit);
  while (cur < r.to) {
    out.push(cur);
    cur = unit === "month" ? new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1)) : new Date(cur.getTime() + (unit === "week" ? 7 : 1) * DAY);
  }
  return out;
}

const pct = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10);

const liveInvoice = (from: Date, to: Date): SQL => and(gte(invoices.issuedAt, from), lt(invoices.issuedAt, to), ne(invoices.status, "void"))!;

async function invoiceTotals(db: DB, from: Date, to: Date) {
  const [r] = await db
    .select({
      count: sql<number>`count(*)::int`,
      net: sql<number>`coalesce(sum(${invoices.subtotalMinor} - ${invoices.discountMinor}), 0)::bigint`,
      tax: sql<number>`coalesce(sum(${invoices.taxMinor}), 0)::bigint`,
      gross: sql<number>`coalesce(sum(${invoices.totalMinor}), 0)::bigint`,
    })
    .from(invoices)
    .where(liveInvoice(from, to));
  return { count: Number(r!.count), net: Number(r!.net), tax: Number(r!.tax), gross: Number(r!.gross) };
}

async function costOfSales(db: DB, from: Date, to: Date) {
  const [r] = await db
    .select({ cogs: sql<number>`coalesce(sum(-${stockMovements.quantity} * coalesce(${stockMovements.unitCostMinor}, 0)), 0)::bigint`, units: sql<number>`coalesce(sum(-${stockMovements.quantity}), 0)::int` })
    .from(stockMovements)
    .where(and(eq(stockMovements.reason, "sale"), gte(stockMovements.createdAt, from), lt(stockMovements.createdAt, to)));
  return { cogs: Number(r!.cogs), units: Number(r!.units) };
}

/** Revenue of stock items sold (fulfilled order lines whose sale movement carries a cost) for margin. */
async function stockItemRevenue(db: DB, from: Date, to: Date) {
  const [r] = await db
    .select({ v: sql<number>`coalesce(sum(${orderLines.lineTotalMinor}), 0)::bigint` })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderLines.variantId))
    .where(and(eq(orders.status, "fulfilled"), gte(orders.fulfilledAt, from), lt(orders.fulfilledAt, to), eq(productVariants.tracksStock, true)));
  return Number(r!.v);
}

// ───────────────────────────── Sales ─────────────────────────────

export async function salesReport(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  const [cur, prev, cogs, prevCogs, stockRev, prevStockRev] = await Promise.all([
    invoiceTotals(db, r.from, r.to),
    invoiceTotals(db, r.prevFrom, r.prevTo),
    costOfSales(db, r.from, r.to),
    costOfSales(db, r.prevFrom, r.prevTo),
    stockItemRevenue(db, r.from, r.to),
    stockItemRevenue(db, r.prevFrom, r.prevTo),
  ]);
  const unit = bucketFor(r);
  const rows = await db
    .select({ at: invoices.issuedAt, net: sql<number>`(${invoices.subtotalMinor} - ${invoices.discountMinor})::bigint`, source: orders.source })
    .from(invoices)
    .leftJoin(orders, eq(orders.id, invoices.orderId))
    .where(liveInvoice(r.from, r.to));
  const series = buckets(r, unit).map((b) => ({ at: b, value: 0 }));
  const channels = new Map<string, { label: string; value: number; count: number }>();
  const channelLabel: Record<string, string> = { shop: "Online shop", quote: "Quotations", ses: "Synclytics" };
  for (const x of rows) {
    const start = bucketStart(x.at, unit).getTime();
    const s = series.find((p) => p.at.getTime() === start);
    if (s) s.value += Number(x.net);
    const key = x.source ?? "other";
    const c = channels.get(key) ?? { label: channelLabel[key] ?? "Other invoices", value: 0, count: 0 };
    c.value += Number(x.net);
    c.count++;
    channels.set(key, c);
  }
  const margin = stockRev - cogs.cogs;
  const prevMargin = prevStockRev - prevCogs.cogs;
  return {
    unit,
    series,
    kpis: {
      net: { value: cur.net, change: pct(cur.net, prev.net) },
      invoices: { value: cur.count, change: pct(cur.count, prev.count) },
      average: { value: cur.count ? Math.round(cur.net / cur.count) : 0, change: pct(cur.count ? cur.net / cur.count : 0, prev.count ? prev.net / prev.count : 0) },
      tax: { value: cur.tax, change: pct(cur.tax, prev.tax) },
      margin: { value: margin, change: pct(margin, prevMargin) },
      marginPct: stockRev ? Math.round((margin / stockRev) * 1000) / 10 : null,
      unitsSold: cogs.units,
    },
    channels: [...channels.values()].sort((a, b) => b.value - a.value),
  };
}

/** Per product option: units, sales, cost and margin of fulfilled orders, with ABC class by sales. */
export async function productPerformance(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  const lines = await db
    .select({
      variantId: orderLines.variantId,
      sku: productVariants.sku,
      name: products.name,
      variantName: productVariants.name,
      categoryName: categories.name,
      brandName: brands.name,
      qty: sql<number>`sum(${orderLines.quantity})::int`,
      revenue: sql<number>`sum(${orderLines.lineTotalMinor})::bigint`,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderLines.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(and(eq(orders.status, "fulfilled"), gte(orders.fulfilledAt, r.from), lt(orders.fulfilledAt, r.to)))
    .groupBy(orderLines.variantId, productVariants.sku, products.name, productVariants.name, categories.name, brands.name);
  const costs = await db
    .select({ variantId: stockMovements.variantId, cost: sql<number>`sum(-${stockMovements.quantity} * coalesce(${stockMovements.unitCostMinor}, 0))::bigint` })
    .from(stockMovements)
    .innerJoin(orders, sql`${orders.id}::text = ${stockMovements.refId}`)
    .where(and(eq(stockMovements.reason, "sale"), eq(stockMovements.refType, "order"), eq(orders.status, "fulfilled"), gte(orders.fulfilledAt, r.from), lt(orders.fulfilledAt, r.to)))
    .groupBy(stockMovements.variantId);
  const costOf = new Map(costs.map((c) => [c.variantId, Number(c.cost)]));
  const rows = lines
    .map((l) => {
      const revenue = Number(l.revenue);
      const cost = costOf.get(l.variantId!) ?? null;
      return { ...l, name: l.variantName === "Standard" ? l.name : `${l.name} — ${l.variantName}`, revenue, cost, margin: cost === null ? null : revenue - cost, marginPct: cost === null || revenue === 0 ? null : Math.round(((revenue - cost) / revenue) * 1000) / 10 };
    })
    .sort((a, b) => b.revenue - a.revenue);
  // ABC: A = items making the first 80% of sales, B = the next 15%, C = the rest.
  const total = rows.reduce((a, x) => a + x.revenue, 0);
  let running = 0;
  const ranked = rows.map((x) => {
    running += x.revenue;
    const share = total ? running / total : 1;
    return { ...x, abc: share <= 0.8 || running === x.revenue ? "A" : share <= 0.95 ? "B" : "C" };
  });
  const rollup = (key: "categoryName" | "brandName") => {
    const m = new Map<string, { label: string; revenue: number; margin: number; qty: number }>();
    for (const x of ranked) {
      const label = x[key] ?? "None";
      const cur = m.get(label) ?? { label, revenue: 0, margin: 0, qty: 0 };
      cur.revenue += x.revenue;
      cur.margin += x.margin ?? 0;
      cur.qty += x.qty;
      m.set(label, cur);
    }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  };
  return { rows: ranked, total, byCategory: rollup("categoryName"), byBrand: rollup("brandName") };
}

export async function topCustomers(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  const rows = await db
    .select({ id: customers.id, name: customers.name, company: customers.company, invoices: sql<number>`count(*)::int`, net: sql<number>`sum(${invoices.subtotalMinor} - ${invoices.discountMinor})::bigint` })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(liveInvoice(r.from, r.to))
    .groupBy(customers.id, customers.name, customers.company)
    .orderBy(sql`sum(${invoices.subtotalMinor} - ${invoices.discountMinor}) desc`)
    .limit(20);
  return rows.map((x) => ({ ...x, net: Number(x.net) }));
}

// ───────────────────────────── Finance & tax ─────────────────────────────

/** Taxes on invoices issued, by month and tax, for the GRA VAT/NHIL/GETFund return. */
export async function taxReport(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  authorize(actor, "finance.read");
  const rows = await db.select({ at: invoices.issuedAt, net: sql<number>`(${invoices.subtotalMinor} - ${invoices.discountMinor})::bigint`, breakdown: invoices.taxBreakdown }).from(invoices).where(liveInvoice(r.from, r.to)).orderBy(asc(invoices.issuedAt));
  const codes = new Map<string, string>();
  const months = new Map<string, { month: string; net: number; taxes: Record<string, number>; total: number }>();
  for (const x of rows) {
    const key = x.at.toISOString().slice(0, 7);
    const m = months.get(key) ?? { month: key, net: 0, taxes: {}, total: 0 };
    m.net += Number(x.net);
    for (const t of x.breakdown ?? []) {
      codes.set(t.code, t.name);
      m.taxes[t.code] = (m.taxes[t.code] ?? 0) + t.amountMinor;
      m.total += t.amountMinor;
    }
    months.set(key, m);
  }
  const list = [...months.values()];
  return { codes: [...codes.entries()].map(([code, name]) => ({ code, name })), months: list, totals: { net: list.reduce((a, m) => a + m.net, 0), tax: list.reduce((a, m) => a + m.total, 0), byCode: Object.fromEntries([...codes.keys()].map((c) => [c, list.reduce((a, m) => a + (m.taxes[c] ?? 0), 0)])) } };
}

export const METHOD_LABELS: Record<string, string> = { mobile_money: "Mobile money", bank_transfer: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card (Paystack)", paystack: "Paystack", manual: "Recorded by staff" };

export async function paymentsReport(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  authorize(actor, "finance.read");
  const rows = await db
    .select({ method: sql<string>`coalesce(${payments.method}, ${payments.provider})`, n: sql<number>`count(*)::int`, total: sql<number>`sum(${payments.amountMinor})::bigint` })
    .from(payments)
    .where(and(eq(payments.status, "success"), isNotNull(payments.paidAt), gte(payments.paidAt, r.from), lt(payments.paidAt, r.to)))
    .groupBy(sql`coalesce(${payments.method}, ${payments.provider})`);
  return rows.map((x) => ({ label: METHOD_LABELS[x.method] ?? x.method, count: x.n, value: Number(x.total) })).sort((a, b) => b.value - a.value);
}

/** Unpaid invoice balances by how overdue they are. */
export async function receivablesAging(db: DB, actor: Actor, now = new Date()) {
  authorize(actor, "reports.read");
  authorize(actor, "finance.read");
  const open = await db
    .select({ id: invoices.id, number: invoices.number, billTo: invoices.billToName, dueAt: invoices.dueAt, total: invoices.totalMinor, paid: invoices.paidMinor })
    .from(invoices)
    .where(inArray(invoices.status, ["issued", "part_paid"]));
  const buckets = [
    { key: "current", label: "Not yet due", value: 0, count: 0 },
    { key: "1-30", label: "1–30 days overdue", value: 0, count: 0 },
    { key: "31-60", label: "31–60 days", value: 0, count: 0 },
    { key: "61-90", label: "61–90 days", value: 0, count: 0 },
    { key: "90+", label: "Over 90 days", value: 0, count: 0 },
  ];
  const list = open.map((i) => {
    const balance = Number(i.total) - Number(i.paid);
    const late = i.dueAt ? Math.floor((now.getTime() - i.dueAt.getTime()) / DAY) : 0;
    const b = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    buckets[b]!.value += balance;
    buckets[b]!.count++;
    return { ...i, balance, daysOverdue: Math.max(0, late) };
  });
  return { buckets, invoices: list.filter((x) => x.balance > 0).sort((a, b) => b.daysOverdue - a.daysOverdue), total: list.reduce((a, x) => a + x.balance, 0) };
}

// ───────────────────────────── Inventory ─────────────────────────────

/** Value by category and location, turnover, days of cover, dead and slow stock, and losses by reason. */
export async function inventoryReport(db: DB, actor: Actor, r: Range, now = new Date()) {
  authorize(actor, "reports.read");
  authorize(actor, "inventory.read");
  const stock = await stockOverview(db, actor);
  const since90 = new Date(now.getTime() - 90 * DAY);
  const sales90 = await db
    .select({ variantId: stockMovements.variantId, units: sql<number>`sum(-${stockMovements.quantity})::int`, last: sql<Date>`max(${stockMovements.createdAt})` })
    .from(stockMovements)
    .where(and(eq(stockMovements.reason, "sale"), gte(stockMovements.createdAt, since90)))
    .groupBy(stockMovements.variantId);
  const lastSale = await db.select({ variantId: stockMovements.variantId, last: sql<string>`max(${stockMovements.createdAt})` }).from(stockMovements).where(eq(stockMovements.reason, "sale")).groupBy(stockMovements.variantId);
  const sold = new Map(sales90.map((s) => [s.variantId, Number(s.units)]));
  const lastOf = new Map(lastSale.map((s) => [s.variantId, new Date(s.last)]));
  const value = stock.reduce((a, s) => a + s.valueMinor, 0);
  const cogs90 = (await costOfSales(db, since90, now)).cogs;
  // Annual turnover ≈ cost of sales over 90 days × 365/90 ÷ current stock value.
  const turnover = value > 0 ? Math.round(((cogs90 * 365) / 90 / value) * 10) / 10 : null;
  const items = stock.map((s) => {
    const daily = (sold.get(s.variantId) ?? 0) / 90;
    const last = lastOf.get(s.variantId) ?? null;
    return { ...s, dailyDemand: Math.round(daily * 100) / 100, daysOfCover: daily > 0 ? Math.round(s.available / daily) : null, lastSale: last, idleDays: last ? Math.floor((now.getTime() - last.getTime()) / DAY) : null };
  });
  const dead = items.filter((i) => i.onHand > 0 && (i.idleDays === null || i.idleDays > 90)).sort((a, b) => b.valueMinor - a.valueMinor);
  const byCategory = new Map<string, { label: string; value: number; units: number }>();
  for (const i of items) {
    const label = i.categoryName ?? "No category";
    const c = byCategory.get(label) ?? { label, value: 0, units: 0 };
    c.value += i.valueMinor;
    c.units += i.onHand;
    byCategory.set(label, c);
  }
  const locs = await db.select().from(stockLocations).orderBy(asc(stockLocations.name));
  const byLocation = locs.map((l) => ({ label: l.name, value: items.reduce((a, i) => a + (i.levels.find((x) => x.locationId === l.id)?.onHand ?? 0) * (i.costMinor ?? 0), 0), units: items.reduce((a, i) => a + (i.levels.find((x) => x.locationId === l.id)?.onHand ?? 0), 0) })).filter((l) => l.units > 0);
  const losses = await db
    .select({ reason: stockMovements.reason, units: sql<number>`sum(-${stockMovements.quantity})::int`, value: sql<number>`sum(-${stockMovements.quantity} * coalesce(${stockMovements.unitCostMinor}, 0))::bigint` })
    .from(stockMovements)
    .where(and(inArray(stockMovements.reason, ["damaged", "lost", "expired", "internal_use", "count", "correction", "found"]), gte(stockMovements.createdAt, r.from), lt(stockMovements.createdAt, r.to)))
    .groupBy(stockMovements.reason);
  return {
    value,
    units: items.reduce((a, i) => a + i.onHand, 0),
    turnover,
    outOfStock: items.filter((i) => i.status === "out_of_stock").length,
    byCategory: [...byCategory.values()].sort((a, b) => b.value - a.value),
    byLocation,
    dead,
    lowCover: items.filter((i) => i.daysOfCover !== null && i.daysOfCover <= 14).sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0)),
    losses: losses.map((l) => ({ reason: l.reason, units: Number(l.units), value: Number(l.value) })),
  };
}

/**
 * Demand forecast per stock item from the last 12 weeks of sales, using double exponential smoothing (Holt) on
 * weekly totals so a rising or falling trend is picked up. Safety stock covers demand variability over the lead
 * time at a 95% service level; the suggested order brings stock up to cover lead time + two weeks.
 */
export function holtForecast(weekly: number[], alpha = 0.4, beta = 0.2) {
  if (weekly.length === 0) return { level: 0, trend: 0, next: 0 };
  let level = weekly[0]!;
  let trend = weekly.length > 1 ? weekly[1]! - weekly[0]! : 0;
  for (let i = 1; i < weekly.length; i++) {
    const prevLevel = level;
    level = alpha * weekly[i]! + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  return { level, trend, next: Math.max(0, level + trend) };
}

export async function forecastReport(db: DB, actor: Actor, now = new Date()) {
  authorize(actor, "reports.read");
  authorize(actor, "inventory.read");
  const WEEKS = 12;
  const start = new Date(startOfDay(now).getTime() - WEEKS * 7 * DAY);
  const moves = await db
    .select({ variantId: stockMovements.variantId, at: stockMovements.createdAt, units: sql<number>`-${stockMovements.quantity}` })
    .from(stockMovements)
    .where(and(eq(stockMovements.reason, "sale"), gte(stockMovements.createdAt, start)));
  const weeklyOf = new Map<string, number[]>();
  for (const m of moves) {
    const w = Math.min(WEEKS - 1, Math.floor((m.at.getTime() - start.getTime()) / (7 * DAY)));
    const arr = weeklyOf.get(m.variantId) ?? Array(WEEKS).fill(0);
    arr[w] += Number(m.units);
    weeklyOf.set(m.variantId, arr);
  }
  const stock = await stockOverview(db, actor);
  const onOrder = await onOrderByVariant(db);
  const Z = 1.65;
  const REVIEW_WEEKS = 2;
  const rows = stock
    .filter((s) => weeklyOf.has(s.variantId) || s.reorderPoint !== null)
    .map((s) => {
      const weekly = weeklyOf.get(s.variantId) ?? Array(WEEKS).fill(0);
      const f = holtForecast(weekly);
      const mean = weekly.reduce((a, b) => a + b, 0) / WEEKS;
      const sd = Math.sqrt(weekly.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, WEEKS - 1));
      const ltWeeks = (s.leadTimeDays ?? 7) / 7;
      const safety = Math.ceil(Z * sd * Math.sqrt(ltWeeks));
      const suggestedReorderPoint = Math.ceil(f.next * ltWeeks + safety);
      const coming = onOrder.get(s.variantId) ?? 0;
      const target = Math.ceil(f.next * (ltWeeks + REVIEW_WEEKS) + safety);
      const suggestedOrder = Math.max(0, target - s.available - coming);
      const weeksLeft = f.next > 0 ? s.available / f.next : null;
      return {
        ...s,
        weekly,
        forecastWeekly: Math.round(f.next * 10) / 10,
        trend: Math.round(f.trend * 10) / 10,
        safetyStock: safety,
        suggestedReorderPoint,
        onOrder: coming,
        suggestedOrder,
        stockoutDate: weeksLeft === null ? null : new Date(now.getTime() + weeksLeft * 7 * DAY),
      };
    })
    .sort((a, b) => (a.stockoutDate?.getTime() ?? Infinity) - (b.stockoutDate?.getTime() ?? Infinity));
  return { weeks: WEEKS, rows };
}

// ───────────────────────────── Purchasing ─────────────────────────────

export async function purchasingReport(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  authorize(actor, "purchasing.read");
  const received = await db
    .select({ supplier: suppliers.name, value: sql<number>`coalesce(sum(${stockMovements.quantity} * coalesce(${stockMovements.unitCostMinor}, 0)), 0)::bigint`, units: sql<number>`coalesce(sum(${stockMovements.quantity}), 0)::int` })
    .from(stockMovements)
    .innerJoin(purchaseOrders, sql`${purchaseOrders.id}::text = ${stockMovements.refId}`)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(eq(stockMovements.reason, "receipt"), eq(stockMovements.refType, "purchase_order"), gte(stockMovements.createdAt, r.from), lt(stockMovements.createdAt, r.to)))
    .groupBy(suppliers.name);
  // On time = first delivery on or before the date the order was needed by.
  const firsts = await db
    .select({ supplier: suppliers.name, expected: purchaseOrders.expectedAt, first: sql<Date>`min(${goodsReceipts.createdAt})` })
    .from(goodsReceipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.purchaseOrderId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(isNotNull(purchaseOrders.expectedAt), gte(goodsReceipts.createdAt, r.from), lt(goodsReceipts.createdAt, r.to)))
    .groupBy(suppliers.name, purchaseOrders.id, purchaseOrders.expectedAt);
  const perf = new Map<string, { onTime: number; total: number }>();
  for (const f of firsts) {
    const p = perf.get(f.supplier) ?? { onTime: 0, total: 0 };
    p.total++;
    if (new Date(f.first).getTime() <= f.expected!.getTime() + DAY) p.onTime++;
    perf.set(f.supplier, p);
  }
  const open = await db
    .select({ n: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${purchaseOrders.totalMinor}), 0)::bigint` })
    .from(purchaseOrders)
    .where(inArray(purchaseOrders.status, ["draft", "sent", "partially_received"]));
  return {
    bySupplier: received.map((x) => ({ label: x.supplier, value: Number(x.value), units: x.units, onTimePct: perf.get(x.supplier) ? Math.round((perf.get(x.supplier)!.onTime / perf.get(x.supplier)!.total) * 100) : null })).sort((a, b) => b.value - a.value),
    spend: received.reduce((a, x) => a + Number(x.value), 0),
    openOrders: { count: open[0]!.n, value: Number(open[0]!.value) },
  };
}

// ───────────────────────────── Enquiries & jobs ─────────────────────────────

export async function pipelineReport(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  const enq = await db
    .select({ line: enquiries.serviceLine, status: enquiries.status, n: sql<number>`count(*)::int` })
    .from(enquiries)
    .where(and(gte(enquiries.createdAt, r.from), lt(enquiries.createdAt, r.to)))
    .groupBy(enquiries.serviceLine, enquiries.status);
  const qs = await db
    .select({ line: quotes.serviceLine, status: quotes.status, n: sql<number>`count(*)::int`, value: sql<number>`sum(${quotes.totalMinor})::bigint` })
    .from(quotes)
    .where(and(gte(quotes.createdAt, r.from), lt(quotes.createdAt, r.to)))
    .groupBy(quotes.serviceLine, quotes.status);
  const jobs = await db
    .select({ line: serviceJobs.serviceLine, done: sql<number>`count(*) filter (where ${serviceJobs.status} = 'completed')::int`, total: sql<number>`count(*)::int`, avgDays: sql<number>`avg(extract(epoch from (${serviceJobs.completedAt} - ${serviceJobs.createdAt})) / 86400) filter (where ${serviceJobs.status} = 'completed')` })
    .from(serviceJobs)
    .where(and(gte(serviceJobs.createdAt, r.from), lt(serviceJobs.createdAt, r.to)))
    .groupBy(serviceJobs.serviceLine);
  const lines = new Set([...enq.map((e) => e.line), ...qs.map((q) => q.line), ...jobs.map((j) => j.line)].map((l) => l ?? "other"));
  const sum = (arr: { n: number }[]) => arr.reduce((a, x) => a + x.n, 0);
  const byLine = [...lines].map((line) => {
    const e = enq.filter((x) => (x.line ?? "other") === line);
    const q = qs.filter((x) => (x.line ?? "other") === line);
    const j = jobs.find((x) => (x.line ?? "other") === line);
    const sent = sum(q.filter((x) => ["sent", "accepted", "declined", "expired"].includes(x.status)));
    const won = sum(q.filter((x) => x.status === "accepted"));
    return {
      line,
      label: line === "other" ? "Shop / general" : serviceTitle(line),
      enquiries: sum(e),
      quotes: sum(q),
      won,
      winRate: sent ? Math.round((won / sent) * 100) : null,
      wonValue: q.filter((x) => x.status === "accepted").reduce((a, x) => a + Number(x.value), 0),
      jobsDone: j?.done ?? 0,
      jobsTotal: j?.total ?? 0,
      avgJobDays: j?.avgDays === null || j?.avgDays === undefined ? null : Math.round(Number(j.avgDays) * 10) / 10,
    };
  });
  return { byLine: byLine.sort((a, b) => b.enquiries + b.quotes - (a.enquiries + a.quotes)), totals: { enquiries: byLine.reduce((a, x) => a + x.enquiries, 0), quotes: byLine.reduce((a, x) => a + x.quotes, 0), won: byLine.reduce((a, x) => a + x.won, 0) } };
}


// ───────────────────────────── Weekly summary e-mail ─────────────────────────────

/**
 * Monday-morning summary of the last 7 days for everyone who can read reports. Each person gets only the figures
 * their own permissions allow (finance and stock lines are left out otherwise). Switch off in Settings.
 */
export async function sendWeeklyDigest(db: DB, now = new Date()) {
  const settings = await getSettings(db);
  if (!settings.weeklyReport) return 0;
  const r = parseRange({ range: "7d" }, now);
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const change = (c: number | null) => (c === null ? " (new)" : c === 0 ? "" : ` (${c > 0 ? "+" : ""}${c}% vs the week before)`);
  let sent = 0;
  for (const id of await usersWithPermission(db, "reports.read")) {
    const actor = await loadActor(db, id, { id: "weekly-digest", mfaVerified: true });
    if (!actor) continue;
    const s = await salesReport(db, actor, r);
    const lines = [
      `Hello ${actor.name},`,
      "",
      `Here is ${settings.companyName}'s week: ${r.from.toISOString().slice(0, 10)} to ${new Date(r.to.getTime() - 1).toISOString().slice(0, 10)}.`,
      "",
      `Net sales: ${formatMoney(s.kpis.net.value)}${change(s.kpis.net.change)}`,
      `Invoices issued: ${s.kpis.invoices.value}`,
      `Gross margin on stock items: ${formatMoney(s.kpis.margin.value)}${s.kpis.marginPct === null ? "" : ` (${s.kpis.marginPct}%)`}`,
    ];
    if (can(actor, "finance.read")) {
      const [pay, aging] = await Promise.all([paymentsReport(db, actor, r), receivablesAging(db, actor, now)]);
      const overdue = aging.buckets.slice(1).reduce((a, b) => a + b.value, 0);
      lines.push(`Payments received: ${formatMoney(pay.reduce((a, p) => a + p.value, 0))}`, `Overdue invoices: ${formatMoney(overdue)}`);
    }
    if (can(actor, "inventory.read")) {
      const reorder = await reorderList(db, actor);
      lines.push(`Items at or below their reorder point: ${reorder.length}${reorder.length ? ` (${reorder.slice(0, 5).map((x) => x.sku).join(", ")}${reorder.length > 5 ? " …" : ""})` : ""}`);
    }
    const top = (await productPerformance(db, actor, r)).rows.slice(0, 5);
    if (top.length) lines.push("", "Best sellers:", ...top.map((t) => `- ${t.name}: ${t.qty} sold, ${formatMoney(t.revenue)}`));
    lines.push("", `Full reports: ${base}/admin/reports`, "", "You receive this because you can view reports. An administrator can turn it off in Settings.");
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
    if (!u?.email) continue;
    await sendMail(db, { to: u.email, subject: `Weekly summary — ${settings.companyName}`, body: lines.join("\n") });
    sent++;
  }
  return sent;
}
